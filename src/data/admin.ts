import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  where,
  writeBatch,
  type Firestore,
  type Transaction,
} from 'firebase/firestore';
import { everyone, isOldFormat, MAX_PEOPLE, needsUpgrade, normalizeBet } from '../model/bet';
import { DELETE, planRemoval, type RemovalInput, type Write } from '../model/removal';
import type {
  Ballot,
  BetDoc,
  BetTally,
  GroupDoc,
  JoinRequestDoc,
  JoinTally,
  MembersDoc,
  Side,
  Uid,
  UserDoc,
} from '../model/types';
import { cleanText } from './errors';

// The admin's writes are unconstrained by the rules (except that he can never vote), so
// these functions keep the data consistent themselves: the same shapes members write,
// with absolute values read inside a transaction where a count could race a vote.

const NAME_MAX = 30;
const DESCRIPTION_MAX = 2000;
const STAKE_MAX = 500;

const GROUP = 'group/main';
const MEMBERS = 'group/members';

/** Creates group/main and group/members with no members, each only if it does not exist yet. */
export async function initGroup(db: Firestore): Promise<void> {
  const ref = doc(db, GROUP);
  const membersRef = doc(db, MEMBERS);
  await runTransaction(db, async (tx) => {
    const [group, members] = await Promise.all([tx.get(ref), tx.get(membersRef)]);
    if (!group.exists()) tx.set(ref, { memberCount: 0, lastAdmitted: null } satisfies GroupDoc);
    if (!members.exists()) tx.set(membersRef, { uids: {} } satisfies MembersDoc);
  });
}

/** Reads users/{uid} in `tx` and throws unless her status is `status`. */
async function requireStatus(tx: Transaction, db: Firestore, uid: Uid, status: UserDoc['status']): Promise<UserDoc> {
  const snap = await tx.get(doc(db, `users/${uid}`));
  const user = snap.data() as UserDoc | undefined;
  if (user?.status !== status) throw new Error(`${uid} is not ${status}`);
  return user;
}

/**
 * Admits a pending user directly, in the same shape as a member's approve batch: request
 * approved, user member, memberCount +1 and lastAdmitted, and her key in group/members
 * (created if missing). Founding members come in this way.
 */
export async function adminApprove(db: Firestore, uid: Uid): Promise<void> {
  await runTransaction(db, async (tx) => {
    await requireStatus(tx, db, uid, 'pending');
    const group = (await tx.get(doc(db, GROUP))).data() as GroupDoc | undefined;
    if (!group) throw new Error('group/main is missing; run initGroup first');
    const req = await tx.get(doc(db, `joinRequests/${uid}`));
    if (req.exists()) tx.update(req.ref, { status: 'approved' });
    tx.update(doc(db, `users/${uid}`), { status: 'member' });
    tx.update(doc(db, GROUP), { memberCount: group.memberCount + 1, lastAdmitted: uid });
    tx.set(doc(db, MEMBERS), { uids: { [uid]: true } }, { merge: true });
  });
}

/** Rejects a pending user directly: request rejected, user rejected. */
export async function adminReject(db: Firestore, uid: Uid): Promise<void> {
  await runTransaction(db, async (tx) => {
    await requireStatus(tx, db, uid, 'pending');
    const req = await tx.get(doc(db, `joinRequests/${uid}`));
    if (req.exists()) tx.update(req.ref, { status: 'rejected' });
    tx.update(doc(db, `users/${uid}`), { status: 'rejected' });
  });
}

/**
 * Clears a rejection so she can request again: deletes her users doc, her join request, its
 * tally, and every voters and ballots doc under it, in one batch. Only for a rejected user
 * (a former member's users doc still names her on old bets).
 */
export async function clearRejection(db: Firestore, uid: Uid): Promise<void> {
  const user = (await getDoc(doc(db, `users/${uid}`))).data() as UserDoc | undefined;
  if (user?.status !== 'rejected') throw new Error(`${uid} is not rejected`);
  const jr = `joinRequests/${uid}`;
  const [voters, ballots] = await Promise.all([
    getDocs(collection(db, `${jr}/voters`)),
    getDocs(collection(db, `${jr}/ballots`)),
  ]);
  const b = writeBatch(db);
  for (const d of [...voters.docs, ...ballots.docs]) b.delete(d.ref);
  b.delete(doc(db, `${jr}/tally/counts`));
  b.delete(doc(db, jr));
  b.delete(doc(db, `users/${uid}`));
  await b.commit();
}

