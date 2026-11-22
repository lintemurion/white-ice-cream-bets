import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { ADMIN_UID, betDoc, dbAs, makeEnv, seed } from './helpers';

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
  await seed(env, {
    members: MEMBERS,
    pending: ['riley'],
    bets: {
      proposed: {},
      anon: { voteStyle: 'anonymous' },
      active: { status: 'active' },
    },
    betTallies: { anon: { A: 0, B: 0 } },
  });
});

type BetFields = Record<string, unknown>;

/** The new bet doc a client sends: ava proposes against jo unless overridden. */
function newBet(overrides: BetFields = {}): BetFields {
  const { createdAt: _fixed, ...base } = betDoc();
  return { ...base, createdAt: serverTimestamp(), ...overrides };
}

interface ProposeOpts {
  id?: string;
  /** Create the zero tally in the same batch. Defaults to true for anonymous bets. */
  tally?: boolean;
  tallyData?: BetFields;
}

/** The exact propose batch the client sends: the bet, plus its zero tally if anonymous. */
function propose(db: Firestore, overrides: BetFields = {}, o: ProposeOpts = {}) {
  const id = o.id ?? 'new';
  const bet = newBet(overrides);
  const b = writeBatch(db);
  b.set(doc(db, `bets/${id}`), bet);
  if (o.tally ?? bet.voteStyle === 'anonymous') {
    b.set(doc(db, `bets/${id}/tally/counts`), o.tallyData ?? { A: 0, B: 0 });
  }
  return b.commit();
}

/** Decline (side B) or cancel (side A): delete the bet, and its tally when anonymous. */
function withdraw(db: Firestore, id: string, o: { tally?: boolean } = {}) {
  const b = writeBatch(db);
  b.delete(doc(db, `bets/${id}`));
  if (o.tally) b.delete(doc(db, `bets/${id}/tally/counts`));
  return b.commit();
}

/** Reads a doc with rules off. */
async function peek(path: string) {
  let data: Record<string, unknown> | undefined;
  await env.withSecurityRulesDisabled(async (ctx) => {
    data = (await getDoc(doc(ctx.firestore() as unknown as Firestore, path))).data();
  });
  return data;
}

