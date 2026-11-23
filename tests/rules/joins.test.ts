import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  increment,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { dbAs, makeEnv, seed } from './helpers';

const MEMBERS = ['ava', 'jo', 'maya', 'priya', 'sam', 'zoe'];

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await makeEnv();
});
afterAll(async () => {
  await env.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
  await seed(env, { members: MEMBERS, pending: ['riley'], rejected: ['rex'], former: ['fay'] });
});

/** The exact request-to-join batch the client sends. */
function requestToJoin(db: Firestore, uid: string, displayName = 'Newbie') {
  const b = writeBatch(db);
  b.set(doc(db, `users/${uid}`), { status: 'pending', displayName, createdAt: serverTimestamp() });
  b.set(doc(db, `joinRequests/${uid}`), {
    displayName,
    status: 'open',
    voterCount: 0,
    createdAt: serverTimestamp(),
  });
  b.set(doc(db, `joinRequests/${uid}/tally/counts`), { yes: 0, no: 0 });
  return b.commit();
}

interface VoteOpts {
  ballotId?: string;
  ballot?: boolean;
  voters?: boolean;
  bump?: number;
}

/** The four-doc new-vote batch, with knobs to break it. */
function castJoinVote(db: Firestore, voter: string, applicant: string, choice: 'yes' | 'no', o: VoteOpts = {}) {
  const id = o.ballotId ?? voter;
  const jr = `joinRequests/${applicant}`;
  const b = writeBatch(db);
  if (o.ballot ?? true) b.set(doc(db, `${jr}/ballots/${id}`), { choice });
  if (o.voters ?? true) b.set(doc(db, `${jr}/voters/${id}`), {});
  b.update(doc(db, jr), { voterCount: increment(1) });
  b.update(doc(db, `${jr}/tally/counts`), { [choice]: increment(o.bump ?? 1) });
  return b.commit();
}

function changeJoinVote(db: Firestore, voter: string, applicant: string, from: 'yes' | 'no', to: 'yes' | 'no') {
  const jr = `joinRequests/${applicant}`;
  const b = writeBatch(db);
  b.update(doc(db, `${jr}/ballots/${voter}`), { choice: to });
  b.update(doc(db, `${jr}/tally/counts`), { [from]: increment(-1), [to]: increment(1) });
  return b.commit();
}

interface ApproveOpts {
  bump?: number;
  lastAdmitted?: string;
  /** Keys added to group/members.uids; false leaves group/members out of the batch. */
  add?: string[] | false;
  /** A key removed from group/members.uids in the same write. */
  remove?: string;
  value?: unknown;
}

/** The exact approve batch the client sends, with knobs to break it. */
function approve(db: Firestore, applicant: string, o: ApproveOpts = {}) {
  const b = writeBatch(db);
  b.update(doc(db, `joinRequests/${applicant}`), { status: 'approved' });
  b.update(doc(db, `users/${applicant}`), { status: 'member' });
  b.update(doc(db, 'group/main'), {
    memberCount: increment(o.bump ?? 1),
    lastAdmitted: o.lastAdmitted ?? applicant,
  });
  const add = o.add ?? [applicant];
  if (add !== false) {
    const patch: Record<string, unknown> = {};
    for (const uid of add) patch[`uids.${uid}`] = o.value ?? true;
    if (o.remove) patch[`uids.${o.remove}`] = deleteField();
    b.update(doc(db, 'group/members'), patch);
  }
  return b.commit();
}

function reject(db: Firestore, applicant: string) {
  const b = writeBatch(db);
  b.update(doc(db, `joinRequests/${applicant}`), { status: 'rejected' });
  b.update(doc(db, `users/${applicant}`), { status: 'rejected' });
  return b.commit();
}

/** Reads a doc with rules off. */
async function peek(path: string) {
  let data: Record<string, unknown> | undefined;
  await env.withSecurityRulesDisabled(async (ctx) => {
    data = (await getDoc(doc(ctx.firestore() as unknown as Firestore, path))).data();
  });
  return data;
}

