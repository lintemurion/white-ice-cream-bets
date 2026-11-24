import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, Timestamp, type Firestore } from 'firebase/firestore';
import {
  adminApprove,
  adminClearVote,
  adminDeleteBet,
  adminEditBet,
  adminMarkPaidFor,
  adminReject,
  adminReopenVote,
  checkNeedsUpgrade,
  clearRejection,
  initGroup,
  removeMember,
  renameUser,
  upgradeData,
} from '../../src/data/admin';
import { castAnonVote, castOpenVote, markIGotPaid, trySettle } from '../../src/data/bets';
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

/** Writes a doc as given, with rules off (for old-format bets the seed helper would reshape). */
async function put(path: string, data: Record<string, unknown>) {
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore() as unknown as Firestore, path), data));
}

/** A bet as written before team bets: single-id sides, `subject`, no confirmed or paidBy. */
function oldBet(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    description: 'Old bet',
    sideA: 'ava',
    sideB: 'jo',
    subject: 'maya',
    stakeA: '$5',
    stakeB: '$5',
    voteStyle: 'open',
    status: 'active',
    winner: null,
    createdBy: 'ava',
    createdAt: Timestamp.fromMillis(Date.UTC(2026, 0, 1)),
    votesA: {},
    votesB: {},
    voters: {},
    voterCount: 0,
    ...over,
  };
}

