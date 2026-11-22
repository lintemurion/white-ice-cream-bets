import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteField, doc, getDoc, updateDoc, type Firestore } from 'firebase/firestore';
import { dbAs, makeEnv, seed } from './helpers';

// ava is side A, jo is side B, maya is the subject of `voting`.
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
  await seed(env, {
    members: MEMBERS,
    pending: ['riley'],
    bets: {
      voting: { status: 'voting', subject: 'maya' },
      voted: { status: 'voting', votesA: votes('priya') },
      active: { status: 'active' },
      anon: { status: 'voting', voteStyle: 'anonymous' },
      fourA: { status: 'voting', votesA: votes('ava', 'maya', 'priya', 'sam'), votesB: votes('jo') },
      threeA: { status: 'voting', votesA: votes('ava', 'maya', 'priya'), votesB: votes('jo', 'sam', 'zoe') },
      fourB: { status: 'voting', votesA: votes('ava'), votesB: votes('jo', 'maya', 'priya', 'sam') },
      settledA: { status: 'settled', winner: 'A', votesA: votes('ava', 'maya', 'priya', 'sam') },
      settledB: { status: 'settled', winner: 'B', votesB: votes('jo', 'maya', 'priya', 'sam') },
    },
    betTallies: { anon: { A: 0, B: 0 } },
  });
});

/** Reads a doc with rules off. */
async function peek(path: string) {
  let data: Record<string, unknown> | undefined;
  await env.withSecurityRulesDisabled(async (ctx) => {
    data = (await getDoc(doc(ctx.firestore() as unknown as Firestore, path))).data();
  });
  return data;
}

const bet = (who: string, id: string) => doc(dbAs(env, who), `bets/${id}`);

describe('open vote', () => {
  it('member votes A on a voting open bet', async () => {
    await assertSucceeds(updateDoc(bet('zoe', 'voting'), { 'votesA.zoe': true }));
    expect(await peek('bets/voting')).toMatchObject({ votesA: { zoe: true }, votesB: {} });
  });

  it('member moves her vote from A to B', async () => {
    await assertSucceeds(updateDoc(bet('priya', 'voted'), { 'votesA.priya': deleteField(), 'votesB.priya': true }));
    expect(await peek('bets/voted')).toMatchObject({ votesA: {}, votesB: { priya: true } });
  });

  it('member removes her vote', async () => {
    await assertSucceeds(updateDoc(bet('priya', 'voted'), { 'votesA.priya': deleteField() }));
    expect(await peek('bets/voted')).toMatchObject({ votesA: {}, votesB: {} });
  });

  it('cannot vote as someone else or add two keys', async () => {
    await assertFails(updateDoc(bet('zoe', 'voting'), { 'votesA.sam': true }));
    await assertFails(updateDoc(bet('zoe', 'voting'), { 'votesA.zoe': true, 'votesA.sam': true }));
    // Nor remove someone else's vote.
    await assertFails(updateDoc(bet('zoe', 'voted'), { 'votesA.priya': deleteField() }));
  });

  it('cannot be in both maps', async () => {
    await assertFails(updateDoc(bet('zoe', 'voting'), { 'votesA.zoe': true, 'votesB.zoe': true }));
    await assertFails(updateDoc(bet('priya', 'voted'), { 'votesB.priya': true }));
  });

  it('vote value must be exactly true and only the vote maps change', async () => {
    await assertFails(updateDoc(bet('zoe', 'voting'), { 'votesA.zoe': 'yes' }));
    await assertFails(updateDoc(bet('zoe', 'voting'), { 'votesA.zoe': false }));
    await assertFails(updateDoc(bet('zoe', 'voting'), { 'votesA.zoe': true, description: 'Changed' }));
    await assertFails(updateDoc(bet('zoe', 'voting'), { votesA: 'zoe' }));
  });

  it('cannot vote on an active (not voting) bet', () =>
    assertFails(updateDoc(bet('zoe', 'active'), { 'votesA.zoe': true })));

  it('cannot write votesA on an anonymous bet', () =>
    assertFails(updateDoc(bet('zoe', 'anon'), { 'votesA.zoe': true })));

  it('pending user and admin cannot vote', async () => {
    await assertFails(updateDoc(bet('riley', 'voting'), { 'votesA.riley': true }));
    await assertFails(updateDoc(bet('admin', 'voting'), { 'votesA.kyle': true }));
  });

  it('bettors and subject may vote', async () => {
    await assertSucceeds(updateDoc(bet('ava', 'voting'), { 'votesA.ava': true }));
    await assertSucceeds(updateDoc(bet('maya', 'voting'), { 'votesB.maya': true }));
  });
});

