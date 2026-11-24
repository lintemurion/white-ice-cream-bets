import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, type Firestore } from 'firebase/firestore';
import { castJoinVote, requestToJoin, tryDecideJoin } from '../../src/data/joins';
import { dbAs, makeEnv, seed } from '../rules/helpers';

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

async function voteAll(applicant: string, choices: Array<'yes' | 'no'>) {
  for (const [i, c] of choices.entries()) await castJoinVote(as(MEMBERS[i]), MEMBERS[i], applicant, c);
}

describe('joins data layer', () => {
  it('requestToJoin then four yes votes then tryDecideJoin approves; memberCount 7', async () => {
    await requestToJoin(as('riley'), 'riley', '  Riley  ');
    expect(await peek('users/riley')).toMatchObject({ status: 'pending', displayName: 'Riley' });
    expect(await peek('joinRequests/riley')).toMatchObject({ status: 'open', displayName: 'Riley', voterCount: 0 });

    await voteAll('riley', ['yes', 'yes', 'yes', 'yes']);
    expect(await tryDecideJoin(as('sam'), 'riley')).toBe('approved');

    expect(await peek('group/main')).toEqual({ memberCount: 7, lastAdmitted: 'riley' });
    expect(await peek('group/members')).toEqual({
      uids: Object.fromEntries([...MEMBERS, 'riley'].map((u) => [u, true])),
    });
    expect(await peek('users/riley')).toMatchObject({ status: 'member' });
    expect(await peek('joinRequests/riley')).toMatchObject({ status: 'approved', voterCount: 4 });
    // Already decided: a second attempt returns null quietly.
    expect(await tryDecideJoin(as('zoe'), 'riley')).toBeNull();
  });

  it('tryDecideJoin explains a missing member list instead of returning null', async () => {
    await requestToJoin(as('riley'), 'riley', 'Riley');
    await voteAll('riley', ['yes', 'yes', 'yes', 'yes']);
    await env.withSecurityRulesDisabled((ctx) => deleteDoc(doc(ctx.firestore() as unknown as Firestore, 'group/members')));
    await expect(tryDecideJoin(as('sam'), 'riley')).rejects.toThrow('The group needs a quick upgrade. Ask Kyle.');
    expect(await peek('users/riley')).toMatchObject({ status: 'pending' });
  });

  it('tryDecideJoin still rejects while the member list is missing', async () => {
    await requestToJoin(as('riley'), 'riley', 'Riley');
    await voteAll('riley', ['no', 'no', 'no', 'no']);
    await env.withSecurityRulesDisabled((ctx) => deleteDoc(doc(ctx.firestore() as unknown as Firestore, 'group/members')));
    expect(await tryDecideJoin(as('ava'), 'riley')).toBe('rejected');
  });

  it('tryDecideJoin returns null with 3 yes of 6', async () => {
    await requestToJoin(as('riley'), 'riley', 'Riley');
    await voteAll('riley', ['yes', 'yes', 'yes']);
    expect(await tryDecideJoin(as('ava'), 'riley')).toBeNull();
    expect(await peek('joinRequests/riley')).toMatchObject({ status: 'open' });
    expect(await peek('group/main')).toMatchObject({ memberCount: 6 });
  });

  it('castJoinVote twice with the same choice leaves tally unchanged; switching moves it', async () => {
    await requestToJoin(as('riley'), 'riley', 'Riley');
    await castJoinVote(as('ava'), 'ava', 'riley', 'yes');
    await castJoinVote(as('ava'), 'ava', 'riley', 'yes');
    expect(await peek('joinRequests/riley/tally/counts')).toEqual({ yes: 1, no: 0 });
    expect(await peek('joinRequests/riley')).toMatchObject({ voterCount: 1 });

    await castJoinVote(as('ava'), 'ava', 'riley', 'no');
    expect(await peek('joinRequests/riley/tally/counts')).toEqual({ yes: 0, no: 1 });
    expect(await peek('joinRequests/riley/ballots/ava')).toEqual({ choice: 'no' });
    expect(await peek('joinRequests/riley')).toMatchObject({ voterCount: 1 });
  });

  it('four no votes then tryDecideJoin rejects; user status rejected', async () => {
    await requestToJoin(as('riley'), 'riley', 'Riley');
    await voteAll('riley', ['no', 'no', 'no', 'no']);
    expect(await tryDecideJoin(as('ava'), 'riley')).toBe('rejected');
    expect(await peek('users/riley')).toMatchObject({ status: 'rejected' });
    expect(await peek('joinRequests/riley')).toMatchObject({ status: 'rejected' });
    expect(await peek('group/main')).toMatchObject({ memberCount: 6 });
  });

  it('requestToJoin rejects a blank or too-long name before writing', async () => {
    await expect(requestToJoin(as('riley'), 'riley', '   ')).rejects.toThrow(/name/i);
    await expect(requestToJoin(as('riley'), 'riley', 'x'.repeat(31))).rejects.toThrow(/name/i);
    expect(await peek('users/riley')).toBeUndefined();
  });
});
