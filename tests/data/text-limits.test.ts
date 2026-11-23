import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, serverTimestamp, updateDoc, writeBatch, type Firestore } from 'firebase/firestore';
import { proposeBet } from '../../src/data/bets';
import { dbAs, makeEnv, seed } from '../rules/helpers';

// The rules measure text with string.size(); cleanText measures with JS .length. Observed in
// the emulator: string.size() counts UTF-16 code units, the same unit as .length (not code
// points, not UTF-8 bytes). These pin that, using characters where the three units differ.
const EMOJI = '😀'; // 1 code point, 2 UTF-16 code units, 4 UTF-8 bytes
const ACUTE = 'é'; // 1 code point, 1 UTF-16 code unit, 2 UTF-8 bytes

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await makeEnv();
});
afterAll(async () => {
  await env.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
  await seed(env, { members: ['ava', 'jo'] });
});

/** Proposes a bet as ava with a raw stake, bypassing cleanText. */
function rawPropose(db: Firestore, stake: string) {
  const ref = doc(collection(db, 'bets'));
  const b = writeBatch(db);
  b.set(ref, {
    description: 'Emoji bet',
    sideA: 'ava',
    sideB: 'jo',
    subject: null,
    stakeA: stake,
    stakeB: '$5',
    voteStyle: 'open',
    status: 'proposed',
    winner: null,
    createdBy: 'ava',
    createdAt: serverTimestamp(),
    votesA: {},
    votesB: {},
    voters: {},
    voterCount: 0,
  });
  return b.commit();
}

describe('text limits: rules and cleanText share a unit (UTF-16 code units)', () => {
  it('rules accept a stake of 250 emoji (500 units) and refuse 251 and 500 emoji', async () => {
    const ava = dbAs(env, 'ava');
    await assertSucceeds(rawPropose(ava, EMOJI.repeat(250)));
    await assertFails(rawPropose(ava, EMOJI.repeat(251)));
    await assertFails(rawPropose(ava, EMOJI.repeat(500)));
  });

  it('rules count a 2-byte character once: 500 accepted, 501 refused', async () => {
    const ava = dbAs(env, 'ava');
    await assertSucceeds(rawPropose(ava, ACUTE.repeat(500)));
    await assertFails(rawPropose(ava, ACUTE.repeat(501)));
  });

  it('rules accept a display name of 15 emoji and refuse 16 and 30', async () => {
    const ava = dbAs(env, 'ava');
    await assertSucceeds(updateDoc(doc(ava, 'users/ava'), { displayName: EMOJI.repeat(15) }));
    await assertFails(updateDoc(doc(ava, 'users/ava'), { displayName: EMOJI.repeat(16) }));
    await assertFails(updateDoc(doc(ava, 'users/ava'), { displayName: EMOJI.repeat(30) }));
  });

  it('proposeBet accepts what the rules accept and refuses before writing what they refuse', async () => {
    const ava = dbAs(env, 'ava');
    const input = { description: 'Emoji bet', opponent: 'jo', subject: null, stakeTheirs: '$5', voteStyle: 'open' as const };
    await expect(proposeBet(ava, 'ava', { ...input, stakeMine: EMOJI.repeat(250) })).resolves.toBeTypeOf('string');
    await expect(proposeBet(ava, 'ava', { ...input, stakeMine: EMOJI.repeat(251) })).rejects.toThrow(/500/);
  });
});
