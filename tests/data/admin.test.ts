import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, type Firestore } from 'firebase/firestore';
import {
  adminApprove,
  adminClearVote,
  adminDeleteBet,
  adminEditBet,
  adminReject,
  adminReopenVote,
  clearRejection,
  initGroup,
  removeMember,
  renameUser,
} from '../../src/data/admin';
import { castAnonVote, castOpenVote, trySettle } from '../../src/data/bets';
import { castJoinVote, requestToJoin } from '../../src/data/joins';
import { dbAs, makeEnv, seed } from '../rules/helpers';

const MEMBERS = ['ava', 'jo', 'maya', 'priya', 'sam', 'zoe'];

let env: RulesTestEnvironment;
let admin: Firestore;

beforeAll(async () => {
  env = await makeEnv();
});
afterAll(async () => {
  await env.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
  admin = dbAs(env, 'admin');
});

/** Reads a doc with rules off. */
async function peek(path: string) {
  let data: Record<string, unknown> | undefined;
  await env.withSecurityRulesDisabled(async (ctx) => {
    data = (await getDoc(doc(ctx.firestore() as unknown as Firestore, path))).data();
  });
  return data;
}

/** Ids in a collection, read with rules off. */
async function ids(path: string) {
  let out: string[] = [];
  await env.withSecurityRulesDisabled(async (ctx) => {
    out = (await getDocs(collection(ctx.firestore() as unknown as Firestore, path))).docs.map((d) => d.id).sort();
  });
  return out;
}

const as = (uid: string) => dbAs(env, uid);

