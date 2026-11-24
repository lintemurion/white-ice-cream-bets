import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, increment, setDoc, updateDoc, writeBatch, type Firestore } from 'firebase/firestore';
import { dbAs, makeEnv, seed } from './helpers';

// ava is side A, jo is side B (anonSettled: ava & maya beat jo).
const MEMBERS = ['ava', 'jo', 'maya', 'priya', 'sam', 'zoe'];

const keys = (...uids: string[]) => Object.fromEntries(uids.map((u) => [u, true as const]));

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
      anon: { status: 'voting', voteStyle: 'anonymous' },
      anonActive: { status: 'active', voteStyle: 'anonymous' },
      fourOne: { status: 'voting', voteStyle: 'anonymous', voters: keys('ava', 'jo', 'maya', 'priya', 'sam'), voterCount: 5 },
      threeThree: { status: 'voting', voteStyle: 'anonymous', voters: keys(...MEMBERS), voterCount: 6 },
      anonSettled: {
        sideA: ['ava', 'maya'],
        sideB: ['jo'],
        confirmed: ['ava', 'maya', 'jo'],
        status: 'settled',
        winner: 'A',
        voteStyle: 'anonymous',
        voterCount: 4,
      },
      // Anonymous bet whose (admin-written) vote maps would carry an open settle.
      anonWithMaps: { status: 'voting', voteStyle: 'anonymous', votesA: keys('ava', 'maya', 'priya', 'sam') },
      // Open bet with a stray tally that would carry an anonymous settle.
      openWithTally: { status: 'voting', voteStyle: 'open' },
      proposed: { voteStyle: 'anonymous' },
    },
    betTallies: {
      anon: { A: 0, B: 0 },
      anonActive: { A: 0, B: 0 },
      fourOne: { A: 4, B: 1 },
      threeThree: { A: 3, B: 3 },
      anonSettled: { A: 4, B: 0 },
      anonWithMaps: { A: 0, B: 0 },
      openWithTally: { A: 4, B: 0 },
      proposed: { A: 0, B: 0 },
    },
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

interface VoteOpts {
  ballotId?: string;
  votersKey?: string;
  ballot?: boolean;
  bump?: number;
}

/** The three-doc new-vote batch, with knobs to break it. */
function castAnonVote(db: Firestore, voter: string, betId: string, choice: 'A' | 'B', o: VoteOpts = {}) {
  const b = writeBatch(db);
  if (o.ballot ?? true) b.set(doc(db, `bets/${betId}/ballots/${o.ballotId ?? voter}`), { choice });
  b.update(doc(db, `bets/${betId}`), { [`voters.${o.votersKey ?? voter}`]: true, voterCount: increment(1) });
  b.update(doc(db, `bets/${betId}/tally/counts`), { [choice]: increment(o.bump ?? 1) });
  return b.commit();
}

function changeAnonVote(db: Firestore, voter: string, betId: string, from: 'A' | 'B', to: 'A' | 'B') {
  const b = writeBatch(db);
  b.update(doc(db, `bets/${betId}/ballots/${voter}`), { choice: to });
  b.update(doc(db, `bets/${betId}/tally/counts`), { [from]: increment(-1), [to]: increment(1) });
  return b.commit();
}

const bet = (who: string, id: string) => doc(dbAs(env, who), `bets/${id}`);
const tally = (who: string, id: string) => doc(dbAs(env, who), `bets/${id}/tally/counts`);

