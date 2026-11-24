import {
  collection,
  deleteField,
  doc,
  getDoc,
  increment,
  runTransaction,
  serverTimestamp,
  updateDoc,
  writeBatch,
  type DocumentReference,
  type Firestore,
  type Transaction,
} from 'firebase/firestore';
import { isOldFormat, MAX_PEOPLE, nextStatus, normalizeBet, sideOf } from '../model/bet';
import type { Ballot, BetDoc, Side, Uid, VoteStyle } from '../model/types';
import { attempt, cleanText, isPermissionDenied, NEEDS_MEMBER_LIST } from './errors';

export type NewBetInput = {
  description: string;
  /** Side A with me, after me. */
  teammates: Uid[];
  /** Side B. Empty for an open challenge. */
  opponents: Uid[];
  /** Who the bet is about. Never on a side. */
  subjects: Uid[];
  /** What my side (A) owes if it loses. */
  stakeMine: string;
  /** What their side (B) owes if it loses. */
  stakeTheirs: string;
  voteStyle: VoteStyle;
};

const DESCRIPTION_MAX = 2000;
const STAKE_MAX = 500;

const NEEDS_UPGRADE = 'This bet needs the group upgrade first. Ask Kyle.';

const betRef = (db: Firestore, betId: string) => doc(db, `bets/${betId}`);
const tallyRef = (db: Firestore, betId: string) => doc(db, `bets/${betId}/tally/counts`);

/** Checks a new bet's people the way the rules do, so a bad pick fails with words, not a denial. */
function checkLineup(sideA: Uid[], sideB: Uid[], subjects: Uid[]): void {
  const onSides = [...sideA, ...sideB];
  if (onSides.length + subjects.length > MAX_PEOPLE) throw new Error(`A bet can have at most ${MAX_PEOPLE} people.`);
  if (new Set(onSides).size !== onSides.length) throw new Error('Someone is picked more than once.');
  if (new Set(subjects).size !== subjects.length) throw new Error('Someone is picked more than once.');
  if (subjects.some((u) => onSides.includes(u))) throw new Error("The people a bet is about can't be on a side.");
}

/**
 * Proposes a bet with `me` first on side A, then my teammates; side B is the opponents (none
 * for an open challenge). Only I am in to start. Text and people are checked before writing,
 * and a group that hasn't had its member list built yet gets a clear message. An anonymous
 * bet gets its zero tally in the same batch. Returns the new bet id.
 */
export async function proposeBet(db: Firestore, me: Uid, input: NewBetInput): Promise<string> {
  const description = cleanText(input.description, DESCRIPTION_MAX, 'Description');
  const stakeA = cleanText(input.stakeMine, STAKE_MAX, 'Your stake');
  const stakeB = cleanText(input.stakeTheirs, STAKE_MAX, 'Their stake');
  const sideA = [me, ...input.teammates];
  const sideB = [...input.opponents];
  const subjects = [...input.subjects];
  checkLineup(sideA, sideB, subjects);
  // The rules check everyone named against group/members; without it every propose is denied.
  if (!(await getDoc(doc(db, 'group/members'))).exists()) throw new Error(NEEDS_MEMBER_LIST);

  const ref = doc(collection(db, 'bets'));
  const b = writeBatch(db);
  b.set(ref, {
    description,
    sideA,
    sideB,
    subjects,
    confirmed: [me],
    paidBy: [],
    stakeA,
    stakeB,
    voteStyle: input.voteStyle,
    status: 'proposed',
    winner: null,
    createdBy: me,
    createdAt: serverTimestamp(),
    votesA: {},
    votesB: {},
    voters: {},
    voterCount: 0,
  });
  if (input.voteStyle === 'anonymous') b.set(tallyRef(db, ref.id), { A: 0, B: 0 });
  await b.commit();
  return ref.id;
}

type Lineup = Pick<BetDoc, 'sideA' | 'sideB' | 'confirmed'>;

/**
 * Reads the bet in a transaction and writes `move`'s new lineup with the status it demands.
 * Bets in the old format and bets past proposed fail with a clear message.
 */