describe('admin data layer', () => {
  it('initGroup creates group/main once', async () => {
    await initGroup(admin);
    expect(await peek('group/main')).toEqual({ memberCount: 0, lastAdmitted: null });

    await env.withSecurityRulesDisabled((ctx) =>
      setDoc(doc(ctx.firestore() as unknown as Firestore, 'group/main'), { memberCount: 3, lastAdmitted: 'ava' }),
    );
    await initGroup(admin);
    expect(await peek('group/main')).toEqual({ memberCount: 3, lastAdmitted: 'ava' });
  });

  it('adminApprove makes a pending user a member and bumps memberCount', async () => {
    await initGroup(admin);
    await requestToJoin(as('ava'), 'ava', 'Ava');
    await adminApprove(admin, 'ava');
    expect(await peek('users/ava')).toMatchObject({ status: 'member' });
    expect(await peek('joinRequests/ava')).toMatchObject({ status: 'approved' });
    expect(await peek('group/main')).toEqual({ memberCount: 1, lastAdmitted: 'ava' });

    // Not pending any more: a second approve does not count her twice.
    await expect(adminApprove(admin, 'ava')).rejects.toThrow(/pending/);
    expect(await peek('group/main')).toMatchObject({ memberCount: 1 });
  });

  it('adminReject rejects a pending user and leaves memberCount alone', async () => {
    await seed(env, { members: MEMBERS, pending: ['riley'] });
    await adminReject(admin, 'riley');
    expect(await peek('users/riley')).toMatchObject({ status: 'rejected' });
    expect(await peek('joinRequests/riley')).toMatchObject({ status: 'rejected' });
    expect(await peek('group/main')).toMatchObject({ memberCount: 6 });
  });

  it('clearRejection lets a rejected user request again', async () => {
    await seed(env, { members: MEMBERS });
    await requestToJoin(as('riley'), 'riley', 'Riley');
    for (const m of ['ava', 'jo', 'maya', 'priya']) await castJoinVote(as(m), m, 'riley', 'no');
    await adminReject(admin, 'riley');
    await assertFails(requestToJoin(as('riley'), 'riley', 'Riley'));

    await clearRejection(admin, 'riley');
    expect(await peek('users/riley')).toBeUndefined();
    expect(await peek('joinRequests/riley')).toBeUndefined();
    expect(await peek('joinRequests/riley/tally/counts')).toBeUndefined();
    expect(await ids('joinRequests/riley/voters')).toEqual([]);
    expect(await ids('joinRequests/riley/ballots')).toEqual([]);

    await requestToJoin(as('riley'), 'riley', 'Riley');
    expect(await peek('joinRequests/riley')).toMatchObject({ status: 'open', voterCount: 0 });
    expect(await peek('joinRequests/riley/tally/counts')).toEqual({ yes: 0, no: 0 });
  });

  it('clearRejection refuses a user who is not rejected', async () => {
    await seed(env, { members: MEMBERS });
    await expect(clearRejection(admin, 'ava')).rejects.toThrow(/rejected/);
    expect(await peek('users/ava')).toMatchObject({ status: 'member' });
  });

  it('removeMember commits the planned batch; removed user can no longer read bets', async () => {
    await seed(env, {
      members: MEMBERS,
      bets: {
        open1: { status: 'voting', votesA: { ava: true, jo: true }, votesB: { zoe: true } },
        anon1: { status: 'voting', voteStyle: 'anonymous' },
        void1: { status: 'active', sideB: 'zoe' },
      },
      betTallies: { anon1: { A: 0, B: 0 } },
    });
    await requestToJoin(as('riley'), 'riley', 'Riley');
    for (const m of ['ava', 'jo', 'maya']) await castJoinVote(as(m), m, 'riley', 'yes');
    await castJoinVote(as('zoe'), 'zoe', 'riley', 'no');
    for (const m of ['ava', 'jo']) await castAnonVote(as(m), m, 'anon1', 'A');
    await castAnonVote(as('zoe'), 'zoe', 'anon1', 'B');
    await castOpenVote(as('maya'), 'maya', 'open1', 'A');
    await assertSucceeds(getDocs(collection(as('zoe'), 'bets')));

    await removeMember(admin, 'zoe');

    expect(await peek('users/zoe')).toMatchObject({ status: 'former' });
    // 6 -> 5, then riley's 3 yes beat 5 and she is admitted: 6.
    expect(await peek('group/main')).toEqual({ memberCount: 6, lastAdmitted: 'riley' });
    expect(await peek('users/riley')).toMatchObject({ status: 'member' });
    expect(await peek('joinRequests/riley')).toMatchObject({ status: 'approved', voterCount: 3 });
    expect(await peek('joinRequests/riley/tally/counts')).toEqual({ yes: 3, no: 0 });
    expect(await ids('joinRequests/riley/ballots')).toEqual(['ava', 'jo', 'maya']);
    expect(await ids('joinRequests/riley/voters')).toEqual(['ava', 'jo', 'maya']);
    // 3 A against 6 after the admission: still voting, her B vote gone.
    expect(await peek('bets/open1')).toMatchObject({
      status: 'voting',
      votesA: { ava: true, jo: true, maya: true },
      votesB: {},
    });
    expect(await peek('bets/anon1')).toMatchObject({ status: 'voting', voters: { ava: true, jo: true }, voterCount: 2 });
    expect(await peek('bets/anon1/tally/counts')).toEqual({ A: 2, B: 0 });
    expect(await peek('bets/anon1/ballots/zoe')).toBeUndefined();
    expect(await peek('bets/void1')).toMatchObject({ status: 'void' });

    await assertFails(getDocs(collection(as('zoe'), 'bets')));
    await assertFails(getDoc(doc(as('zoe'), 'bets/open1')));
  });

  it('removeMember settles a bet whose majority now holds', async () => {
    await seed(env, {
      members: MEMBERS,
      bets: { open1: { status: 'voting', votesA: { ava: true, jo: true, maya: true }, votesB: { zoe: true } } },
    });
    await removeMember(admin, 'zoe');
    expect(await peek('group/main')).toEqual({ memberCount: 5, lastAdmitted: null });
    expect(await peek('bets/open1')).toMatchObject({ status: 'settled', winner: 'A', votesB: {} });
  });

  it('removeMember refuses a uid that is not a member', async () => {
    await seed(env, { members: MEMBERS, former: ['tess'] });
    await expect(removeMember(admin, 'tess')).rejects.toThrow(/member/);
    expect(await peek('group/main')).toMatchObject({ memberCount: 6 });
  });

  it('adminReopenVote returns a settled bet to voting', async () => {
    await seed(env, {
      members: MEMBERS,
      bets: {
        s1: { status: 'settled', winner: 'A', votesA: { ava: true, jo: true, maya: true, priya: true } },
        p1: { status: 'paid', winner: 'B' },
        a1: { status: 'active' },
      },
    });
    await adminReopenVote(admin, 's1');
    expect(await peek('bets/s1')).toMatchObject({ status: 'voting', winner: null });
    await adminReopenVote(admin, 'p1');
    expect(await peek('bets/p1')).toMatchObject({ status: 'voting', winner: null });
    await expect(adminReopenVote(admin, 'a1')).rejects.toThrow(/settled or paid/);
    expect(await peek('bets/a1')).toMatchObject({ status: 'active' });
  });

  it('adminReopenVote on a settled open bet clears the votes, so trySettle returns null', async () => {
    await seed(env, {
      members: MEMBERS,
      bets: { s1: { status: 'settled', winner: 'A', votesA: { ava: true, jo: true, maya: true, priya: true }, votesB: { sam: true } } },
    });
    await adminReopenVote(admin, 's1');
    expect(await peek('bets/s1')).toMatchObject({ status: 'voting', winner: null, votesA: {}, votesB: {} });
    expect(await trySettle(as('ava'), 's1')).toBeNull();
    expect(await peek('bets/s1')).toMatchObject({ status: 'voting' });
  });

  it('adminReopenVote on a settled anonymous bet deletes ballots, zeroes the tally, and allows a fresh vote', async () => {
    await seed(env, {
      members: MEMBERS,
      bets: { anon1: { status: 'voting', voteStyle: 'anonymous' } },
      betTallies: { anon1: { A: 0, B: 0 } },
    });
    for (const m of ['ava', 'jo', 'maya', 'priya']) await castAnonVote(as(m), m, 'anon1', 'A');
    expect(await trySettle(as('ava'), 'anon1')).toBe('A');

    await adminReopenVote(admin, 'anon1');
    expect(await peek('bets/anon1')).toMatchObject({ status: 'voting', winner: null, voters: {}, voterCount: 0 });
    expect(await peek('bets/anon1/tally/counts')).toEqual({ A: 0, B: 0 });
    expect(await ids('bets/anon1/ballots')).toEqual([]);
    expect(await trySettle(as('ava'), 'anon1')).toBeNull();

    await castAnonVote(as('ava'), 'ava', 'anon1', 'B');
    expect(await peek('bets/anon1')).toMatchObject({ voters: { ava: true }, voterCount: 1 });
    expect(await peek('bets/anon1/tally/counts')).toEqual({ A: 0, B: 1 });
    expect(await peek('bets/anon1/ballots/ava')).toEqual({ choice: 'B' });
  });

  it('adminClearVote on an anonymous bet keeps tally and voterCount consistent', async () => {
    await seed(env, {
      members: MEMBERS,
      bets: { anon1: { status: 'voting', voteStyle: 'anonymous' } },
      betTallies: { anon1: { A: 0, B: 0 } },
    });
    await castAnonVote(as('ava'), 'ava', 'anon1', 'A');
    await castAnonVote(as('jo'), 'jo', 'anon1', 'B');

    await adminClearVote(admin, 'anon1', 'jo');
    expect(await peek('bets/anon1')).toMatchObject({ voters: { ava: true }, voterCount: 1 });
    expect(await peek('bets/anon1/tally/counts')).toEqual({ A: 1, B: 0 });
    expect(await peek('bets/anon1/ballots/jo')).toBeUndefined();

    // Clearing a vote that is not there changes nothing; she can vote again afterwards.
    await adminClearVote(admin, 'anon1', 'jo');
    expect(await peek('bets/anon1/tally/counts')).toEqual({ A: 1, B: 0 });
    await castAnonVote(as('jo'), 'jo', 'anon1', 'A');
    expect(await peek('bets/anon1')).toMatchObject({ voterCount: 2 });
    expect(await peek('bets/anon1/tally/counts')).toEqual({ A: 2, B: 0 });
  });

  it('adminClearVote on an open bet removes her key from both maps', async () => {
    await seed(env, {
      members: MEMBERS,
      bets: { open1: { status: 'voting', votesA: { ava: true }, votesB: { jo: true } } },
    });
    await adminClearVote(admin, 'open1', 'jo');
    expect(await peek('bets/open1')).toMatchObject({ votesA: { ava: true }, votesB: {} });
  });

  it('adminDeleteBet deletes an anonymous bet with its tally and ballots', async () => {
    await seed(env, {
      members: MEMBERS,
      bets: { anon1: { status: 'voting', voteStyle: 'anonymous' }, open1: {} },
      betTallies: { anon1: { A: 0, B: 0 } },
    });
    await castAnonVote(as('ava'), 'ava', 'anon1', 'A');
    await adminDeleteBet(admin, 'anon1');
    expect(await peek('bets/anon1')).toBeUndefined();
    expect(await peek('bets/anon1/tally/counts')).toBeUndefined();
    expect(await ids('bets/anon1/ballots')).toEqual([]);

    await adminDeleteBet(admin, 'open1');
    expect(await peek('bets/open1')).toBeUndefined();
  });

  it('adminEditBet trims and checks text, and writes the patch', async () => {
    await seed(env, { members: MEMBERS, bets: { b1: { status: 'active' } } });
    await adminEditBet(admin, 'b1', { description: '  Snow before Dec 1  ', stakeB: ' a ride ', voteStyle: 'anonymous' });
    expect(await peek('bets/b1')).toMatchObject({ description: 'Snow before Dec 1', stakeB: 'a ride', voteStyle: 'anonymous' });
    await expect(adminEditBet(admin, 'b1', { stakeA: '   ' })).rejects.toThrow(/blank/);
    await expect(adminEditBet(admin, 'b1', { description: 'x'.repeat(2001) })).rejects.toThrow(/2000/);
    expect(await peek('bets/b1')).toMatchObject({ stakeA: '$5' });
  });

  it('adminEditBet rejects a subject that is a side or not a member', async () => {
    await seed(env, { members: MEMBERS, bets: { b1: { status: 'active' } } });
    const { sideA, sideB } = (await peek('bets/b1')) as { sideA: string; sideB: string };
    await expect(adminEditBet(admin, 'b1', { subject: sideA })).rejects.toThrow(/side/);
    await expect(adminEditBet(admin, 'b1', { subject: sideB })).rejects.toThrow(/side/);
    await expect(adminEditBet(admin, 'b1', { subject: 'nobody' })).rejects.toThrow(/member/);
    const other = MEMBERS.find((m) => m !== sideA && m !== sideB)!;
    await adminEditBet(admin, 'b1', { subject: other });
    expect(await peek('bets/b1')).toMatchObject({ subject: other });
  });

  it('adminEditBet does not re-check an unchanged subject who is now a former member', async () => {
    await seed(env, { members: MEMBERS, former: ['gone'], bets: { b1: { status: 'settled', winner: 'A', subject: 'gone' } } });
    await adminEditBet(admin, 'b1', { description: 'Fixed text' });
    await adminEditBet(admin, 'b1', { description: 'Fixed again', subject: 'gone' });
    expect(await peek('bets/b1')).toMatchObject({ description: 'Fixed again', subject: 'gone' });
  });

  it('adminEditBet switching a bet to anonymous gives it a zero tally so members can vote', async () => {
    await seed(env, { members: MEMBERS, bets: { b1: { status: 'voting' } } });
    await adminEditBet(admin, 'b1', { voteStyle: 'anonymous' });
    expect(await peek('bets/b1/tally/counts')).toEqual({ A: 0, B: 0 });
    await castAnonVote(as('ava'), 'ava', 'b1', 'A');
    expect(await peek('bets/b1/tally/counts')).toEqual({ A: 1, B: 0 });

    // An existing tally is kept.
    await adminEditBet(admin, 'b1', { voteStyle: 'anonymous' });
    expect(await peek('bets/b1/tally/counts')).toEqual({ A: 1, B: 0 });
  });

  it('renameUser trims, checks, and keeps a pending request name in step', async () => {
    await seed(env, { members: MEMBERS, pending: ['riley'] });
    await renameUser(admin, 'riley', '  Ri  ');
    expect(await peek('users/riley')).toMatchObject({ displayName: 'Ri' });
    expect(await peek('joinRequests/riley')).toMatchObject({ displayName: 'Ri' });

    await renameUser(admin, 'ava', 'Ava B');
    expect(await peek('users/ava')).toMatchObject({ displayName: 'Ava B' });
    expect(await peek('joinRequests/ava')).toBeUndefined();

    await expect(renameUser(admin, 'ava', 'x'.repeat(31))).rejects.toThrow(/30/);
  });
});