/** A Write's data with the DELETE sentinel turned into deleteField(). */
function fields(data: Record<string, unknown> = {}): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v === DELETE ? deleteField() : v]));
}

function apply(tx: Transaction, db: Firestore, w: Write): void {
  const ref = doc(db, w.path);
  if (w.op === 'delete') tx.delete(ref);
  else if (w.op === 'set') tx.set(ref, fields(w.data));
  else tx.update(ref, fields(w.data));
}

/**
 * Removes member `uid`: reads everything planRemoval needs, then commits its writes in one
 * transaction. Every doc whose value feeds an absolute write is read inside the transaction,
 * so a vote landing meanwhile makes it retry instead of being overwritten.
 */
export async function removeMember(db: Firestore, uid: Uid): Promise<void> {
  // Which docs to look at. Settled, paid, and void bets and decided requests need no writes.
  const [betList, joinList] = await Promise.all([
    getDocs(query(collection(db, 'bets'), where('status', 'in', ['proposed', 'active', 'voting']))),
    getDocs(query(collection(db, 'joinRequests'), where('status', '==', 'open'))),
  ]);

  await runTransaction(db, async (tx) => {
    await requireStatus(tx, db, uid, 'member');
    const group = (await tx.get(doc(db, GROUP))).data() as GroupDoc;
    // Before Upgrade data there may be no member list; upgradeData rebuilds it from users.
    const hasMembers = (await tx.get(doc(db, MEMBERS))).exists();

    const bets: RemovalInput['bets'] = [];
    for (const { id } of betList.docs) {
      const snap = await tx.get(doc(db, `bets/${id}`));
      if (!snap.exists()) continue;
      const bet = normalizeBet(snap.data());
      const entry: RemovalInput['bets'][number] = { id, bet };
      if (bet.voteStyle === 'anonymous' && bet.status === 'voting') {
        entry.tally = (await tx.get(doc(db, `bets/${id}/tally/counts`))).data() as BetTally | undefined;
        entry.ballot = (await tx.get(doc(db, `bets/${id}/ballots/${uid}`))).data() as Ballot<Side> | undefined;
      }
      bets.push(entry);
    }

    const joins: RemovalInput['joins'] = [];
    for (const { id: applicant } of joinList.docs) {
      const jr = `joinRequests/${applicant}`;
      const snap = await tx.get(doc(db, jr));
      if (!snap.exists()) continue;
      const tally = (await tx.get(doc(db, `${jr}/tally/counts`))).data() as JoinTally | undefined;
      const ballot = (await tx.get(doc(db, `${jr}/ballots/${uid}`))).data() as Ballot<'yes' | 'no'> | undefined;
      const voted = (await tx.get(doc(db, `${jr}/voters/${uid}`))).exists();
      joins.push({ applicant, req: snap.data() as JoinRequestDoc, tally: tally ?? { yes: 0, no: 0 }, ballot, voted });
    }

    for (const w of planRemoval({ uid, memberCount: group.memberCount, bets, joins })) {
      if (w.path === MEMBERS && !hasMembers) continue;
      apply(tx, db, w);
    }
  });
}

export type BetPatch = Partial<Pick<BetDoc, 'description' | 'stakeA' | 'stakeB' | 'subjects'>>;

const sameSet = (a: Uid[], b: Uid[]) => new Set(a).size === new Set(b).size && a.every((u) => b.includes(u));

/**
 * Edits a bet's description, stakes, or subjects. Text fields are trimmed and checked like
 * the propose form. Changed subjects get the propose checks: no one twice, no one on a side,
 * at most MAX_PEOPLE people in all, and anyone newly added a current member (in
 * group/members). Subjects already on the bet are never re-checked for membership, so a
 * removed member can stay the subject of a kept bet; unchanged subjects are not checked at all.
 */