describe('admin data layer', () => {
  it('initGroup creates group/main and group/members once', async () => {
    await initGroup(admin);
    expect(await peek('group/main')).toEqual({ memberCount: 0, lastAdmitted: null });
    expect(await peek('group/members')).toEqual({ uids: {} });

    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, 'group/main'), { memberCount: 3, lastAdmitted: 'ava' });
      await setDoc(doc(db, 'group/members'), { uids: { ava: true } });
    });
    await initGroup(admin);
    expect(await peek('group/main')).toEqual({ memberCount: 3, lastAdmitted: 'ava' });
    expect(await peek('group/members')).toEqual({ uids: { ava: true } });
  });

  it('initGroup adds a missing group/members next to an existing group/main', async () => {
    await env.withSecurityRulesDisabled((ctx) =>
      setDoc(doc(ctx.firestore() as unknown as Firestore, 'group/main'), { memberCount: 3, lastAdmitted: 'ava' }),
    );
    await initGroup(admin);
    expect(await peek('group/main')).toEqual({ memberCount: 3, lastAdmitted: 'ava' });
    expect(await peek('group/members')).toEqual({ uids: {} });
  });

  it('adminApprove makes a pending user a member and bumps memberCount', async () => {
    await initGroup(admin);
    await requestToJoin(as('ava'), 'ava', 'Ava');
    await adminApprove(admin, 'ava');
    expect(await peek('users/ava')).toMatchObject({ status: 'member' });
    expect(await peek('joinRequests/ava')).toMatchObject({ status: 'approved' });
    expect(await peek('group/main')).toEqual({ memberCount: 1, lastAdmitted: 'ava' });
    expect(await peek('group/members')).toEqual({ uids: { ava: true } });

    // Not pending any more: a second approve does not count her twice.
    await expect(adminApprove(admin, 'ava')).rejects.toThrow(/pending/);
    expect(await peek('group/main')).toMatchObject({ memberCount: 1 });
  });

  it('adminApprove refuses before Upgrade data (no group/members) and writes nothing', async () => {
    await env.withSecurityRulesDisabled((ctx) =>
      setDoc(doc(ctx.firestore() as unknown as Firestore, 'group/main'), { memberCount: 3, lastAdmitted: 'jo' }),
    );
    await requestToJoin(as('ava'), 'ava', 'Ava');
    await expect(adminApprove(admin, 'ava')).rejects.toThrow('Press Upgrade data first, then approve.');
    expect(await peek('group/members')).toBeUndefined();
    expect(await peek('group/main')).toEqual({ memberCount: 3, lastAdmitted: 'jo' });
    expect(await peek('users/ava')).toMatchObject({ status: 'pending' });
    expect(await peek('joinRequests/ava')).toMatchObject({ status: 'open' });
  });

  it('adminReject rejects a pending user and leaves memberCount alone', async () => {
    await seed(env, { members: MEMBERS, pending: ['riley'] });
    await adminReject(admin, 'riley');
    expect(await peek('users/riley')).toMatchObject({ status: 'rejected' });
    expect(await peek('joinRequests/riley')).toMatchObject({ status: 'rejected' });
    expect(await peek('group/main')).toMatchObject({ memberCount: 6 });
    expect(await peek('group/members')).not.toHaveProperty('uids.riley');
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
        void1: { status: 'active', sideB: ['zoe'], confirmed: ['ava', 'zoe'] },
        team1: { status: 'active', sideA: ['ava', 'zoe'], confirmed: ['ava', 'zoe', 'jo'] },
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
    expect(await peek('bets/void1')).toMatchObject({ status: 'void', sideB: [] });
    expect(await peek('bets/team1')).toMatchObject({ status: 'active', sideA: ['ava'], confirmed: ['ava', 'jo'] });
    expect(await peek('group/members')).not.toHaveProperty('uids.zoe');
    expect(await peek('group/members')).toHaveProperty('uids.riley', true);

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

  it('removeMember reads an old-format bet and still works without group/members', async () => {
    await seed(env, { members: MEMBERS });
    await put('bets/old1', oldBet({ sideB: 'zoe' }));
    await env.withSecurityRulesDisabled((ctx) => deleteDoc(doc(ctx.firestore() as unknown as Firestore, 'group/members')));
    await removeMember(admin, 'zoe');
    expect(await peek('users/zoe')).toMatchObject({ status: 'former' });
    expect(await peek('bets/old1')).toMatchObject({ status: 'void', sideA: ['ava'], sideB: [], subjects: ['maya'] });
    expect(await peek('group/members')).toBeUndefined();
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

  it('adminReopenVote clears paidBy, so a re-settled paid team bet can be paid again on either side', async () => {
    await seed(env, {
      members: MEMBERS,
      bets: { t1: { status: 'voting', sideA: ['ava', 'zoe'], sideB: ['jo', 'sam'], confirmed: ['ava', 'zoe', 'jo', 'sam'] } },
    });
    const settleFor = async (side: 'A' | 'B') => {
      for (const m of ['ava', 'jo', 'maya', 'priya']) await castOpenVote(as(m), m, 't1', side);
      expect(await trySettle(as('maya'), 't1')).toBe(side);
    };
    const winnersMarkPaid = async (winners: string[]) => {
      for (const w of winners) await markIGotPaid(as(w), w, 't1');
      expect(await peek('bets/t1')).toMatchObject({ status: 'paid', paidBy: winners });
    };

    await settleFor('A');
    await winnersMarkPaid(['ava', 'zoe']);

    // Reopen and settle for the same side: the winners can mark it paid again.
    await adminReopenVote(admin, 't1');
    expect(await peek('bets/t1')).toMatchObject({ status: 'voting', paidBy: [] });
    await settleFor('A');
    await winnersMarkPaid(['ava', 'zoe']);

    // Reopen and settle for the other side: no old ids left behind.
    await adminReopenVote(admin, 't1');
    await settleFor('B');
    await winnersMarkPaid(['jo', 'sam']);
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
    await adminEditBet(admin, 'b1', { description: '  Snow before Dec 1  ', stakeB: ' a ride ' });
    expect(await peek('bets/b1')).toMatchObject({ description: 'Snow before Dec 1', stakeB: 'a ride' });
    await expect(adminEditBet(admin, 'b1', { stakeA: '   ' })).rejects.toThrow(/blank/);
    await expect(adminEditBet(admin, 'b1', { description: 'x'.repeat(2001) })).rejects.toThrow(/2000/);
    expect(await peek('bets/b1')).toMatchObject({ stakeA: '$5' });
  });

  it('adminEditBet rejects a subject on a side or a non-member; accepts unchanged subjects', async () => {
    await seed(env, {
      members: MEMBERS,
      former: ['gone'],
      pending: ['riley'],
      bets: {
        b1: { status: 'active', sideA: ['ava', 'jo'], sideB: ['maya'], confirmed: ['ava', 'jo', 'maya'] },
        s1: { status: 'settled', winner: 'A', subjects: ['gone'], confirmed: ['ava', 'jo'] },
      },
    });
    await expect(adminEditBet(admin, 'b1', { subjects: ['jo'] })).rejects.toThrow(/side/);
    await expect(adminEditBet(admin, 'b1', { subjects: ['maya'] })).rejects.toThrow(/side/);
    await expect(adminEditBet(admin, 'b1', { subjects: ['nobody'] })).rejects.toThrow(/member/);
    await expect(adminEditBet(admin, 'b1', { subjects: ['riley'] })).rejects.toThrow(/member/);
    await expect(adminEditBet(admin, 'b1', { subjects: ['zoe', 'zoe'] })).rejects.toThrow(/twice/);
    expect(await peek('bets/b1')).toMatchObject({ subjects: [] });
    await adminEditBet(admin, 'b1', { subjects: ['zoe', 'sam'] });
    expect(await peek('bets/b1')).toMatchObject({ subjects: ['zoe', 'sam'] });

    // A removed member stays the subject of a kept bet: unchanged subjects are not re-checked.
    await adminEditBet(admin, 's1', { description: 'Fixed text' });
    await adminEditBet(admin, 's1', { description: 'Fixed again', subjects: ['gone'] });
    expect(await peek('bets/s1')).toMatchObject({ description: 'Fixed again', subjects: ['gone'] });
    // Adding a current member next to her is fine; adding a non-member is not.
    await adminEditBet(admin, 's1', { subjects: ['gone', 'zoe'] });
    expect(await peek('bets/s1')).toMatchObject({ subjects: ['gone', 'zoe'] });
    await expect(adminEditBet(admin, 's1', { subjects: ['gone', 'zoe', 'riley'] })).rejects.toThrow(/member/);
  });

  it('adminEditBet keeps a bet within 8 people', async () => {
    const many = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9'];
    await seed(env, {
      members: many,
      bets: { b1: { sideA: ['m1', 'm2', 'm3'], sideB: ['m4', 'm5', 'm6'], confirmed: ['m1'], createdBy: 'm1' } },
    });
    await expect(adminEditBet(admin, 'b1', { subjects: ['m7', 'm8', 'm9'] })).rejects.toThrow(/8/);
    await adminEditBet(admin, 'b1', { subjects: ['m7', 'm8'] });
    expect(await peek('bets/b1')).toMatchObject({ subjects: ['m7', 'm8'] });
  });

  it('adminMarkPaidFor marks a removed winner paid', async () => {
    await seed(env, {
      members: MEMBERS,
      bets: {
        s1: {
          status: 'settled',
          winner: 'A',
          sideA: ['ava', 'zoe'],
          sideB: ['jo'],
          confirmed: ['ava', 'zoe', 'jo'],
          votesA: { ava: true, maya: true, priya: true, sam: true },
        },
      },
    });
    await removeMember(admin, 'zoe');
    await expect(adminMarkPaidFor(admin, 's1', 'jo')).rejects.toThrow(/winning side/);

    await adminMarkPaidFor(admin, 's1', 'zoe');
    expect(await peek('bets/s1')).toMatchObject({ status: 'settled', paidBy: ['zoe'] });
    // Marking her again changes nothing.
    await adminMarkPaidFor(admin, 's1', 'zoe');
    expect(await peek('bets/s1')).toMatchObject({ status: 'settled', paidBy: ['zoe'] });

    await adminMarkPaidFor(admin, 's1', 'ava');
    expect(await peek('bets/s1')).toMatchObject({ status: 'paid', paidBy: ['zoe', 'ava'] });
  });

  it('adminMarkPaidFor refuses a bet that is not settled', async () => {
    await seed(env, { members: MEMBERS, bets: { a1: { status: 'active', confirmed: ['ava', 'jo'] } } });
    await expect(adminMarkPaidFor(admin, 'a1', 'ava')).rejects.toThrow(/settled/);
  });

  it('upgradeData builds the member list and converts an old-format bet', async () => {
    await seed(env, { members: MEMBERS, former: ['fay'], pending: ['riley'], bets: { new1: { status: 'proposed' } } });
    await put('bets/old1', oldBet());
    await put('bets/old2', oldBet({ status: 'paid', winner: 'B', sideB: 'fay', subject: null }));
    await put('group/members', { uids: { ava: true, fay: true } });
    const before = await peek('bets/new1');

    expect(await upgradeData(admin)).toEqual({ members: 6, bets: 2 });

    expect(await peek('group/members')).toEqual({ uids: Object.fromEntries(MEMBERS.map((u) => [u, true])) });
    const old1 = await peek('bets/old1');
    expect(old1).toMatchObject({
      sideA: ['ava'],
      sideB: ['jo'],
      subjects: ['maya'],
      confirmed: ['ava', 'jo'],
      paidBy: [],
      status: 'active',
      description: 'Old bet',
    });
    expect(old1).not.toHaveProperty('subject');
    const old2 = await peek('bets/old2');
    expect(old2).toMatchObject({ sideB: ['fay'], subjects: [], paidBy: ['fay'], status: 'paid' });
    expect(old2).not.toHaveProperty('subject');
    expect(await peek('bets/new1')).toEqual(before);

    // A member can now propose and the converted bet works with the new rules.
    expect(await peek('group/members')).toHaveProperty('uids.zoe', true);
  });

  it('upgradeData rebuilds a hand-deleted member list', async () => {
    await seed(env, { members: MEMBERS });
    await env.withSecurityRulesDisabled((ctx) => deleteDoc(doc(ctx.firestore() as unknown as Firestore, 'group/members')));
    expect(await checkNeedsUpgrade(admin)).toBe(true);
    expect(await upgradeData(admin)).toEqual({ members: 6, bets: 0 });
    expect(await peek('group/members')).toEqual({ uids: Object.fromEntries(MEMBERS.map((u) => [u, true])) });
  });

  it('needsUpgrade is false after upgradeData', async () => {
    await seed(env, { members: MEMBERS, bets: { new1: {} } });
    expect(await checkNeedsUpgrade(admin)).toBe(false);
    await put('bets/old1', oldBet());
    await put('group/members', { uids: {} });
    expect(await checkNeedsUpgrade(admin)).toBe(true);
    await upgradeData(admin);
    expect(await checkNeedsUpgrade(admin)).toBe(false);
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