const voteAll = async (choices: Array<'yes' | 'no'>) => {
  for (const [i, c] of choices.entries()) await castJoinVote(dbAs(env, MEMBERS[i]), MEMBERS[i], 'riley', c);
};

describe('join requests', () => {
  it('new user can request to join with the exact batch', async () => {
    await assertSucceeds(requestToJoin(dbAs(env, 'newbie'), 'newbie'));
    expect(await peek('users/newbie')).toMatchObject({ status: 'pending', displayName: 'Newbie' });
    expect(await peek('joinRequests/newbie')).toMatchObject({ status: 'open', voterCount: 0 });
    expect(await peek('joinRequests/newbie/tally/counts')).toEqual({ yes: 0, no: 0 });
  });

  it('rejected or former user cannot re-request', async () => {
    await assertFails(requestToJoin(dbAs(env, 'rex'), 'rex'));
    await assertFails(requestToJoin(dbAs(env, 'fay'), 'fay'));
  });

  it('admin cannot request to join', async () => {
    const db = dbAs(env, 'admin');
    await assertFails(requestToJoin(db, 'kyle'));
    await assertFails(
      setDoc(doc(db, 'users/kyle'), { status: 'pending', displayName: 'Kyle', createdAt: serverTimestamp() }),
    );
  });

  it('cannot create a request for someone else', () =>
    assertFails(requestToJoin(dbAs(env, 'newbie'), 'other')));

  it('cannot request with a bad status, a seeded tally, or a missing piece', async () => {
    const db = dbAs(env, 'newbie');
    const b1 = writeBatch(db);
    b1.set(doc(db, 'users/newbie'), { status: 'member', displayName: 'N', createdAt: serverTimestamp() });
    b1.set(doc(db, 'joinRequests/newbie'), { displayName: 'N', status: 'open', voterCount: 0, createdAt: serverTimestamp() });
    b1.set(doc(db, 'joinRequests/newbie/tally/counts'), { yes: 0, no: 0 });
    await assertFails(b1.commit());

    const b2 = writeBatch(db);
    b2.set(doc(db, 'users/newbie'), { status: 'pending', displayName: 'N', createdAt: serverTimestamp() });
    b2.set(doc(db, 'joinRequests/newbie'), { displayName: 'N', status: 'open', voterCount: 0, createdAt: serverTimestamp() });
    b2.set(doc(db, 'joinRequests/newbie/tally/counts'), { yes: 5, no: 0 });
    await assertFails(b2.commit());

    const b3 = writeBatch(db);
    b3.set(doc(db, 'users/newbie'), { status: 'pending', displayName: 'N', createdAt: serverTimestamp() });
    b3.set(doc(db, 'joinRequests/newbie'), { displayName: 'N', status: 'open', voterCount: 0, createdAt: serverTimestamp() });
    await assertFails(b3.commit());
  });
});

