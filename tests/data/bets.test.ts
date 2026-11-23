import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, type Firestore } from 'firebase/firestore';
import {
  acceptBet,
  callIt,
  cancelBet,
  castAnonVote,
  castOpenVote,
  declineBet,
  markPaid,
  proposeBet,
  trySettle,
  type NewBetInput,
} from '../../src/data/bets';
import { dbAs, makeEnv, seed } from '../rules/helpers';

// ava proposes against jo unless a test says otherwise.
const MEMBERS = ['ava', 'jo', 'maya', 'priya', 'sam', 'zoe'];

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

/** Reads a doc with rules off. */
async function peek(path: string) {
  let data: Record<string, unknown> | undefined;
  await env.withSecurityRulesDisabled(async (ctx) => {
    data = (await getDoc(doc(ctx.firestore() as unknown as Firestore, path))).data();
  });
  return data;
}

const as = (uid: string) => dbAs(env, uid);

function input(overrides: Partial<NewBetInput> = {}): NewBetInput {
  return {
    description: 'Maya texts him first',
    opponent: 'jo',
    subject: 'maya',
    stakeMine: 'a milkshake',
    stakeTheirs: 'a ride to the mall',
    voteStyle: 'open',
    ...overrides,
  };
}

/** Proposes as ava, jo accepts, ava calls it. Returns the bet id. */
async function toVoting(overrides: Partial<NewBetInput> = {}) {
  const id = await proposeBet(as('ava'), 'ava', input(overrides));
  await acceptBet(as('jo'), id);
  await callIt(as('ava'), id);
  return id;
}