async function moveOnBet(
  db: Firestore,
  me: Uid,
  betId: string,
  move: (bet: BetDoc, mySide: Side | null) => Lineup | null,
): Promise<void> {
  const ref = betRef(db, betId);
  await retryIfChanged(db, ref, (tx, bet) => {
    if (bet.status !== 'proposed') throw new Error('This bet has already started.');
    const next = move(bet, sideOf(bet, me));
    if (next) tx.update(ref, { ...next, status: nextStatus(next) });
  });
}

const RETRIES = 5;

/**
 * Runs `write` in a transaction on the freshly read bet. If someone else changed the bet
 * between our read and our commit (two people joining at once), the rules judge our write
 * against their newer bet and deny it before Firestore's own stale-read retry can kick in. So
 * on a denial, if the bet is no longer what we read, read it again and redo the write; a
 * denial of a write based on the current bet is real and is rethrown.
 */
async function retryIfChanged(
  db: Firestore,
  ref: DocumentReference,
  write: (tx: Transaction, bet: BetDoc) => void,
): Promise<void> {
  for (let i = 0; ; i++) {
    let seen: unknown;
    try {
      await runTransaction(db, async (tx) => {
        const bet = await readBet(tx, ref);
        seen = bet;
        write(tx, bet);
      });
      return;
    } catch (err) {
      if (!isPermissionDenied(err) || i >= RETRIES) throw err;
      const now = await getDoc(ref);
      if (!now.exists() || sameBet(normalizeBet(now.data()), seen)) throw err;
    }
  }
}

/** The fields a member move or mark paid depends on are unchanged. */
function sameBet(a: BetDoc, b: unknown): boolean {
  if (!b) return false;
  const pick = (x: BetDoc) =>
    JSON.stringify([x.sideA, x.sideB, x.subjects, x.confirmed, x.paidBy, x.status, x.winner]);
  return pick(a) === pick(b as BetDoc);
}

/** Reads a bet in a transaction, refusing a missing one or one still in the old format. */
async function readBet(tx: Transaction, ref: DocumentReference): Promise<BetDoc> {
  const snap = await tx.get(ref);
  if (!snap.exists()) throw new Error('This bet is gone.');
  const raw = snap.data();
  // The rules only understand the list shape; a write to an old bet would be a bare denial.
  if (isOldFormat(raw)) throw new Error(NEEDS_UPGRADE);
  return normalizeBet(raw);
}

const withMe = (list: Uid[], me: Uid) => (list.includes(me) ? list : [...list, me]);
const withoutMe = (list: Uid[], me: Uid) => list.filter((u) => u !== me);

/** Joins `side` at the end and counts me in. Already on it: nothing to do. */
export function joinSide(db: Firestore, me: Uid, betId: string, side: Side): Promise<void> {
  return moveOnBet(db, me, betId, (bet, mine) => {
    if (bet.subjects.includes(me)) throw new Error("You can't join a bet that's about you.");
    if (mine === side) return null;
    if (mine) throw new Error("You're on the other side. Use Switch sides.");
    const key = side === 'A' ? 'sideA' : 'sideB';
    return { sideA: bet.sideA, sideB: bet.sideB, [key]: [...bet[key], me], confirmed: withMe(bet.confirmed, me) };
  });
}

/** Moves me to the end of the other side and counts me in. */
export function switchSide(db: Firestore, me: Uid, betId: string): Promise<void> {
  return moveOnBet(db, me, betId, (bet, mine) => {
    if (!mine) throw new Error("You're not on this bet.");
    const confirmed = withMe(bet.confirmed, me);
    return mine === 'A'
      ? { sideA: withoutMe(bet.sideA, me), sideB: [...bet.sideB, me], confirmed }
      : { sideA: [...bet.sideA, me], sideB: withoutMe(bet.sideB, me), confirmed };
  });
}

/** Takes me off my side and out of confirmed. The last off side A voids the bet. */
export function leaveBet(db: Firestore, me: Uid, betId: string): Promise<void> {
  return moveOnBet(db, me, betId, (bet, mine) => {
    if (!mine) return null;
    return {
      sideA: withoutMe(bet.sideA, me),
      sideB: withoutMe(bet.sideB, me),
      confirmed: withoutMe(bet.confirmed, me),
    };
  });
}