describe('join votes', () => {
  it('member casts a join vote with the four-doc batch', async () => {
    await assertSucceeds(castJoinVote(dbAs(env, 'ava'), 'ava', 'riley', 'yes'));
    expect(await peek('joinRequests/riley/tally/counts')).toEqual({ yes: 1, no: 0 });
    expect(await peek('joinRequests/riley')).toMatchObject({ voterCount: 1 });
  });

  it('cannot vote twice', async () => {
    await castJoinVote(dbAs(env, 'ava'), 'ava', 'riley', 'yes');
    await assertFails(castJoinVote(dbAs(env, 'ava'), 'ava', 'riley', 'yes'));
  });

  it('cannot vote as someone else', () =>
    assertFails(castJoinVote(dbAs(env, 'ava'), 'ava', 'riley', 'yes', { ballotId: 'jo' })));

  it('cannot bump the tally by 2 or without a ballot', async () => {
    await assertFails(castJoinVote(dbAs(env, 'ava'), 'ava', 'riley', 'yes', { bump: 2 }));
    await assertFails(castJoinVote(dbAs(env, 'ava'), 'ava', 'riley', 'yes', { ballot: false }));
  });

  it('new vote cannot also move the other tally field', async () => {
    const db = dbAs(env, 'ava');
    const b = writeBatch(db);
    b.set(doc(db, 'joinRequests/riley/ballots/ava'), { choice: 'yes' });
    b.set(doc(db, 'joinRequests/riley/voters/ava'), {});
    b.update(doc(db, 'joinRequests/riley'), { voterCount: increment(1) });
    b.update(doc(db, 'joinRequests/riley/tally/counts'), { yes: increment(1), no: increment(-1) });
    await assertFails(b.commit());
  });

  it('cannot bump voterCount without a voters doc', async () => {
    await assertFails(castJoinVote(dbAs(env, 'ava'), 'ava', 'riley', 'yes', { voters: false }));
    await assertFails(updateDoc(doc(dbAs(env, 'ava'), 'joinRequests/riley'), { voterCount: increment(1) }));
  });

  it('pending user cannot vote on her own request', () =>
    assertFails(castJoinVote(dbAs(env, 'riley'), 'riley', 'riley', 'yes')));

  it('admin cannot cast a join vote', () =>
    assertFails(castJoinVote(dbAs(env, 'admin'), 'kyle', 'riley', 'yes')));

  it('cannot vote on a request that is no longer open', async () => {
    await voteAll(['yes', 'yes', 'yes', 'yes']);
    await approve(dbAs(env, 'ava'), 'riley');
    await assertFails(castJoinVote(dbAs(env, 'sam'), 'sam', 'riley', 'yes'));
  });

  it('member can change her vote, tally moves -1/+1', async () => {
    await castJoinVote(dbAs(env, 'ava'), 'ava', 'riley', 'yes');
    await assertSucceeds(changeJoinVote(dbAs(env, 'ava'), 'ava', 'riley', 'yes', 'no'));
    expect(await peek('joinRequests/riley/tally/counts')).toEqual({ yes: 0, no: 1 });
    expect(await peek('joinRequests/riley/ballots/ava')).toEqual({ choice: 'no' });
  });

  it('changed vote cannot skip the -1 or move voterCount', async () => {
    await castJoinVote(dbAs(env, 'ava'), 'ava', 'riley', 'yes');
    const db = dbAs(env, 'ava');
    const b1 = writeBatch(db);
    b1.update(doc(db, 'joinRequests/riley/ballots/ava'), { choice: 'no' });
    b1.update(doc(db, 'joinRequests/riley/tally/counts'), { no: increment(1) });
    await assertFails(b1.commit());

    const b2 = writeBatch(db);
    b2.update(doc(db, 'joinRequests/riley/ballots/ava'), { choice: 'no' });
    b2.update(doc(db, 'joinRequests/riley/tally/counts'), { yes: increment(-1), no: increment(1) });
    b2.update(doc(db, 'joinRequests/riley'), { voterCount: increment(1) });
    await assertFails(b2.commit());
  });

  it('member cannot read another member ballot', async () => {
    await castJoinVote(dbAs(env, 'ava'), 'ava', 'riley', 'yes');
    await assertFails(getDoc(doc(dbAs(env, 'jo'), 'joinRequests/riley/ballots/ava')));
  });

  it('members cannot read tally while open and not everyone voted', async () => {
    await voteAll(['yes', 'yes', 'no', 'yes', 'no']);
    await assertFails(getDoc(doc(dbAs(env, 'ava'), 'joinRequests/riley/tally/counts')));
  });

  it('members can read tally once all 6 have voted', async () => {
    await voteAll(['yes', 'yes', 'no', 'yes', 'no', 'no']);
    const snap = await assertSucceeds(getDoc(doc(dbAs(env, 'ava'), 'joinRequests/riley/tally/counts')));
    expect(snap.data()).toEqual({ yes: 3, no: 3 });
  });

  it('members can still read tally if memberCount drops below voterCount', async () => {
    await voteAll(['yes', 'yes', 'no', 'yes', 'no']);
    await env.withSecurityRulesDisabled((ctx) =>
      updateDoc(doc(ctx.firestore() as unknown as Firestore, 'group/main'), { memberCount: 4 }),
    );
    await assertSucceeds(getDoc(doc(dbAs(env, 'ava'), 'joinRequests/riley/tally/counts')));
  });

  it('applicant cannot read tally, voters, or ballots even after deciding', async () => {
    await voteAll(['yes', 'yes', 'yes', 'yes']);
    await approve(dbAs(env, 'ava'), 'riley');
    const db = dbAs(env, 'riley');
    await assertFails(getDoc(doc(db, 'joinRequests/riley/tally/counts')));
    await assertFails(getDocs(collection(db, 'joinRequests/riley/voters')));
    await assertFails(getDocs(collection(db, 'joinRequests/riley/ballots')));
    await assertSucceeds(getDoc(doc(dbAs(env, 'jo'), 'joinRequests/riley/tally/counts')));
  });
});