describe('bets data layer', () => {
  it('proposeBet trims text and returns an id; anonymous creates zero tally', async () => {
    const id = await proposeBet(
      as('ava'),
      'ava',
      input({ description: '  Maya texts him first \n', stakeMine: ' a milkshake ', stakeTheirs: '\ta ride ' }),
    );
    expect(typeof id).toBe('string');
    expect(await peek(`bets/${id}`)).toMatchObject({
      description: 'Maya texts him first',
      sideA: 'ava',
      sideB: 'jo',
      subject: 'maya',
      stakeA: 'a milkshake',
      stakeB: 'a ride',
      voteStyle: 'open',
      status: 'proposed',
      winner: null,
      createdBy: 'ava',
    });
    expect(await peek(`bets/${id}/tally/counts`)).toBeUndefined();

    const anonId = await proposeBet(as('ava'), 'ava', input({ voteStyle: 'anonymous', subject: null }));
    expect(await peek(`bets/${anonId}/tally/counts`)).toEqual({ A: 0, B: 0 });
  });

  it('proposeBet rejects blank or too-long text before writing', async () => {
    const db = as('ava');
    await expect(proposeBet(db, 'ava', input({ description: '   ' }))).rejects.toThrow(/description/i);
    await expect(proposeBet(db, 'ava', input({ description: 'x'.repeat(2001) }))).rejects.toThrow(/description/i);
    await expect(proposeBet(db, 'ava', input({ stakeMine: '' }))).rejects.toThrow(/stake/i);
    await expect(proposeBet(db, 'ava', input({ stakeTheirs: 'x'.repeat(501) }))).rejects.toThrow(/stake/i);
  });

  it('full open flow: propose, accept, callIt, 4 votes A, trySettle -> "A", markPaid by winner', async () => {
    const id = await toVoting();
    expect(await peek(`bets/${id}`)).toMatchObject({ status: 'voting' });

    for (const v of ['ava', 'maya', 'priya']) await castOpenVote(as(v), v, id, 'A');
    // Sam votes B, moves to A; Zoe votes then withdraws.
    await castOpenVote(as('sam'), 'sam', id, 'B');
    await castOpenVote(as('zoe'), 'zoe', id, 'B');
    await castOpenVote(as('zoe'), 'zoe', id, null);
    expect(await trySettle(as('sam'), id)).toBeNull();
    await castOpenVote(as('sam'), 'sam', id, 'A');
    expect(await peek(`bets/${id}`)).toMatchObject({ votesA: votes('ava', 'maya', 'priya', 'sam'), votesB: {} });

    expect(await trySettle(as('sam'), id)).toBe('A');
    expect(await peek(`bets/${id}`)).toMatchObject({ status: 'settled', winner: 'A' });

    await expect(markPaid(as('jo'), id)).rejects.toThrow();
    await markPaid(as('ava'), id);
    expect(await peek(`bets/${id}`)).toMatchObject({ status: 'paid' });
  });

  it('full anonymous flow: 4 anon votes for B, trySettle -> "B", tally readable after', async () => {
    const id = await toVoting({ voteStyle: 'anonymous' });

    // Maya votes A then changes to B; a repeat of the same choice is a no-op.
    await castAnonVote(as('maya'), 'maya', id, 'A');
    await castAnonVote(as('maya'), 'maya', id, 'B');
    await castAnonVote(as('maya'), 'maya', id, 'B');
    for (const v of ['jo', 'priya', 'sam']) await castAnonVote(as(v), v, id, 'B');
    await castAnonVote(as('ava'), 'ava', id, 'A');
    expect(await peek(`bets/${id}`)).toMatchObject({ voterCount: 5 });
    expect(await peek(`bets/${id}/ballots/maya`)).toEqual({ choice: 'B' });

    expect(await trySettle(as('zoe'), id)).toBe('B');
    expect(await peek(`bets/${id}`)).toMatchObject({ status: 'settled', winner: 'B' });
    const tally = await getDoc(doc(as('zoe'), `bets/${id}/tally/counts`));
    expect(tally.data()).toEqual({ A: 1, B: 4 });

    await markPaid(as('jo'), id);
    expect(await peek(`bets/${id}`)).toMatchObject({ status: 'paid' });
  });

  it('trySettle on an already-settled bet returns null', async () => {
    const id = await toVoting();
    for (const v of ['ava', 'maya', 'priya', 'sam']) await castOpenVote(as(v), v, id, 'A');
    const [first, second] = await Promise.all([trySettle(as('ava'), id), trySettle(as('jo'), id)]);
    expect([first, second].filter((r) => r === 'A')).toHaveLength(1);
    expect(await trySettle(as('zoe'), id)).toBeNull();
    expect(await peek(`bets/${id}`)).toMatchObject({ status: 'settled', winner: 'A' });
  });

  it('trySettle with no majority returns null without throwing', async () => {
    const openId = await toVoting();
    for (const v of ['ava', 'maya', 'priya']) await castOpenVote(as(v), v, openId, 'A');
    for (const v of ['jo', 'sam', 'zoe']) await castOpenVote(as(v), v, openId, 'B');
    expect(await trySettle(as('ava'), openId)).toBeNull();

    const anonId = await toVoting({ voteStyle: 'anonymous' });
    for (const v of ['ava', 'maya', 'priya']) await castAnonVote(as(v), v, anonId, 'A');
    expect(await trySettle(as('ava'), anonId)).toBeNull();
    expect(await peek(`bets/${anonId}`)).toMatchObject({ status: 'voting', winner: null });
  });

  it('declineBet deletes an anonymous bet and its tally', async () => {
    const id = await proposeBet(as('ava'), 'ava', input({ voteStyle: 'anonymous' }));
    await declineBet(as('jo'), id);
    expect(await peek(`bets/${id}`)).toBeUndefined();
    expect(await peek(`bets/${id}/tally/counts`)).toBeUndefined();
  });

  it('cancelBet deletes an open bet', async () => {
    const id = await proposeBet(as('ava'), 'ava', input());
    await cancelBet(as('ava'), id);
    expect(await peek(`bets/${id}`)).toBeUndefined();
  });
});