/** I'm in: adds me to confirmed. The last one in makes the bet active. */
export function confirmIn(db: Firestore, me: Uid, betId: string): Promise<void> {
  return moveOnBet(db, me, betId, (bet, mine) => {
    if (!mine) throw new Error("You're not on this bet.");
    if (bet.confirmed.includes(me)) return null;
    return { sideA: bet.sideA, sideB: bet.sideB, confirmed: [...bet.confirmed, me] };
  });
}

/** Any member calls it: active -> voting. */
export async function callIt(db: Firestore, betId: string): Promise<void> {
  await updateDoc(betRef(db, betId), { status: 'voting' });
}

/** Open vote: puts `me` on `side`, moving her off the other side; `null` removes her vote. */
export async function castOpenVote(db: Firestore, me: Uid, betId: string, side: Side | null): Promise<void> {
  await updateDoc(betRef(db, betId), {
    [`votesA.${me}`]: side === 'A' ? true : deleteField(),
    [`votesB.${me}`]: side === 'B' ? true : deleteField(),
  });
}

/**
 * Anonymous vote. Reads only `me`'s own ballot to choose the shape: new (ballot + voters key +
 * voterCount +1 + tally +1) or changed (ballot + tally -1/+1). Does nothing if unchanged.
 * The hidden tally is moved with increment(), never read.
 */
export async function castAnonVote(db: Firestore, me: Uid, betId: string, side: Side): Promise<void> {
  const ballotRef = doc(db, `bets/${betId}/ballots/${me}`);
  await runTransaction(db, async (tx) => {
    const ballot = await tx.get(ballotRef);
    if (ballot.exists()) {
      const prev = (ballot.data() as Ballot<Side>).choice;
      if (prev === side) return;
      tx.update(ballotRef, { choice: side });
      tx.update(tallyRef(db, betId), { [prev]: increment(-1), [side]: increment(1) });
    } else {
      tx.set(ballotRef, { choice: side });
      tx.update(betRef(db, betId), { [`voters.${me}`]: true, voterCount: increment(1) });
      tx.update(tallyRef(db, betId), { [side]: increment(1) });
    }
  });
}

/**
 * Tries to settle a bet in voting: A, then B. The rules allow each only with a strict majority
 * against the live member count (from votesA/votesB for open bets, from the hidden tally for
 * anonymous ones), so a denial means "not decided" and this returns null. A bet that is not
 * in voting (already settled by someone else, for one) also returns null.
 */
export async function trySettle(db: Firestore, betId: string): Promise<Side | null> {
  const snap = await getDoc(betRef(db, betId));
  if (!snap.exists()) return null;
  if (normalizeBet(snap.data()).status !== 'voting') return null;
  // Both vote styles settle with the same write; the rules check the evidence for the
  // bet's voteStyle (settlingOpen or settlingAnon).
  for (const winner of ['A', 'B'] as const) {
    if (await attempt(() => updateDoc(betRef(db, betId), { status: 'settled', winner }))) return winner;
  }
  return null;
}

/**
 * A winner marks that she got paid: adds her to the end of paidBy, and the write that covers
 * the whole winning side makes the bet paid. Already marked: nothing to do.
 */
export async function markIGotPaid(db: Firestore, me: Uid, betId: string): Promise<void> {
  const ref = betRef(db, betId);
  await retryIfChanged(db, ref, (tx, bet) => {
    if (bet.status !== 'settled' || bet.winner === null) throw new Error("This bet isn't waiting on payment.");
    const won = bet.winner === 'A' ? bet.sideA : bet.sideB;
    if (!won.includes(me)) throw new Error('Only the winners can mark it paid.');
    if (bet.paidBy.includes(me)) return;
    const paidBy = [...bet.paidBy, me];
    tx.update(ref, { paidBy, status: won.every((u) => paidBy.includes(u)) ? 'paid' : 'settled' });
  });
}
