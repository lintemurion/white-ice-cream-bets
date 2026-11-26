import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { ADMIN_EMAIL, ADMIN_UID, dbAs, makeEnv, seed } from './helpers';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await makeEnv();
});
afterAll(async () => {
  await env.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
  await seed(env, {
    members: ['ava', 'jo', 'maya', 'priya', 'sam', 'zoe'],
    pending: ['riley'],
    rejected: ['rex'],
    former: ['fay'],
    bets: { b1: {} },
  });
});

describe('base access rules', () => {
  it('stranger cannot read anything', async () => {
    const db = dbAs(env, null);
    await assertFails(getDoc(doc(db, 'bets/b1')));
    await assertFails(getDoc(doc(db, 'group/main')));
    await assertFails(getDoc(doc(db, 'users/ava')));
    await assertFails(getDoc(doc(db, 'joinRequests/riley')));
  });

  it('signed-in non-member cannot read bets, users, or join requests', async () => {
    await assertFails(getDoc(doc(dbAs(env, 'riley'), 'bets/b1')));
    await assertFails(getDocs(collection(dbAs(env, 'riley'), 'users')));
    await assertFails(getDoc(doc(dbAs(env, 'riley'), 'joinRequests/other')));
  });

  it('pending user reads only her own user doc and join request', async () => {
    await assertSucceeds(getDoc(doc(dbAs(env, 'riley'), 'users/riley')));
    await assertSucceeds(getDoc(doc(dbAs(env, 'riley'), 'joinRequests/riley')));
    await assertFails(getDoc(doc(dbAs(env, 'riley'), 'users/ava')));
    await assertFails(getDocs(collection(dbAs(env, 'riley'), 'joinRequests/riley/voters')));
    await assertFails(getDoc(doc(dbAs(env, 'riley'), 'joinRequests/riley/tally/counts')));
  });

  it('rejected and former users read only their own user doc', async () => {
    await assertSucceeds(getDoc(doc(dbAs(env, 'fay'), 'users/fay')));
    await assertSucceeds(getDoc(doc(dbAs(env, 'rex'), 'users/rex')));
    await assertFails(getDoc(doc(dbAs(env, 'fay'), 'bets/b1')));
    await assertFails(getDoc(doc(dbAs(env, 'rex'), 'bets/b1')));
    await assertFails(getDoc(doc(dbAs(env, 'fay'), 'users/ava')));
    await assertFails(getDoc(doc(dbAs(env, 'rex'), 'group/main')));
  });

  it('member reads bets, users, group, join requests and their voter lists', async () => {
    const db = dbAs(env, 'ava');
    await assertSucceeds(getDoc(doc(db, 'bets/b1')));
    await assertSucceeds(getDocs(collection(db, 'users')));
    await assertSucceeds(getDoc(doc(db, 'group/main')));
    await assertSucceeds(getDoc(doc(db, 'joinRequests/riley')));
    await assertSucceeds(getDocs(collection(db, 'joinRequests/riley/voters')));
  });

  it('member cannot read tallies or other members ballots', async () => {
    const db = dbAs(env, 'ava');
    await assertFails(getDoc(doc(db, 'joinRequests/riley/tally/counts')));
    await assertFails(getDoc(doc(db, 'bets/b1/tally/counts')));
    await assertFails(getDoc(doc(db, 'joinRequests/riley/ballots/jo')));
    await assertFails(getDoc(doc(db, 'bets/b1/ballots/jo')));
  });

  it('voter reads her own ballots', async () => {
    const db = dbAs(env, 'ava');
    await assertSucceeds(getDoc(doc(db, 'joinRequests/riley/ballots/ava')));
    await assertSucceeds(getDoc(doc(db, 'bets/b1/ballots/ava')));
  });

  it('members and admin read group/members; pending and strangers cannot', async () => {
    await assertSucceeds(getDoc(doc(dbAs(env, 'ava'), 'group/members')));
    await assertSucceeds(getDoc(doc(dbAs(env, 'admin'), 'group/members')));
    await assertFails(getDoc(doc(dbAs(env, 'riley'), 'group/members')));
    await assertFails(getDoc(doc(dbAs(env, 'rex'), 'group/members')));
    await assertFails(getDoc(doc(dbAs(env, 'fay'), 'group/members')));
    await assertFails(getDoc(doc(dbAs(env, 'newbie'), 'group/members')));
    await assertFails(getDoc(doc(dbAs(env, null), 'group/members')));
  });

  it('pending user can read group/main', () =>
    assertSucceeds(getDoc(doc(dbAs(env, 'riley'), 'group/main'))));

  it('admin reads everything including tallies and ballots', async () => {
    const db = dbAs(env, 'admin');
    await assertSucceeds(getDoc(doc(db, 'group/main')));
    await assertSucceeds(getDocs(collection(db, 'users')));
    await assertSucceeds(getDoc(doc(db, 'joinRequests/riley')));
    await assertSucceeds(getDocs(collection(db, 'joinRequests/riley/voters')));
    await assertSucceeds(getDocs(collection(db, 'joinRequests/riley/ballots')));
    await assertSucceeds(getDoc(doc(db, 'joinRequests/riley/tally/counts')));
    await assertSucceeds(getDoc(doc(db, 'bets/b1')));
    await assertSucceeds(getDocs(collection(db, 'bets/b1/ballots')));
    await assertSucceeds(getDoc(doc(db, 'bets/b1/tally/counts')));
  });

  it('admin email without email_verified is not admin', async () => {
    const db = env.authenticatedContext(ADMIN_UID, { email: ADMIN_EMAIL }).firestore();
    await assertFails(getDoc(doc(db, 'bets/b1')));
    await assertFails(getDoc(doc(db, 'joinRequests/riley/tally/counts')));
    await assertFails(setDoc(doc(db, 'group/main'), { memberCount: 99, lastAdmitted: null }));
  });

  it('admin email matches regardless of case, like the client check', async () => {
    const db = env
      .authenticatedContext(ADMIN_UID, { email: ADMIN_EMAIL.toUpperCase(), email_verified: true })
      .firestore();
    await assertSucceeds(getDoc(doc(db, 'joinRequests/riley/tally/counts')));
    await assertSucceeds(setDoc(doc(db, 'group/main'), { memberCount: 6, lastAdmitted: null }));
  });

  it('a member token with no email is still a member, and never the admin', async () => {
    const db = env.authenticatedContext('ava', {}).firestore();
    await assertSucceeds(getDoc(doc(db, 'bets/b1')));
    await assertFails(setDoc(doc(db, 'group/main'), { memberCount: 99, lastAdmitted: null }));
  });

  it('nobody but admin writes group/main directly', async () => {
    await assertFails(
      setDoc(doc(dbAs(env, 'ava'), 'group/main'), { memberCount: 99, lastAdmitted: null }),
    );
    await assertSucceeds(
      setDoc(doc(dbAs(env, 'admin'), 'group/main'), { memberCount: 6, lastAdmitted: null }),
    );
  });

  it('non-admin cannot write other users, join requests, or bets directly', async () => {
    await assertFails(setDoc(doc(dbAs(env, 'ava'), 'users/jo'), { status: 'former', displayName: 'jo' }));
    await assertFails(
      setDoc(doc(dbAs(env, 'ava'), 'joinRequests/riley'), { status: 'approved', voterCount: 6 }),
    );
    await assertFails(setDoc(doc(dbAs(env, 'riley'), 'bets/b1'), { status: 'void' }));
  });

  it('paths outside the data layout are denied', async () => {
    await assertFails(getDoc(doc(dbAs(env, 'ava'), 'secrets/x')));
    await assertFails(setDoc(doc(dbAs(env, 'ava'), 'secrets/x'), { a: 1 }));
  });
});