describe('settle (open)', () => {
  it('settle A succeeds with 4 of 6 for A', async () => {
    await assertSucceeds(updateDoc(bet('zoe', 'fourA'), { status: 'settled', winner: 'A' }));
    expect(await peek('bets/fourA')).toMatchObject({ status: 'settled', winner: 'A' });
    // B works the same way.
    await assertSucceeds(updateDoc(bet('zoe', 'fourB'), { status: 'settled', winner: 'B' }));
  });

  it('settle A denied with 3 of 6 (tie or short)', async () => {
    await assertFails(updateDoc(bet('zoe', 'threeA'), { status: 'settled', winner: 'A' }));
    await assertFails(updateDoc(bet('zoe', 'threeA'), { status: 'settled', winner: 'B' }));
  });

  it('settle denied if winner is the side without majority', async () => {
    await assertFails(updateDoc(bet('zoe', 'fourA'), { status: 'settled', winner: 'B' }));
    await assertFails(updateDoc(bet('zoe', 'fourB'), { status: 'settled', winner: 'A' }));
  });

  it('settle changes only status and winner, and only to settled', async () => {
    await assertFails(updateDoc(bet('zoe', 'fourA'), { status: 'settled', winner: 'A', description: 'x' }));
    await assertFails(updateDoc(bet('zoe', 'fourA'), { status: 'paid', winner: 'A' }));
    await assertFails(updateDoc(bet('zoe', 'fourA'), { status: 'settled', winner: 'C' }));
    await assertFails(updateDoc(bet('riley', 'fourA'), { status: 'settled', winner: 'A' }));
  });

  it('second settle write is denied once status is settled', async () => {
    await assertSucceeds(updateDoc(bet('zoe', 'fourA'), { status: 'settled', winner: 'A' }));
    await assertFails(updateDoc(bet('sam', 'fourA'), { status: 'settled', winner: 'A' }));
    await assertFails(updateDoc(bet('sam', 'settledA'), { status: 'settled', winner: 'B' }));
  });

  it('votes are frozen once settled', () =>
    assertFails(updateDoc(bet('zoe', 'settledA'), { 'votesB.zoe': true })));
});

describe('settle after admission', () => {
  beforeEach(async () => {
    await env.clearFirestore();
    await seed(env, {
      members: [...MEMBERS, 'riley', 'tess'],
      bets: { fourA: { status: 'voting', votesA: votes('ava', 'maya', 'priya', 'sam') } },
    });
  });

  it('settle is denied after an admission raises the bar', () =>
    assertFails(updateDoc(bet('zoe', 'fourA'), { status: 'settled', winner: 'A' })));
});

describe('mark paid', () => {
  it('winner marks paid; loser and bystander cannot', async () => {
    await assertFails(updateDoc(bet('jo', 'settledA'), { status: 'paid' }));
    await assertFails(updateDoc(bet('maya', 'settledA'), { status: 'paid' }));
    await assertSucceeds(updateDoc(bet('ava', 'settledA'), { status: 'paid' }));
    expect(await peek('bets/settledA')).toMatchObject({ status: 'paid', winner: 'A' });
    // Winner B is side B.
    await assertFails(updateDoc(bet('ava', 'settledB'), { status: 'paid' }));
    await assertSucceeds(updateDoc(bet('jo', 'settledB'), { status: 'paid' }));
  });

  it('mark paid changes only status, and only from settled', async () => {
    await assertFails(updateDoc(bet('ava', 'settledA'), { status: 'paid', winner: 'B' }));
    await assertFails(updateDoc(bet('ava', 'fourA'), { status: 'paid' }));
  });

  it('admin marks paid', async () => {
    await assertSucceeds(updateDoc(bet('admin', 'settledA'), { status: 'paid' }));
    expect(await peek('bets/settledA')).toMatchObject({ status: 'paid' });
  });
});