describe('propose', () => {
  it('member proposes an open bet against another member', async () => {
    await assertSucceeds(propose(dbAs(env, 'ava')));
    expect(await peek('bets/new')).toMatchObject({ sideA: 'ava', sideB: 'jo', status: 'proposed' });
  });

  it('member proposes an anonymous bet with its zero tally', async () => {
    await assertSucceeds(propose(dbAs(env, 'ava'), { voteStyle: 'anonymous' }));
    expect(await peek('bets/new/tally/counts')).toEqual({ A: 0, B: 0 });
  });

  it('anonymous bet needs its zero tally in the same batch, and only an anonymous bet gets one', async () => {
    const db = dbAs(env, 'ava');
    await assertFails(propose(db, { voteStyle: 'anonymous' }, { tally: false }));
    await assertFails(propose(db, { voteStyle: 'anonymous' }, { tallyData: { A: 1, B: 0 } }));
    await assertFails(propose(db, { voteStyle: 'open' }, { tally: true }));
    // A tally cannot be added to a bet that already exists.
    await assertFails(setDoc(doc(db, 'bets/proposed/tally/counts'), { A: 0, B: 0 }));
  });

  it('anonymous propose cannot inherit a leftover tally at the same id', async () => {
    await seed(env, { members: MEMBERS, betTallies: { new: { A: 3, B: 0 } } });
    const db = dbAs(env, 'ava');
    await assertFails(propose(db, { voteStyle: 'anonymous' }, { tally: false }));
    await assertFails(propose(db, { voteStyle: 'anonymous' }));
  });

  it('creator must be side A', async () => {
    const db = dbAs(env, 'ava');
    await assertFails(propose(db, { sideA: 'jo', sideB: 'maya' }));
    await assertFails(propose(db, { createdBy: 'jo' }));
  });

  it('cannot bet against yourself or a non-member', async () => {
    const db = dbAs(env, 'ava');
    await assertFails(propose(db, { sideB: 'ava' }));
    await assertFails(propose(db, { sideB: 'riley' }));
    await assertFails(propose(db, { sideB: ADMIN_UID }));
  });

  it('subject cannot be either side', async () => {
    const db = dbAs(env, 'ava');
    await assertFails(propose(db, { subject: 'jo', sideB: 'jo' }));
    await assertFails(propose(db, { subject: 'ava' }));
  });

  it('subject must be a member when set', async () => {
    const db = dbAs(env, 'ava');
    await assertFails(propose(db, { subject: 'riley' }));
    await assertFails(propose(db, { subject: 'nobody' }));
    await assertSucceeds(propose(db, { subject: 'maya' }));
  });

  it('rejects description over 2000 chars, stake over 500, and empty stakes', async () => {
    const db = dbAs(env, 'ava');
    await assertFails(propose(db, { description: 'x'.repeat(2001) }));
    await assertFails(propose(db, { stakeA: 'x'.repeat(501) }));
    await assertFails(propose(db, { stakeB: '' }));
    await assertSucceeds(
      propose(db, { description: 'x'.repeat(2000), stakeA: 'x'.repeat(500), stakeB: 'y'.repeat(500) }),
    );
  });

  it('rejects blank, whitespace-only, or untrimmed text', async () => {
    const db = dbAs(env, 'ava');
    await assertFails(propose(db, { description: '' }));
    await assertFails(propose(db, { description: '   ' }));
    await assertFails(propose(db, { description: ' Lakers win' }));
    await assertFails(propose(db, { stakeA: '   ' }));
    await assertFails(propose(db, { stakeB: '$5 ' }));
    await assertFails(propose(db, { stakeA: 5 }));
  });

  it('voteStyle must be open or anonymous', () =>
    assertFails(propose(dbAs(env, 'ava'), { voteStyle: 'secret' })));

  it('cannot create a bet already active or with votes', async () => {
    const db = dbAs(env, 'ava');
    await assertFails(propose(db, { status: 'active' }));
    await assertFails(propose(db, { votesA: { maya: true } }));
    await assertFails(propose(db, { voters: { maya: true } }));
    await assertFails(propose(db, { voterCount: 1 }));
    await assertFails(propose(db, { winner: 'A' }));
  });

  it('cannot add or drop fields or backdate createdAt', async () => {
    const db = dbAs(env, 'ava');
    await assertFails(propose(db, { extra: true }));
    const { voters: _v, ...missing } = newBet();
    await assertFails(setDoc(doc(db, 'bets/new'), missing));
    await assertFails(propose(db, { createdAt: betDoc().createdAt }));
  });

  it('pending user cannot propose', () =>
    assertFails(propose(dbAs(env, 'riley'), { sideA: 'riley', createdBy: 'riley' })));
});

describe('accept, decline, cancel', () => {
  it('only side B accepts; side A and others cannot', async () => {
    await assertFails(updateDoc(doc(dbAs(env, 'ava'), 'bets/proposed'), { status: 'active' }));
    await assertFails(updateDoc(doc(dbAs(env, 'maya'), 'bets/proposed'), { status: 'active' }));
    await assertSucceeds(updateDoc(doc(dbAs(env, 'jo'), 'bets/proposed'), { status: 'active' }));
    expect(await peek('bets/proposed')).toMatchObject({ status: 'active' });
  });

  it('accept cannot change stakes or voteStyle', async () => {
    const db = dbAs(env, 'jo');
    await assertFails(updateDoc(doc(db, 'bets/proposed'), { status: 'active', stakeB: '$1' }));
    await assertFails(updateDoc(doc(db, 'bets/proposed'), { status: 'active', voteStyle: 'anonymous' }));
    await assertFails(updateDoc(doc(db, 'bets/proposed'), { status: 'voting' }));
  });

  it('side B declines (deletes) a proposed bet; others cannot', async () => {
    await assertFails(deleteDoc(doc(dbAs(env, 'maya'), 'bets/proposed')));
    await assertFails(deleteDoc(doc(dbAs(env, 'riley'), 'bets/proposed')));
    await assertSucceeds(deleteDoc(doc(dbAs(env, 'jo'), 'bets/proposed')));
    expect(await peek('bets/proposed')).toBeUndefined();
  });

  it('side A cancels a proposed bet; cannot delete once active', async () => {
    await assertSucceeds(deleteDoc(doc(dbAs(env, 'ava'), 'bets/proposed')));
    await assertFails(deleteDoc(doc(dbAs(env, 'ava'), 'bets/active')));
    await assertFails(deleteDoc(doc(dbAs(env, 'jo'), 'bets/active')));
  });

  it('declining an anonymous bet deletes its tally in the same batch', async () => {
    await assertFails(withdraw(dbAs(env, 'jo'), 'anon'));
    await assertSucceeds(withdraw(dbAs(env, 'jo'), 'anon', { tally: true }));
    expect(await peek('bets/anon')).toBeUndefined();
    expect(await peek('bets/anon/tally/counts')).toBeUndefined();
  });

  it('cancelling an anonymous bet works for side A', () =>
    assertSucceeds(withdraw(dbAs(env, 'ava'), 'anon', { tally: true })));

  it('tally cannot be deleted on its own, by others, or once the bet is active', async () => {
    await assertFails(deleteDoc(doc(dbAs(env, 'jo'), 'bets/anon/tally/counts')));
    await assertFails(withdraw(dbAs(env, 'maya'), 'anon', { tally: true }));
    await seed(env, {
      members: MEMBERS,
      bets: { anon: { voteStyle: 'anonymous', status: 'active' } },
      betTallies: { anon: { A: 0, B: 0 } },
    });
    await assertFails(withdraw(dbAs(env, 'jo'), 'anon', { tally: true }));
  });
});