describe('admission', () => {
  it('approve succeeds with 4 of 6 yes and bumps memberCount to 7', async () => {
    await voteAll(['yes', 'yes', 'yes', 'yes']);
    await assertSucceeds(approve(dbAs(env, 'jo'), 'riley'));
    expect(await peek('group/main')).toEqual({ memberCount: 7, lastAdmitted: 'riley' });
    expect(await peek('users/riley')).toMatchObject({ status: 'member' });
    expect(await peek('joinRequests/riley')).toMatchObject({ status: 'approved' });
  });

  it('approve denied with 3 of 6 yes', async () => {
    await voteAll(['yes', 'yes', 'yes', 'no']);
    await assertFails(approve(dbAs(env, 'jo'), 'riley'));
  });

  it('approve denied if memberCount bumped by 2 or lastAdmitted is a different uid', async () => {
    await seed(env, { members: MEMBERS, pending: ['riley', 'pia'], joinTallies: { riley: { yes: 4, no: 0 } } });
    await assertFails(approve(dbAs(env, 'jo'), 'riley', { bump: 2 }));
    await assertFails(approve(dbAs(env, 'jo'), 'riley', { lastAdmitted: 'pia' }));
  });

  it('approve batch that also bumps the tally is judged on the pre-batch tally', async () => {
    // 3 yes, 1 no: no majority yet. priya flips her no to yes inside the approve batch.
    await voteAll(['yes', 'yes', 'yes', 'no']);
    const db = dbAs(env, 'priya');
    const b = writeBatch(db);
    b.update(doc(db, 'joinRequests/riley/ballots/priya'), { choice: 'yes' });
    b.update(doc(db, 'joinRequests/riley/tally/counts'), { no: increment(-1), yes: increment(1) });
    b.update(doc(db, 'joinRequests/riley'), { status: 'approved' });
    b.update(doc(db, 'users/riley'), { status: 'member' });
    b.update(doc(db, 'group/main'), { memberCount: increment(1), lastAdmitted: 'riley' });
    b.update(doc(db, 'group/members'), { 'uids.riley': true });
    await assertFails(b.commit());
    // Done as two writes, the same steps succeed.
    await assertSucceeds(changeJoinVote(db, 'priya', 'riley', 'no', 'yes'));
    await assertSucceeds(approve(db, 'riley'));
  });

  it('two admissions in one batch cannot share a single +1', async () => {
    const yes4 = { yes: 4, no: 0 };
    await seed(env, { members: MEMBERS, pending: ['riley', 'pia'], joinTallies: { riley: yes4, pia: yes4 } });
    const db = dbAs(env, 'jo');
    const b = writeBatch(db);
    for (const uid of ['riley', 'pia']) {
      b.update(doc(db, `joinRequests/${uid}`), { status: 'approved' });
      b.update(doc(db, `users/${uid}`), { status: 'member' });
    }
    b.update(doc(db, 'group/main'), { memberCount: increment(1), lastAdmitted: 'riley' });
    b.update(doc(db, 'group/members'), { 'uids.riley': true, 'uids.pia': true });
    await assertFails(b.commit());
  });

  it('promoting a user to member without an approved request is denied', async () => {
    await seed(env, { members: MEMBERS, pending: ['riley'], joinTallies: { riley: { yes: 4, no: 0 } } });
    const db = dbAs(env, 'jo');
    const b = writeBatch(db);
    b.update(doc(db, 'users/riley'), { status: 'member' });
    b.update(doc(db, 'group/main'), { memberCount: increment(1), lastAdmitted: 'riley' });
    b.update(doc(db, 'group/members'), { 'uids.riley': true });
    await assertFails(b.commit());
  });

  it('reject succeeds with 4 of 6 no, user becomes rejected', async () => {
    await voteAll(['no', 'no', 'no', 'no']);
    await assertSucceeds(reject(dbAs(env, 'sam'), 'riley'));
    expect(await peek('users/riley')).toMatchObject({ status: 'rejected' });
    expect(await peek('joinRequests/riley')).toMatchObject({ status: 'rejected' });
    expect(await peek('group/main')).toEqual({ memberCount: 6, lastAdmitted: null });
  });

  it('reject denied with 3 of 6 no', async () => {
    await voteAll(['no', 'no', 'no', 'yes']);
    await assertFails(reject(dbAs(env, 'sam'), 'riley'));
  });

  it('admin can approve directly', async () => {
    await assertSucceeds(approve(dbAs(env, 'admin'), 'riley'));
  });
});

