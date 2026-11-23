import { doc, increment, runTransaction, serverTimestamp, writeBatch, type Firestore } from 'firebase/firestore';
import type { Ballot, Uid } from '../model/types';
import { attempt, cleanText } from './errors';

export type JoinChoice = 'yes' | 'no';

const NAME_MAX = 30;

const requestPath = (applicant: Uid) => `joinRequests/${applicant}`;

/** New user asks to join: her pending user doc, the open request, and its zero tally, in one batch. */
export async function requestToJoin(db: Firestore, uid: Uid, displayName: string): Promise<void> {
  const name = cleanText(displayName, NAME_MAX, 'Display name');
  const b = writeBatch(db);
  b.set(doc(db, `users/${uid}`), { status: 'pending', displayName: name, createdAt: serverTimestamp() });
  b.set(doc(db, requestPath(uid)), {
    displayName: name,
    status: 'open',
    voterCount: 0,
    createdAt: serverTimestamp(),
  });
  b.set(doc(db, `${requestPath(uid)}/tally/counts`), { yes: 0, no: 0 });
  await b.commit();
}

/**
 * Casts or changes `voter`'s join vote. Reads only her own ballot to choose the shape:
 * new (ballot + voters doc + voterCount +1 + tally +1) or changed (ballot + tally -1/+1).
 * Does nothing if her choice is unchanged. The hidden tally is moved with increment(), never read.
 */
export async function castJoinVote(db: Firestore, voter: Uid, applicant: Uid, choice: JoinChoice): Promise<void> {
  const jr = requestPath(applicant);
  const ballotRef = doc(db, `${jr}/ballots/${voter}`);
  const tallyRef = doc(db, `${jr}/tally/counts`);
  await runTransaction(db, async (tx) => {
    const ballot = await tx.get(ballotRef);
    if (ballot.exists()) {
      const prev = (ballot.data() as Ballot<JoinChoice>).choice;
      if (prev === choice) return;
      tx.update(ballotRef, { choice });
      tx.update(tallyRef, { [prev]: increment(-1), [choice]: increment(1) });
    } else {
      tx.set(ballotRef, { choice });
      tx.set(doc(db, `${jr}/voters/${voter}`), {});
      tx.update(doc(db, jr), { voterCount: increment(1) });
      tx.update(tallyRef, { [choice]: increment(1) });
    }
  });
}

/**
 * Tries to decide a join request: the approve batch, then the reject batch. The rules allow
 * each only with a strict majority, so a denial means "not decided" (or already decided)
 * and this returns null. Any other error is rethrown.
 */
export async function tryDecideJoin(db: Firestore, applicant: Uid): Promise<'approved' | 'rejected' | null> {
  const approved = await attempt(() => {
    const b = writeBatch(db);
    b.update(doc(db, requestPath(applicant)), { status: 'approved' });
    b.update(doc(db, `users/${applicant}`), { status: 'member' });
    b.update(doc(db, 'group/main'), { memberCount: increment(1), lastAdmitted: applicant });
    return b.commit();
  });
  if (approved) return 'approved';

  const rejected = await attempt(() => {
    const b = writeBatch(db);
    b.update(doc(db, requestPath(applicant)), { status: 'rejected' });
    b.update(doc(db, `users/${applicant}`), { status: 'rejected' });
    return b.commit();
  });
  return rejected ? 'rejected' : null;
}