export async function adminEditBet(db: Firestore, betId: string, patch: BetPatch): Promise<void> {
  const data: Record<string, unknown> = {};
  if (patch.description !== undefined) data.description = cleanText(patch.description, DESCRIPTION_MAX, 'Description');
  if (patch.stakeA !== undefined) data.stakeA = cleanText(patch.stakeA, STAKE_MAX, 'Stake A');
  if (patch.stakeB !== undefined) data.stakeB = cleanText(patch.stakeB, STAKE_MAX, 'Stake B');
  if (patch.subjects !== undefined) data.subjects = patch.subjects;
  if (Object.keys(data).length === 0) return;
  const ref = doc(db, `bets/${betId}`);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Bet not found');
    const subjects = patch.subjects;
    const bet = normalizeBet(snap.data());
    if (subjects !== undefined && !sameSet(subjects, bet.subjects)) {
      if (new Set(subjects).size !== subjects.length) throw new Error('A subject cannot be listed twice');
      const sides = everyone(bet);
      if (subjects.some((u) => sides.includes(u))) throw new Error('A subject cannot be on a side of the bet');
      if (sides.length + subjects.length > MAX_PEOPLE) throw new Error(`A bet can have at most ${MAX_PEOPLE} people`);
      const added = subjects.filter((u) => !bet.subjects.includes(u));
      if (added.length > 0) {
        const members = (await tx.get(doc(db, MEMBERS))).data() as MembersDoc | undefined;
        if (added.some((u) => members?.uids[u] !== true)) throw new Error('A subject must be a current member');
      }
    }
    tx.update(ref, data);
  });
}

/**
 * Marks `winner` paid on a settled bet for her (say she was removed before marking it):
 * she joins the end of paidBy, and the bet becomes paid once paidBy covers the whole winning
 * side, compared as sets like the rules. Refuses anyone not on the winning side. Does
 * nothing if she is already marked.
 */
export async function adminMarkPaidFor(db: Firestore, betId: string, winner: Uid): Promise<void> {
  const ref = doc(db, `bets/${betId}`);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Bet not found');
    const bet = normalizeBet(snap.data());
    if (bet.status !== 'settled' || (bet.winner !== 'A' && bet.winner !== 'B')) throw new Error('Only a settled bet can be marked paid');
    const won = bet.winner === 'A' ? bet.sideA : bet.sideB;
    if (!won.includes(winner)) throw new Error(`${winner} is not on the winning side`);
    if (bet.paidBy.includes(winner)) return;
    const paidBy = [...bet.paidBy, winner];
    tx.update(ref, { paidBy, status: sameSet(paidBy, won) ? 'paid' : 'settled' });
  });
}

/** Reads what needsUpgrade looks at: group/members, the users with status member, every bet. */
async function readUpgradeState(db: Firestore) {
  const [members, users, bets] = await Promise.all([
    getDoc(doc(db, MEMBERS)),
    getDocs(query(collection(db, 'users'), where('status', '==', 'member'))),
    getDocs(collection(db, 'bets')),
  ]);
  return { members, memberUsers: users.docs.map((d) => d.id), bets: bets.docs };
}

/** Whether the admin page should offer Upgrade data. */
export async function checkNeedsUpgrade(db: Firestore): Promise<boolean> {
  const { members, memberUsers, bets } = await readUpgradeState(db);
  return needsUpgrade({
    membersDocExists: members.exists(),
    listed: Object.keys((members.data() as MembersDoc | undefined)?.uids ?? {}),
    memberUsers,
    bets: bets.map((d) => d.data()),
  });
}

/** Firestore's limit on writes in one batch. */
const BATCH_MAX = 500;

/**
 * Upgrade data: overwrites group/members with exactly the users whose status is member (so
 * a missing, emptied, or stale list is repaired), and rewrites every old-format bet in the
 * new shape through normalizeBet, which drops `subject`. Safe to run again.
 */
export async function upgradeData(db: Firestore): Promise<{ members: number; bets: number }> {
  const { memberUsers, bets } = await readUpgradeState(db);
  const old = bets.filter((d) => isOldFormat(d.data()));
  const writes: Array<(b: ReturnType<typeof writeBatch>) => void> = [
    (b) => b.set(doc(db, MEMBERS), { uids: Object.fromEntries(memberUsers.map((u) => [u, true])) } satisfies MembersDoc),
    ...old.map((d) => (b: ReturnType<typeof writeBatch>) => b.set(d.ref, normalizeBet(d.data()))),
  ];
  for (let i = 0; i < writes.length; i += BATCH_MAX) {
    const b = writeBatch(db);
    for (const w of writes.slice(i, i + BATCH_MAX)) w(b);
    await b.commit();
  }
  return { members: memberUsers.length, bets: old.length };
}