describe('anonymous vote', () => {
  it('member casts an anonymous vote with the three-doc batch', async () => {
    await assertSucceeds(castAnonVote(dbAs(env, 'zoe'), 'zoe', 'anon', 'A'));
    expect(await peek('bets/anon')).toMatchObject({ voters: { zoe: true }, voterCount: 1 });
    expect(await peek('bets/anon/tally/counts')).toEqual({ A: 1, B: 0 });
    expect(await peek('bets/anon/ballots/zoe')).toEqual({ choice: 'A' });
  });

  it('cannot vote twice or as someone else', async () => {
    await castAnonVote(dbAs(env, 'zoe'), 'zoe', 'anon', 'A');
    await assertFails(castAnonVote(dbAs(env, 'zoe'), 'zoe', 'anon', 'A'));
    await assertFails(castAnonVote(dbAs(env, 'zoe'), 'zoe', 'anon', 'B', { ballotId: 'sam', votersKey: 'sam' }));
  });

  it('cannot change tally without a matching ballot, or by 2', async () => {
    await assertFails(castAnonVote(dbAs(env, 'zoe'), 'zoe', 'anon', 'A', { ballot: false }));
    await assertFails(castAnonVote(dbAs(env, 'zoe'), 'zoe', 'anon', 'A', { bump: 2 }));
    // Ballot says B, tally bumps A.
    const db = dbAs(env, 'zoe');
    const b = writeBatch(db);
    b.set(doc(db, 'bets/anon/ballots/zoe'), { choice: 'B' });
    b.update(doc(db, 'bets/anon'), { 'voters.zoe': true, voterCount: increment(1) });
    b.update(doc(db, 'bets/anon/tally/counts'), { A: increment(1) });
    await assertFails(b.commit());
    // Tally alone.
    await assertFails(updateDoc(tally('zoe', 'anon'), { A: increment(1) }));
  });

  it('cannot add a voters key without a ballot', async () => {
    await assertFails(updateDoc(bet('zoe', 'anon'), { 'voters.zoe': true, voterCount: increment(1) }));
    // Nor a key for someone else alongside her own ballot.
    await assertFails(castAnonVote(dbAs(env, 'zoe'), 'zoe', 'anon', 'A', { votersKey: 'sam' }));
    // Nor without the voterCount bump.
    const db = dbAs(env, 'zoe');
    const b = writeBatch(db);
    b.set(doc(db, 'bets/anon/ballots/zoe'), { choice: 'A' });
    b.update(doc(db, 'bets/anon'), { 'voters.zoe': true });
    b.update(doc(db, 'bets/anon/tally/counts'), { A: increment(1) });
    await assertFails(b.commit());
  });

  it('cannot vote on a bet that is not voting, or as pending user or admin', async () => {
    await assertFails(castAnonVote(dbAs(env, 'zoe'), 'zoe', 'anonActive', 'A'));
    await assertFails(castAnonVote(dbAs(env, 'zoe'), 'zoe', 'anonSettled', 'B'));
    await assertFails(castAnonVote(dbAs(env, 'riley'), 'riley', 'anon', 'A'));
    await assertFails(castAnonVote(dbAs(env, 'admin'), 'kyle', 'anon', 'A'));
  });

  it('member changes vote, tally moves -1/+1', async () => {
    await castAnonVote(dbAs(env, 'zoe'), 'zoe', 'anon', 'A');
    await assertSucceeds(changeAnonVote(dbAs(env, 'zoe'), 'zoe', 'anon', 'A', 'B'));
    expect(await peek('bets/anon/tally/counts')).toEqual({ A: 0, B: 1 });
    expect(await peek('bets/anon/ballots/zoe')).toEqual({ choice: 'B' });
    expect(await peek('bets/anon')).toMatchObject({ voters: { zoe: true }, voterCount: 1 });
  });

  it('changed vote cannot skip the -1 or also move voterCount', async () => {
    await castAnonVote(dbAs(env, 'zoe'), 'zoe', 'anon', 'A');
    const db = dbAs(env, 'zoe');
    const b1 = writeBatch(db);
    b1.update(doc(db, 'bets/anon/ballots/zoe'), { choice: 'B' });
    b1.update(doc(db, 'bets/anon/tally/counts'), { B: increment(1) });
    await assertFails(b1.commit());

    const b2 = writeBatch(db);
    b2.update(doc(db, 'bets/anon/ballots/zoe'), { choice: 'B' });
    b2.update(doc(db, 'bets/anon/tally/counts'), { A: increment(-1), B: increment(1) });
    b2.update(doc(db, 'bets/anon'), { voterCount: increment(1) });
    await assertFails(b2.commit());
  });

  it('member cannot read another ballot; can read her own', async () => {
    await castAnonVote(dbAs(env, 'zoe'), 'zoe', 'anon', 'A');
    await assertFails(getDoc(doc(dbAs(env, 'sam'), 'bets/anon/ballots/zoe')));
    await assertSucceeds(getDoc(doc(dbAs(env, 'zoe'), 'bets/anon/ballots/zoe')));
    await assertSucceeds(getDoc(doc(dbAs(env, 'admin'), 'bets/anon/ballots/zoe')));
  });

  it('members cannot read tally mid-vote', async () => {
    await assertFails(getDoc(tally('zoe', 'fourOne')));
    await assertFails(getDoc(tally('riley', 'threeThree')));
    await assertSucceeds(getDoc(tally('admin', 'fourOne')));
  });

  it('members read tally once all have voted (tie case 3-3)', async () => {
    const snap = await assertSucceeds(getDoc(tally('zoe', 'threeThree')));
    expect(snap.data()).toEqual({ A: 3, B: 3 });
  });

  it('members still read tally if memberCount drops below voterCount', async () => {
    await env.withSecurityRulesDisabled((ctx) =>
      updateDoc(doc(ctx.firestore() as unknown as Firestore, 'group/main'), { memberCount: 5 }),
    );
    await assertSucceeds(getDoc(tally('zoe', 'fourOne')));
  });

  it('members read tally after settle', async () => {
    await assertSucceeds(getDoc(tally('zoe', 'anonSettled')));
    await assertSucceeds(updateDoc(bet('zoe', 'fourOne'), { status: 'settled', winner: 'A' }));
    await assertSucceeds(getDoc(tally('zoe', 'fourOne')));
  });
});

