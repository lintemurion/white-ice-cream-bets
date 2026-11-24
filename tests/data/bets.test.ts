import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, type Firestore } from 'firebase/firestore';
import {
  callIt,
  castAnonVote,
  castOpenVote,
  confirmIn,
  joinSide,
  leaveBet,
  markIGotPaid,
  proposeBet,
  switchSide,
  trySettle,
  type NewBetInput,
} from '../../src/data/bets';
import { dbAs, makeEnv, seed } from '../rules/helpers';

// 8 members, so a side needs 5 votes to win. ava proposes against jo unless a test says otherwise.
const MEMBERS = ['ava', 'jo', 'mac', 'kayla', 'maya', 'priya', 'sam', 'zoe'];

const votes = (...uids: string[]) => Object.fromEntries(uids.map((u) => [u, true as const]));

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await makeEnv();
});
afterAll(async () => {
  await env.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
  await seed(env, { members: MEMBERS });
});

/** Runs `fn` against the database with rules off. */
async function rulesOff(fn: (db: Firestore) => Promise<void>) {
  await env.withSecurityRulesDisabled(async (ctx) => fn(ctx.firestore() as unknown as Firestore));
}

/** Reads a doc with rules off. */
async function peek(path: string) {
  let data: Record<string, unknown> | undefined;
  await rulesOff(async (db) => {
    data = (await getDoc(doc(db, path))).data();
  });
  return data;
}

const as = (uid: string) => dbAs(env, uid);

function input(overrides: Partial<NewBetInput> = {}): NewBetInput {
  return {
    description: 'Maya texts him first',
    teammates: [],
    opponents: ['jo'],
    subjects: ['maya'],
    stakeMine: 'a milkshake',
    stakeTheirs: 'a ride to the mall',
    voteStyle: 'open',
    ...overrides,
  };
}

/** Proposes as ava, jo is in, ava calls it. Returns the bet id. */
async function toVoting(overrides: Partial<NewBetInput> = {}) {
  const id = await proposeBet(as('ava'), 'ava', input(overrides));
  await confirmIn(as('jo'), 'jo', id);
  await callIt(as('ava'), id);
  return id;
}

