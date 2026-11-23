import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, setLogLevel, Timestamp, type Firestore } from 'firebase/firestore';
import type { BetDoc, BetTally, JoinTally } from '../../src/model/types';

export const ADMIN_EMAIL = 'admin@example.test';
export const ADMIN_UID = 'kyle';

const RULES_SRC = fileURLToPath(new URL('../../firestore.rules.src', import.meta.url));
const FIXED_TIME = Timestamp.fromMillis(Date.UTC(2026, 0, 1));

/** Test environment running firestore.rules.src with the test admin email substituted in. */
export function makeEnv(): Promise<RulesTestEnvironment> {
  // Denied writes are expected; assertFails checks them, so keep the SDK from logging each one.
  setLogLevel('silent');
  const rules = readFileSync(RULES_SRC, 'utf8').replaceAll('__ADMIN_EMAIL__', ADMIN_EMAIL);
  return initializeTestEnvironment({ projectId: 'demo-wicb', firestore: { rules } });
}

/**
 * Firestore client acting as `who`:
 * - `'admin'`: uid `kyle` with the verified admin email
 * - `null`: unauthenticated
 * - any other string: that uid with email `<uid>@example.test`
 */
export function dbAs(env: RulesTestEnvironment, who: string | 'admin' | null): Firestore {
  const ctx =
    who === null
      ? env.unauthenticatedContext()
      : who === 'admin'
        ? env.authenticatedContext(ADMIN_UID, { email: ADMIN_EMAIL, email_verified: true })
        : env.authenticatedContext(who, { email: `${who}@example.test` });
  // The test SDK hands back a compat instance; the modular API accepts it.
  return ctx.firestore() as unknown as Firestore;
}

export interface Fixture {
  members?: string[];
  pending?: string[];
  rejected?: string[];
  former?: string[];
  bets?: Record<string, Partial<BetDoc>>;
  betTallies?: Record<string, BetTally>;
  joinTallies?: Record<string, JoinTally>;
}

export function betDoc(overrides: Partial<BetDoc> = {}): BetDoc {
  return {
    description: 'Test bet',
    sideA: 'ava',
    sideB: 'jo',
    subject: null,
    stakeA: '$5',
    stakeB: '$5',
    voteStyle: 'open',
    status: 'proposed',
    winner: null,
    createdBy: 'ava',
    createdAt: FIXED_TIME,
    votesA: {},
    votesB: {},
    voters: {},
    voterCount: 0,
    ...overrides,
  };
}

/** Writes the fixture with security rules disabled. group/members lists every seeded member. */
export async function seed(env: RulesTestEnvironment, f: Fixture): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore() as unknown as Firestore;
    const put = (path: string, data: object) => setDoc(doc(db, path), data);
    const user = (uid: string, status: string) =>
      put(`users/${uid}`, { status, displayName: uid, createdAt: FIXED_TIME });

    const members = f.members ?? [];
    const writes: Promise<void>[] = [
      put('group/main', { memberCount: members.length, lastAdmitted: null }),
      put('group/members', { uids: Object.fromEntries(members.map((uid) => [uid, true])) }),
      ...members.map((uid) => user(uid, 'member')),
      ...(f.rejected ?? []).map((uid) => user(uid, 'rejected')),
      ...(f.former ?? []).map((uid) => user(uid, 'former')),
    ];
    for (const uid of f.pending ?? []) {
      writes.push(
        user(uid, 'pending'),
        put(`joinRequests/${uid}`, {
          displayName: uid,
          status: 'open',
          voterCount: 0,
          createdAt: FIXED_TIME,
        }),
      );
      if (!f.joinTallies?.[uid]) writes.push(put(`joinRequests/${uid}/tally/counts`, { yes: 0, no: 0 }));
    }
    for (const [uid, t] of Object.entries(f.joinTallies ?? {})) {
      writes.push(put(`joinRequests/${uid}/tally/counts`, t));
    }
    for (const [id, bet] of Object.entries(f.bets ?? {})) writes.push(put(`bets/${id}`, betDoc(bet)));
    for (const [id, t] of Object.entries(f.betTallies ?? {})) writes.push(put(`bets/${id}/tally/counts`, t));
    await Promise.all(writes);
  });
}