describe('settle (anonymous)', () => {
  it('settle A succeeds with hidden tally 4-1', async () => {
    await assertSucceeds(updateDoc(bet('zoe', 'fourOne'), { status: 'settled', winner: 'A' }));
    expect(await peek('bets/fourOne')).toMatchObject({ status: 'settled', winner: 'A' });
  });

  it('settle A denied with hidden tally 3-3', async () => {
    await assertFails(updateDoc(bet('zoe', 'threeThree'), { status: 'settled', winner: 'A' }));
    await assertFails(updateDoc(bet('zoe', 'threeThree'), { status: 'settled', winner: 'B' }));
  });

  it('settle denied for the minority side, extra fields, or a second settle', async () => {
    await assertFails(updateDoc(bet('zoe', 'fourOne'), { status: 'settled', winner: 'B' }));
    await assertFails(updateDoc(bet('zoe', 'fourOne'), { status: 'settled', winner: 'A', voterCount: 6 }));
    await assertFails(updateDoc(bet('zoe', 'fourOne'), { status: 'paid', winner: 'A' }));
    await assertFails(updateDoc(bet('riley', 'fourOne'), { status: 'settled', winner: 'A' }));
    await assertFails(updateDoc(bet('zoe', 'anonSettled'), { status: 'settled', winner: 'B' }));
  });

  it('settle batch that also bumps the tally is judged on the pre-batch tally', async () => {
    // 3-1 with zoe on B: moving her to A makes 4-0, but the settle reads the old tally.
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, 'bets/anon/tally/counts'), { A: 3, B: 1 });
      await setDoc(doc(db, 'bets/anon/ballots/zoe'), { choice: 'B' });
      await updateDoc(doc(db, 'bets/anon'), { voters: keys('ava', 'maya', 'priya', 'zoe'), voterCount: 4 });
    });
    const db = dbAs(env, 'zoe');
    const b = writeBatch(db);
    b.update(doc(db, 'bets/anon/ballots/zoe'), { choice: 'A' });
    b.update(doc(db, 'bets/anon/tally/counts'), { A: increment(1), B: increment(-1) });
    b.update(doc(db, 'bets/anon'), { status: 'settled', winner: 'A' });
    await assertFails(b.commit());
    // The vote change alone is fine, and then the settle goes through.
    await assertSucceeds(changeAnonVote(db, 'zoe', 'anon', 'B', 'A'));
    await assertSucceeds(updateDoc(bet('zoe', 'anon'), { status: 'settled', winner: 'A' }));
  });

  it('anonymous bet cannot settle through the open path, nor open through the anonymous path', async () => {
    await assertFails(updateDoc(bet('zoe', 'anonWithMaps'), { status: 'settled', winner: 'A' }));
    await assertFails(updateDoc(bet('zoe', 'openWithTally'), { status: 'settled', winner: 'A' }));
  });
});

describe('settle after admission (anonymous)', () => {
  beforeEach(async () => {
    await env.clearFirestore();
    await seed(env, {
      members: [...MEMBERS, 'riley', 'tess'],
      bets: { fourA: { status: 'voting', voteStyle: 'anonymous', voterCount: 4 } },
      betTallies: { fourA: { A: 4, B: 0 } },
    });
  });

  it('settle is denied after an admission raises the bar', () =>
    assertFails(updateDoc(bet('zoe', 'fourA'), { status: 'settled', winner: 'A' })));
});

describe('mark paid (anonymous)', () => {
  it('each winner marks their own payment; the last one sets paid', async () => {
    await assertFails(updateDoc(bet('jo', 'anonSettled'), { paidBy: ['jo'] }));
    await assertFails(updateDoc(bet('ava', 'anonSettled'), { paidBy: ['ava'], status: 'paid' }));
    await assertSucceeds(updateDoc(bet('ava', 'anonSettled'), { paidBy: ['ava'] }));
    await assertFails(updateDoc(bet('maya', 'anonSettled'), { paidBy: ['ava', 'maya'] }));
    await assertSucceeds(updateDoc(bet('maya', 'anonSettled'), { paidBy: ['ava', 'maya'], status: 'paid' }));
    expect(await peek('bets/anonSettled')).toMatchObject({ paidBy: ['ava', 'maya'], status: 'paid' });
  });
});

describe('anonymous misc', () => {
  it('voteStyle cannot change after proposal (member)', async () => {
    await assertFails(updateDoc(bet('jo', 'proposed'), { voteStyle: 'open' }));
    await assertFails(updateDoc(bet('jo', 'proposed'), { status: 'active', voteStyle: 'open' }));
    await assertFails(updateDoc(bet('zoe', 'anon'), { voteStyle: 'open' }));
  });

  it('admin cannot create a ballot as himself', async () => {
    const db = dbAs(env, 'admin');
    await assertFails(setDoc(doc(db, 'bets/anon/ballots/kyle'), { choice: 'A' }));
    await assertFails(castAnonVote(db, 'kyle', 'anon', 'A'));
  });

  it('cannot cast an anonymous ballot on an open bet', async () => {
    const db = dbAs(env, 'zoe');
    const b = writeBatch(db);
    b.set(doc(db, 'bets/openWithTally/ballots/zoe'), { choice: 'A' });
    b.update(doc(db, 'bets/openWithTally'), { 'voters.zoe': true, voterCount: increment(1) });
    b.update(doc(db, 'bets/openWithTally/tally/counts'), { A: increment(1) });
    await assertFails(b.commit());
  });
});