describe('member list (group/members)', () => {
  const yes4 = { yes: 4, no: 0 };
  const allUids = (extra: string[] = []) =>
    Object.fromEntries([...MEMBERS, ...extra].map((u) => [u, true]));

  it('approve batch must also add the admitted uid to group/members', async () => {
    await voteAll(['yes', 'yes', 'yes', 'yes']);
    await assertFails(approve(dbAs(env, 'jo'), 'riley', { add: false }));
    expect(await peek('users/riley')).toMatchObject({ status: 'pending' });
  });

  it('approve batch with members add succeeds; members doc has the new key', async () => {
    await voteAll(['yes', 'yes', 'yes', 'yes']);
    await assertSucceeds(approve(dbAs(env, 'jo'), 'riley'));
    expect(await peek('group/members')).toEqual({ uids: allUids(['riley']) });
  });

  it('cannot add a different uid, or two uids, to group/members', async () => {
    await seed(env, { members: MEMBERS, pending: ['riley', 'pia'], joinTallies: { riley: yes4 } });
    const db = dbAs(env, 'jo');
    await assertFails(approve(db, 'riley', { add: ['pia'] }));
    await assertFails(approve(db, 'riley', { add: ['riley', 'pia'] }));
    await assertFails(approve(db, 'riley', { add: ['riley', 'outsider'] }));
    await assertFails(approve(db, 'riley', { value: 'yes' }));
    expect(await peek('group/members')).toEqual({ uids: allUids() });
  });

  it('cannot add to group/members without the admission', async () => {
    await seed(env, { members: MEMBERS, pending: ['riley'], joinTallies: { riley: yes4 } });
    const db = dbAs(env, 'jo');
    await assertFails(updateDoc(doc(db, 'group/members'), { 'uids.riley': true }));
    await assertFails(updateDoc(doc(db, 'group/members'), { 'uids.outsider': true }));
    await assertFails(updateDoc(doc(dbAs(env, 'riley'), 'group/members'), { 'uids.riley': true }));
    // With group/main moved but users/riley left pending.
    const b = writeBatch(db);
    b.update(doc(db, 'group/main'), { memberCount: increment(1), lastAdmitted: 'riley' });
    b.update(doc(db, 'group/members'), { 'uids.riley': true });
    await assertFails(b.commit());
  });

  it('a stale lastAdmitted does not let a member re-add that uid to group/members', async () => {
    // fay was the last admitted and has since been removed (former); riley is pending.
    await seed(env, { members: MEMBERS, pending: ['riley'], former: ['fay'], joinTallies: { riley: yes4 } });
    for (const stale of ['fay', 'riley']) {
      await env.withSecurityRulesDisabled((ctx) =>
        updateDoc(doc(ctx.firestore() as unknown as Firestore, 'group/main'), { lastAdmitted: stale }),
      );
      await assertFails(updateDoc(doc(dbAs(env, 'jo'), 'group/members'), { [`uids.${stale}`]: true }));
    }
    expect(await peek('group/members')).toEqual({ uids: allUids() });

    // ava is a member whose key is missing; lastAdmitted names her. Only admission adds keys.
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await updateDoc(doc(db, 'group/main'), { lastAdmitted: 'ava' });
      await updateDoc(doc(db, 'group/members'), { 'uids.ava': deleteField() });
    });
    await assertFails(updateDoc(doc(dbAs(env, 'jo'), 'group/members'), { 'uids.ava': true }));
  });

  it('a key already in group/members does not let approve skip the members write', async () => {
    await seed(env, { members: MEMBERS, pending: ['riley'], joinTallies: { riley: yes4 } });
    await env.withSecurityRulesDisabled((ctx) =>
      updateDoc(doc(ctx.firestore() as unknown as Firestore, 'group/members'), { 'uids.riley': true }),
    );
    await assertFails(approve(dbAs(env, 'jo'), 'riley', { add: false }));
    await assertFails(approve(dbAs(env, 'jo'), 'riley'));
    expect(await peek('users/riley')).toMatchObject({ status: 'pending' });
  });

  it('cannot remove a key from group/members as a member', async () => {
    await seed(env, { members: MEMBERS, pending: ['riley'], joinTallies: { riley: yes4 } });
    const db = dbAs(env, 'jo');
    await assertFails(updateDoc(doc(db, 'group/members'), { 'uids.ava': deleteField() }));
    await assertFails(setDoc(doc(db, 'group/members'), { uids: {} }));
    await assertFails(approve(db, 'riley', { remove: 'ava' }));
    await assertFails(updateDoc(doc(db, 'group/members'), { 'uids.extra': true, other: 1 }));
    expect(await peek('group/members')).toEqual({ uids: allUids() });
  });

  it('members cannot create or delete group/members', async () => {
    await env.withSecurityRulesDisabled((ctx) =>
      deleteDoc(doc(ctx.firestore() as unknown as Firestore, 'group/members')),
    );
    await assertFails(setDoc(doc(dbAs(env, 'jo'), 'group/members'), { uids: { jo: true } }));
    await seed(env, { members: MEMBERS });
    await assertFails(deleteDoc(doc(dbAs(env, 'jo'), 'group/members')));
  });

  it('admin can write group/members directly', async () => {
    const db = dbAs(env, 'admin');
    await assertSucceeds(updateDoc(doc(db, 'group/members'), { 'uids.ava': deleteField() }));
    await assertSucceeds(setDoc(doc(db, 'group/members'), { uids: { jo: true } }));
    await assertSucceeds(deleteDoc(doc(db, 'group/members')));
    await assertSucceeds(setDoc(doc(db, 'group/members'), { uids: {} }));
  });
});