describe('proposing', () => {
  it('proposeBet creates a team bet with subjects and confirmed [me]', async () => {
    const id = await proposeBet(
      as('ava'),
      'ava',
      input({
        description: '  Maya texts him first \n',
        teammates: ['mac'],
        opponents: ['jo', 'kayla'],
        subjects: ['maya', 'priya'],
        stakeMine: ' a milkshake ',
        stakeTheirs: '\ta ride ',
      }),
    );
    expect(typeof id).toBe('string');
    const bet = await peek(`bets/${id}`);
    expect(bet).toMatchObject({
      description: 'Maya texts him first',
      sideA: ['ava', 'mac'],
      sideB: ['jo', 'kayla'],
      subjects: ['maya', 'priya'],
      confirmed: ['ava'],
      paidBy: [],
      stakeA: 'a milkshake',
      stakeB: 'a ride',
      voteStyle: 'open',
      status: 'proposed',
      winner: null,
      createdBy: 'ava',
    });
    expect(bet).not.toHaveProperty('subject');
    expect(await peek(`bets/${id}/tally/counts`)).toBeUndefined();

    const anonId = await proposeBet(as('ava'), 'ava', input({ voteStyle: 'anonymous', subjects: [] }));
    expect(await peek(`bets/${anonId}/tally/counts`)).toEqual({ A: 0, B: 0 });
  });

  it('proposeBet rejects blank or too-long text before writing', async () => {
    const db = as('ava');
    await expect(proposeBet(db, 'ava', input({ description: '   ' }))).rejects.toThrow(/description/i);
    await expect(proposeBet(db, 'ava', input({ description: 'x'.repeat(2001) }))).rejects.toThrow(/description/i);
    await expect(proposeBet(db, 'ava', input({ stakeMine: '' }))).rejects.toThrow(/stake/i);
    await expect(proposeBet(db, 'ava', input({ stakeTheirs: 'x'.repeat(501) }))).rejects.toThrow(/stake/i);
  });

  it('proposeBet refuses a bad lineup before writing, with a clear message', async () => {
    const db = as('ava');
    // 9 people: ava + 3 teammates + 3 opponents + 2 subjects.
    const nine = input({ teammates: ['mac', 'kayla', 'maya'], opponents: ['jo', 'priya', 'sam'], subjects: ['zoe', 'x'] });
    await expect(proposeBet(db, 'ava', nine)).rejects.toThrow(/at most 8/);
    await expect(proposeBet(db, 'ava', input({ opponents: ['jo', 'jo'] }))).rejects.toThrow(/more than once/);
    await expect(proposeBet(db, 'ava', input({ teammates: ['jo'], opponents: ['jo'] }))).rejects.toThrow(/more than once/);
    await expect(proposeBet(db, 'ava', input({ opponents: ['ava'] }))).rejects.toThrow(/more than once/);
    await expect(proposeBet(db, 'ava', input({ subjects: ['jo'] }))).rejects.toThrow(/about can't be on a side/);
    await expect(proposeBet(db, 'ava', input({ subjects: ['ava'] }))).rejects.toThrow(/about can't be on a side/);
  });

  it('proposeBet explains a missing member list', async () => {
    await rulesOff((db) => deleteDoc(doc(db, 'group/members')));
    await expect(proposeBet(as('ava'), 'ava', input())).rejects.toThrow(
      new Error('The group needs a quick upgrade. Ask Kyle.'),
    );
  });
});

describe('moves while proposed', () => {
  it('open challenge: joinSide B by a bystander makes it active', async () => {
    const id = await proposeBet(as('ava'), 'ava', input({ opponents: [] }));
    expect(await peek(`bets/${id}`)).toMatchObject({ sideB: [], status: 'proposed' });
    await joinSide(as('sam'), 'sam', id, 'B');
    expect(await peek(`bets/${id}`)).toMatchObject({
      sideA: ['ava'],
      sideB: ['sam'],
      confirmed: ['ava', 'sam'],
      status: 'active',
    });
  });

  it('named people confirmIn one by one; the last makes it active', async () => {
    const id = await proposeBet(as('ava'), 'ava', input({ teammates: ['mac'], opponents: ['jo', 'kayla'] }));
    await confirmIn(as('mac'), 'mac', id);
    expect(await peek(`bets/${id}`)).toMatchObject({ confirmed: ['ava', 'mac'], status: 'proposed' });
    await confirmIn(as('kayla'), 'kayla', id);
    expect(await peek(`bets/${id}`)).toMatchObject({ confirmed: ['ava', 'mac', 'kayla'], status: 'proposed' });
    await confirmIn(as('jo'), 'jo', id);
    expect(await peek(`bets/${id}`)).toMatchObject({ confirmed: ['ava', 'mac', 'kayla', 'jo'], status: 'active' });
  });

  it('switchSide and leaveBet; last on side A leaving voids the bet', async () => {
    const id = await proposeBet(as('ava'), 'ava', input());
    await joinSide(as('sam'), 'sam', id, 'A');
    expect(await peek(`bets/${id}`)).toMatchObject({ sideA: ['ava', 'sam'], confirmed: ['ava', 'sam'], status: 'proposed' });

    // jo switches to A: side B empties (an open challenge again), and switching marks her in.
    await switchSide(as('jo'), 'jo', id);
    expect(await peek(`bets/${id}`)).toMatchObject({
      sideA: ['ava', 'sam', 'jo'],
      sideB: [],
      confirmed: ['ava', 'sam', 'jo'],
      status: 'proposed',
    });

    await leaveBet(as('jo'), 'jo', id);
    expect(await peek(`bets/${id}`)).toMatchObject({ sideA: ['ava', 'sam'], confirmed: ['ava', 'sam'], status: 'proposed' });

    // The proposer may leave; sam is now first on A.
    await leaveBet(as('ava'), 'ava', id);
    expect(await peek(`bets/${id}`)).toMatchObject({ sideA: ['sam'], confirmed: ['sam'], status: 'proposed' });

    await leaveBet(as('sam'), 'sam', id);
    expect(await peek(`bets/${id}`)).toMatchObject({ sideA: [], sideB: [], confirmed: [], status: 'void' });
  });

  it('two simultaneous joins both land', async () => {
    // mac isn't in yet, so the first join can't make the bet active and shut out the second.
    const id = await proposeBet(as('ava'), 'ava', input({ teammates: ['mac'], opponents: [] }));
    await Promise.all([joinSide(as('sam'), 'sam', id, 'B'), joinSide(as('zoe'), 'zoe', id, 'B')]);
    const bet = await peek(`bets/${id}`);
    expect([...(bet!.sideB as string[])].sort()).toEqual(['sam', 'zoe']);
    expect([...(bet!.confirmed as string[])].sort()).toEqual(['ava', 'sam', 'zoe']);
    expect(bet).toMatchObject({ sideA: ['ava', 'mac'], status: 'proposed' });
  });

  it('refuses moves that make no sense with a clear message', async () => {
    const id = await proposeBet(as('ava'), 'ava', input());
    await expect(joinSide(as('maya'), 'maya', id, 'A')).rejects.toThrow(/about/);
    await expect(joinSide(as('jo'), 'jo', id, 'A')).rejects.toThrow(/Switch sides/);
    await expect(switchSide(as('sam'), 'sam', id)).rejects.toThrow(/not on this bet/);
    await expect(confirmIn(as('sam'), 'sam', id)).rejects.toThrow(/not on this bet/);
    await confirmIn(as('jo'), 'jo', id);
    await expect(joinSide(as('sam'), 'sam', id, 'B')).rejects.toThrow(/already started/);
  });

  it('a move on an old-format bet asks for the group upgrade', async () => {
    await rulesOff((db) =>
      setDoc(doc(db, 'bets/old'), {
        description: 'Old bet',
        sideA: 'ava',
        sideB: 'jo',
        subject: null,
        stakeA: '$5',
        stakeB: '$5',
        voteStyle: 'open',
        status: 'proposed',
        winner: null,
        createdBy: 'ava',
        votesA: {},
        votesB: {},
        voters: {},
        voterCount: 0,
      }),
    );
    const upgrade = new Error('This bet needs the group upgrade first. Ask Kyle.');
    await expect(confirmIn(as('jo'), 'jo', 'old')).rejects.toThrow(upgrade);
    await expect(joinSide(as('sam'), 'sam', 'old', 'A')).rejects.toThrow(upgrade);
    await expect(leaveBet(as('ava'), 'ava', 'old')).rejects.toThrow(upgrade);
    await rulesOff((db) => setDoc(doc(db, 'bets/old'), { status: 'settled', winner: 'B' }, { merge: true }));
    await expect(markIGotPaid(as('jo'), 'jo', 'old')).rejects.toThrow(upgrade);
  });
});

describe('voting and paying', () => {
  it('markIGotPaid by each winner; paid after the last', async () => {
    const id = await proposeBet(as('ava'), 'ava', input({ teammates: ['mac'] }));
    for (const v of ['mac', 'jo']) await confirmIn(as(v), v, id);
    await callIt(as('ava'), id);
    for (const v of ['ava', 'mac', 'maya', 'priya', 'sam']) await castOpenVote(as(v), v, id, 'A');
    expect(await trySettle(as('zoe'), id)).toBe('A');

    await expect(markIGotPaid(as('jo'), 'jo', id)).rejects.toThrow(/winners/);
    await expect(markIGotPaid(as('maya'), 'maya', id)).rejects.toThrow(/winners/);
    await markIGotPaid(as('mac'), 'mac', id);
    expect(await peek(`bets/${id}`)).toMatchObject({ paidBy: ['mac'], status: 'settled' });
    // Marking twice changes nothing.
    await markIGotPaid(as('mac'), 'mac', id);
    expect(await peek(`bets/${id}`)).toMatchObject({ paidBy: ['mac'], status: 'settled' });
    await markIGotPaid(as('ava'), 'ava', id);
    expect(await peek(`bets/${id}`)).toMatchObject({ paidBy: ['mac', 'ava'], status: 'paid' });
  });

  it('two winners marking paid at once both land, and the bet ends paid', async () => {
    const id = await proposeBet(as('ava'), 'ava', input({ teammates: ['mac'] }));
    for (const v of ['mac', 'jo']) await confirmIn(as(v), v, id);
    await callIt(as('ava'), id);
    for (const v of ['ava', 'mac', 'maya', 'priya', 'sam']) await castOpenVote(as(v), v, id, 'A');
    expect(await trySettle(as('zoe'), id)).toBe('A');
    await Promise.all([markIGotPaid(as('ava'), 'ava', id), markIGotPaid(as('mac'), 'mac', id)]);
    const bet = await peek(`bets/${id}`);
    expect([...(bet!.paidBy as string[])].sort()).toEqual(['ava', 'mac']);
    expect(bet).toMatchObject({ status: 'paid' });
  });

  it('full open flow: propose, confirm, callIt, 5 votes A, trySettle -> "A", winner marks paid', async () => {
    const id = await toVoting();
    expect(await peek(`bets/${id}`)).toMatchObject({ status: 'voting' });

    for (const v of ['ava', 'maya', 'priya', 'kayla']) await castOpenVote(as(v), v, id, 'A');
    // Sam votes B, moves to A; Zoe votes then withdraws.
    await castOpenVote(as('sam'), 'sam', id, 'B');
    await castOpenVote(as('zoe'), 'zoe', id, 'B');
    await castOpenVote(as('zoe'), 'zoe', id, null);
    expect(await trySettle(as('sam'), id)).toBeNull();
    await castOpenVote(as('sam'), 'sam', id, 'A');
    expect(await peek(`bets/${id}`)).toMatchObject({
      votesA: votes('ava', 'maya', 'priya', 'kayla', 'sam'),
      votesB: {},
    });

    expect(await trySettle(as('sam'), id)).toBe('A');
    expect(await peek(`bets/${id}`)).toMatchObject({ status: 'settled', winner: 'A' });

    await markIGotPaid(as('ava'), 'ava', id);
    expect(await peek(`bets/${id}`)).toMatchObject({ paidBy: ['ava'], status: 'paid' });
  });

  it('full anonymous team flow: propose, confirm, call, vote, settle', async () => {
    const id = await proposeBet(
      as('ava'),
      'ava',
      input({ voteStyle: 'anonymous', teammates: ['mac'], opponents: ['jo', 'kayla'], subjects: ['maya'] }),
    );
    for (const v of ['mac', 'jo', 'kayla']) await confirmIn(as(v), v, id);
    expect(await peek(`bets/${id}`)).toMatchObject({ status: 'active' });
    await callIt(as('maya'), id);

    // Maya votes A then changes to B; a repeat of the same choice is a no-op.
    await castAnonVote(as('maya'), 'maya', id, 'A');
    await castAnonVote(as('maya'), 'maya', id, 'B');
    await castAnonVote(as('maya'), 'maya', id, 'B');
    for (const v of ['jo', 'kayla', 'priya', 'sam']) await castAnonVote(as(v), v, id, 'B');
    await castAnonVote(as('ava'), 'ava', id, 'A');
    expect(await peek(`bets/${id}`)).toMatchObject({ voterCount: 6 });
    expect(await peek(`bets/${id}/ballots/maya`)).toEqual({ choice: 'B' });

    expect(await trySettle(as('zoe'), id)).toBe('B');
    expect(await peek(`bets/${id}`)).toMatchObject({ status: 'settled', winner: 'B' });
    const tally = await getDoc(doc(as('zoe'), `bets/${id}/tally/counts`));
    expect(tally.data()).toEqual({ A: 1, B: 5 });

    await markIGotPaid(as('jo'), 'jo', id);
    expect(await peek(`bets/${id}`)).toMatchObject({ status: 'settled' });
    await markIGotPaid(as('kayla'), 'kayla', id);
    expect(await peek(`bets/${id}`)).toMatchObject({ paidBy: ['jo', 'kayla'], status: 'paid' });
  });

  it('trySettle on an already-settled bet returns null', async () => {
    const id = await toVoting();
    for (const v of ['ava', 'maya', 'priya', 'sam', 'kayla']) await castOpenVote(as(v), v, id, 'A');
    const [first, second] = await Promise.all([trySettle(as('ava'), id), trySettle(as('jo'), id)]);
    expect([first, second].filter((r) => r === 'A')).toHaveLength(1);
    expect(await trySettle(as('zoe'), id)).toBeNull();
    expect(await peek(`bets/${id}`)).toMatchObject({ status: 'settled', winner: 'A' });
  });

  it('trySettle with no majority returns null without throwing', async () => {
    const openId = await toVoting();
    for (const v of ['ava', 'maya', 'priya', 'mac']) await castOpenVote(as(v), v, openId, 'A');
    for (const v of ['jo', 'sam', 'zoe', 'kayla']) await castOpenVote(as(v), v, openId, 'B');
    expect(await trySettle(as('ava'), openId)).toBeNull();

    const anonId = await toVoting({ voteStyle: 'anonymous' });
    for (const v of ['ava', 'maya', 'priya', 'mac']) await castAnonVote(as(v), v, anonId, 'A');
    expect(await trySettle(as('ava'), anonId)).toBeNull();
    expect(await peek(`bets/${anonId}`)).toMatchObject({ status: 'voting', winner: null });
  });
});