/** Deletes any bet. An anonymous bet's tally and ballots go in the same batch. */
export async function adminDeleteBet(db: Firestore, betId: string): Promise<void> {
  const ref = doc(db, `bets/${betId}`);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const b = writeBatch(db);
  if ((snap.data() as BetDoc).voteStyle === 'anonymous') {
    for (const d of (await getDocs(collection(db, `bets/${betId}/ballots`))).docs) b.delete(d.ref);
    b.delete(doc(db, `bets/${betId}/tally/counts`));
  }
  b.delete(ref);
  await b.commit();
}

/**
 * Returns a settled or paid bet to voting with no winner and every vote cleared, so the
 * majority that settled it does not settle it again at once. Open: empty votesA and votesB.
 * Anonymous: every ballot deleted, tally zeroed, empty voters, voterCount 0. Ballots are
 * listed first; none can be added meanwhile, since a ballot needs the bet in voting.
 */
export async function adminReopenVote(db: Firestore, betId: string): Promise<void> {
  const ref = doc(db, `bets/${betId}`);
  const tallyRef = doc(db, `bets/${betId}/tally/counts`);
  const ballots = await getDocs(collection(db, `bets/${betId}/ballots`));
  await runTransaction(db, async (tx) => {
    const bet = (await tx.get(ref)).data() as BetDoc | undefined;
    if (bet?.status !== 'settled' && bet?.status !== 'paid') throw new Error('Only a settled or paid bet can be reopened');
    tx.update(ref, { status: 'voting', winner: null, votesA: {}, votesB: {}, voters: {}, voterCount: 0 });
    if (bet.voteStyle === 'anonymous') {
      for (const d of ballots.docs) tx.delete(d.ref);
      tx.set(tallyRef, { A: 0, B: 0 } satisfies BetTally);
    }
  });
}

/**
 * Clears `voter`'s vote on a bet. Open: her key leaves votesA and votesB. Anonymous: her
 * ballot is deleted and its choice taken off the tally, her voters key removed, voterCount -1.
 * Does nothing where she has no vote.
 */
export async function adminClearVote(db: Firestore, betId: string, voter: Uid): Promise<void> {
  const ref = doc(db, `bets/${betId}`);
  const ballotRef = doc(db, `bets/${betId}/ballots/${voter}`);
  const tallyRef = doc(db, `bets/${betId}/tally/counts`);
  await runTransaction(db, async (tx) => {
    const bet = (await tx.get(ref)).data() as BetDoc | undefined;
    if (!bet) return;
    if (bet.voteStyle === 'open') {
      if (voter in bet.votesA || voter in bet.votesB) {
        tx.update(ref, { [`votesA.${voter}`]: deleteField(), [`votesB.${voter}`]: deleteField() });
      }
      return;
    }
    const ballot = (await tx.get(ballotRef)).data() as Ballot<Side> | undefined;
    const tally = (await tx.get(tallyRef)).data() as BetTally | undefined;
    if (ballot) {
      tx.delete(ballotRef);
      if (tally) tx.update(tallyRef, { [ballot.choice]: tally[ballot.choice] - 1 });
    }
    if (voter in bet.voters) {
      tx.update(ref, { [`voters.${voter}`]: deleteField(), voterCount: bet.voterCount - 1 });
    }
  });
}

/** Renames any user. A pending user's join request name changes in the same write. */
export async function renameUser(db: Firestore, uid: Uid, displayName: string): Promise<void> {
  const name = cleanText(displayName, NAME_MAX, 'Display name');
  const userRef = doc(db, `users/${uid}`);
  await runTransaction(db, async (tx) => {
    const user = (await tx.get(userRef)).data() as UserDoc | undefined;
    if (!user) throw new Error(`${uid} has no user doc`);
    const req = user.status === 'pending' ? await tx.get(doc(db, `joinRequests/${uid}`)) : null;
    tx.update(userRef, { displayName: name });
    if (req?.exists()) tx.update(req.ref, { displayName: name });
  });
}