describe('display names', () => {
  it('member edits own displayName only; status change denied', async () => {
    const db = dbAs(env, 'ava');
    await assertSucceeds(updateDoc(doc(db, 'users/ava'), { displayName: 'Ava B' }));
    await assertSucceeds(updateDoc(doc(dbAs(env, 'riley'), 'users/riley'), { displayName: 'Riles' }));
    await assertFails(updateDoc(doc(db, 'users/ava'), { status: 'former' }));
    await assertFails(updateDoc(doc(dbAs(env, 'riley'), 'users/riley'), { status: 'member' }));
    await assertFails(updateDoc(doc(db, 'users/jo'), { displayName: 'Jo Jo' }));
    await assertFails(updateDoc(doc(dbAs(env, 'rex'), 'users/rex'), { displayName: 'Rex 2' }));
  });

  it('displayName over 30 chars or blank is denied', async () => {
    const db = dbAs(env, 'ava');
    await assertFails(updateDoc(doc(db, 'users/ava'), { displayName: 'x'.repeat(31) }));
    await assertFails(updateDoc(doc(db, 'users/ava'), { displayName: '   ' }));
    await assertFails(updateDoc(doc(db, 'users/ava'), { displayName: '' }));
    await assertSucceeds(updateDoc(doc(db, 'users/ava'), { displayName: 'x'.repeat(30) }));
    await assertFails(requestToJoin(dbAs(env, 'newbie'), 'newbie', 'x'.repeat(31)));
  });
});