describe('call it', () => {
  it('any member calls it on an active bet; not on a proposed one', async () => {
    await assertFails(updateDoc(doc(dbAs(env, 'maya'), 'bets/proposed'), { status: 'voting' }));
    await assertFails(updateDoc(doc(dbAs(env, 'riley'), 'bets/active'), { status: 'voting' }));
    await assertSucceeds(updateDoc(doc(dbAs(env, 'maya'), 'bets/active'), { status: 'voting' }));
    expect(await peek('bets/active')).toMatchObject({ status: 'voting' });
  });

  it('call it changes only status', async () => {
    const db = dbAs(env, 'maya');
    await assertFails(updateDoc(doc(db, 'bets/active'), { status: 'voting', winner: 'A' }));
    await assertFails(updateDoc(doc(db, 'bets/active'), { status: 'voting', description: 'Changed' }));
  });
});

describe('admin', () => {
  it('admin can edit description of any bet', async () => {
    await assertSucceeds(updateDoc(doc(dbAs(env, 'admin'), 'bets/active'), { description: 'Fixed typo' }));
    expect(await peek('bets/active')).toMatchObject({ description: 'Fixed typo' });
  });

  it('admin can delete any bet', () => assertSucceeds(deleteDoc(doc(dbAs(env, 'admin'), 'bets/active'))));

  it('admin deleting an anonymous bet must delete its tally in the same batch', async () => {
    const db = dbAs(env, 'admin');
    await assertFails(withdraw(db, 'anon'));
    await assertSucceeds(withdraw(db, 'anon', { tally: true }));
    expect(await peek('bets/anon/tally/counts')).toBeUndefined();
  });

  it('admin cannot add himself to votesA', async () => {
    const db = dbAs(env, 'admin');
    await assertFails(updateDoc(doc(db, 'bets/active'), { [`votesA.${ADMIN_UID}`]: true }));
    await assertFails(updateDoc(doc(db, 'bets/active'), { [`votesB.${ADMIN_UID}`]: true }));
    await assertFails(updateDoc(doc(db, 'bets/anon'), { [`voters.${ADMIN_UID}`]: true }));
    await assertFails(setDoc(doc(db, 'bets/fresh'), betDoc({ votesA: { [ADMIN_UID]: true } })));
    await assertSucceeds(updateDoc(doc(db, 'bets/active'), { 'votesA.maya': true }));
  });

  it('admin cannot write a ballot under his own uid', async () => {
    const db = dbAs(env, 'admin');
    await assertFails(setDoc(doc(db, `bets/anon/ballots/${ADMIN_UID}`), { choice: 'A' }));
    await assertSucceeds(setDoc(doc(db, 'bets/anon/ballots/maya'), { choice: 'A' }));
  });
});
