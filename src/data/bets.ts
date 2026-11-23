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
  type Firestore,
} from 'firebase/firestore';
import type { Ballot, BetDoc, Side, Uid, VoteStyle } from '../model/types';
import { attempt, cleanText } from './errors';

export type NewBetInput = {
  description: string;
  opponent: Uid;
  subject: Uid | null;
  /** What I (side A) owe if I lose. */
  stakeMine: string;
  /** What the opponent (side B) owes if she loses. */
  stakeTheirs: string;
  voteStyle: VoteStyle;
};

const DESCRIPTION_MAX = 2000;
const STAKE_MAX = 500;

const betRef = (db: Firestore, betId: string) => doc(db, `bets/${betId}`);
const tallyRef = (db: Firestore, betId: string) => doc(db, `bets/${betId}/tally/counts`);

/**
 * Proposes a bet with `me` as side A. Text is trimmed and checked before writing.
 * An anonymous bet gets its zero tally in the same batch. Returns the new bet id.
 */
export async function proposeBet(db: Firestore, me: Uid, input: NewBetInput): Promise<string> {
  const description = cleanText(input.description, DESCRIPTION_MAX, 'Description');
  const stakeA = cleanText(input.stakeMine, STAKE_MAX, 'Your stake');
  const stakeB = cleanText(input.stakeTheirs, STAKE_MAX, 'Their stake');
  const ref = doc(collection(db, 'bets'));
  const b = writeBatch(db);
  b.set(ref, {
    description,
    sideA: me,
    sideB: input.opponent,
    subject: input.subject,
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

/** Side B accepts: proposed -> active. */
export async function acceptBet(db: Firestore, betId: string): Promise<void> {
  await updateDoc(betRef(db, betId), { status: 'active' });
}

/** Deletes a proposed bet, and its tally when anonymous, in one batch. */
async function withdraw(db: Firestore, betId: string): Promise<void> {
  const snap = await getDoc(betRef(db, betId));
  if (!snap.exists()) return;
  const b = writeBatch(db);
  b.delete(betRef(db, betId));
  if ((snap.data() as BetDoc).voteStyle === 'anonymous') b.delete(tallyRef(db, betId));
  await b.commit();
}

/** Side B declines a proposed bet. */
export function declineBet(db: Firestore, betId: string): Promise<void> {
  return withdraw(db, betId);
}

/** Side A cancels her proposed bet. */
export function cancelBet(db: Firestore, betId: string): Promise<void> {
  return withdraw(db, betId);
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
  if ((snap.data() as BetDoc).status !== 'voting') return null;
  // Both vote styles settle with the same write; the rules check the evidence for the
  // bet's voteStyle (settlingOpen or settlingAnon).
  for (const winner of ['A', 'B'] as const) {
    if (await attempt(() => updateDoc(betRef(db, betId), { status: 'settled', winner }))) return winner;
  }
  return null;
}

/** The winner marks a settled bet paid. */
export async function markPaid(db: Firestore, betId: string): Promise<void> {
  await updateDoc(betRef(db, betId), { status: 'paid' });
}
