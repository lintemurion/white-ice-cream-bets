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
import { planRemoval, type RemovalInput, type Write } from '../model/removal';
import type { Ballot, BetDoc, BetTally, GroupDoc, JoinRequestDoc, JoinTally, Side, Uid, UserDoc } from '../model/types';
import { cleanText } from './errors';

// The admin's writes are unconstrained by the rules (except that he can never vote), so
// these functions keep the data consistent themselves: the same shapes members write,
// with absolute values read inside a transaction where a count could race a vote.

const NAME_MAX = 30;
const DESCRIPTION_MAX = 2000;
const STAKE_MAX = 500;

const GROUP = 'group/main';

/** Creates group/main with no members if it does not exist yet. */
export async function initGroup(db: Firestore): Promise<void> {
  const ref = doc(db, GROUP);
  await runTransaction(db, async (tx) => {
    if ((await tx.get(ref)).exists()) return;
    tx.set(ref, { memberCount: 0, lastAdmitted: null } satisfies GroupDoc);
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
 * approved, user member, memberCount +1 and lastAdmitted. Founding members come in this way.
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

function apply(tx: Transaction, db: Firestore, w: Write): void {
  const ref = doc(db, w.path);
  if (w.op === 'delete') tx.delete(ref);
  else if (w.op === 'set') tx.set(ref, w.data ?? {});
  else tx.update(ref, w.data ?? {});
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

    const bets: RemovalInput['bets'] = [];
    for (const { id } of betList.docs) {
      const snap = await tx.get(doc(db, `bets/${id}`));
      if (!snap.exists()) continue;
      const bet = snap.data() as BetDoc;
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

    for (const w of planRemoval({ uid, memberCount: group.memberCount, bets, joins })) apply(tx, db, w);
  });
}

export type BetPatch = Partial<Pick<BetDoc, 'description' | 'stakeA' | 'stakeB' | 'subject' | 'voteStyle' | 'status' | 'winner'>>;

/**
 * Edits any bet. Text fields are trimmed and checked like the propose form. Switching to
 * anonymous creates the zero tally if there is none, so members can still vote on it.
 */
export async function adminEditBet(db: Firestore, betId: string, patch: BetPatch): Promise<void> {
  const data: Record<string, unknown> = { ...patch };
  if (patch.description !== undefined) data.description = cleanText(patch.description, DESCRIPTION_MAX, 'Description');
  if (patch.stakeA !== undefined) data.stakeA = cleanText(patch.stakeA, STAKE_MAX, 'Stake A');
  if (patch.stakeB !== undefined) data.stakeB = cleanText(patch.stakeB, STAKE_MAX, 'Stake B');
  if (Object.keys(data).length === 0) return;
  const ref = doc(db, `bets/${betId}`);
  const tallyRef = doc(db, `bets/${betId}/tally/counts`);
  await runTransaction(db, async (tx) => {
    const tally = patch.voteStyle === 'anonymous' ? await tx.get(tallyRef) : null;
    const bet = patch.subject ? ((await tx.get(ref)).data() as BetDoc | undefined) : undefined;
    // A changed subject must be a current member and neither side. An unchanged one is never
    // re-checked: a removed member can still be the subject of a kept bet.
    if (patch.subject && patch.subject !== bet?.subject) {
      if (!bet) throw new Error('Bet not found');
      if (patch.subject === bet.sideA || patch.subject === bet.sideB) throw new Error('The subject cannot be a side of the bet');
      const subject = (await tx.get(doc(db, `users/${patch.subject}`))).data() as UserDoc | undefined;
      if (subject?.status !== 'member') throw new Error('The subject must be a current member');
    }
    tx.update(ref, data);
    if (tally && !tally.exists()) tx.set(tallyRef, { A: 0, B: 0 } satisfies BetTally);
  });
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
