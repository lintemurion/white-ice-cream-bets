import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, type Firestore } from 'firebase/firestore';
import { updateMyName } from '../../src/data/profile';
import { dbAs, makeEnv, seed } from '../rules/helpers';

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

async function nameOf(uid: string) {
  let name: unknown;
  await env.withSecurityRulesDisabled(async (ctx) => {
    name = (await getDoc(doc(ctx.firestore() as unknown as Firestore, `users/${uid}`))).data()?.displayName;
  });
  return name;
}

describe('updateMyName', () => {
  it('trims and saves the member\'s own name', async () => {
    await updateMyName(dbAs(env, 'ava'), 'ava', '  Avie  ');
    expect(await nameOf('ava')).toBe('Avie');
  });
  it('rejects blank and over-30 names before writing', async () => {
    await expect(updateMyName(dbAs(env, 'ava'), 'ava', '   ')).rejects.toThrow(/blank/);
    await expect(updateMyName(dbAs(env, 'ava'), 'ava', 'x'.repeat(31))).rejects.toThrow(/30/);
  });
  it('the rules refuse changing someone else\'s name', async () => {
    await expect(updateMyName(dbAs(env, 'ava'), 'jo', 'Hacked')).rejects.toMatchObject({ code: 'permission-denied' });
  });
});
