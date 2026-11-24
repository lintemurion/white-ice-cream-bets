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

// Nine members so the 8-person cap can be tested with members only.
const MEMBERS = ['ava', 'jo', 'mac', 'kai', 'zoe', 'maya', 'priya', 'sam', 'lee'];

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
    former: ['fay'],
    bets: {
      // ava vs jo, ava is in.
      proposed: {},
      // ava alone, side B empty.
      open: { sideB: [] },
      // ava & mac vs jo & kai, about zoe; only ava is in.
      team: { sideA: ['ava', 'mac'], sideB: ['jo', 'kai'], subjects: ['zoe'], confirmed: ['ava'] },
      // Same, everyone but kai is in.
      almost: {
        sideA: ['ava', 'mac'],
        sideB: ['jo', 'kai'],
        subjects: ['zoe'],
        confirmed: ['ava', 'mac', 'jo'],
      },
      anon: { voteStyle: 'anonymous' },
      active: { status: 'active', confirmed: ['ava', 'jo'] },
      cancelled: { status: 'void', sideA: [], confirmed: [] },
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

/** Delete the bet, and its tally when asked, in one batch. */
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

/** A member move (join, switch, leave, I'm in): the new lists and status, plus anything extra. */
type Move = Record<string, unknown>;

const move = (who: string, id: string, m: Move) => updateDoc(doc(dbAs(env, who), `bets/${id}`), m);

describe('propose', () => {
  it('proposes a 2 vs 2 bet with two subjects', async () => {
    await assertSucceeds(
      propose(dbAs(env, 'ava'), {
        sideA: ['ava', 'mac'],
        sideB: ['jo', 'kai'],
        subjects: ['zoe', 'maya'],
      }),
    );
    expect(await peek('bets/new')).toMatchObject({
      sideA: ['ava', 'mac'],
      sideB: ['jo', 'kai'],
      subjects: ['zoe', 'maya'],
      confirmed: ['ava'],
      paidBy: [],
      status: 'proposed',
    });
  });

  it('proposes an open challenge with empty side B', async () => {
    await assertSucceeds(propose(dbAs(env, 'ava'), { sideB: [] }));
    expect(await peek('bets/new')).toMatchObject({ sideA: ['ava'], sideB: [], status: 'proposed' });
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

  it('proposer must be on side A and confirmed must be exactly the proposer', async () => {
    const db = dbAs(env, 'ava');
    await assertFails(propose(db, { sideA: ['mac'], sideB: ['jo'] }));
    await assertFails(propose(db, { sideA: ['mac'], sideB: ['ava'] }));
    await assertFails(propose(db, { sideA: [], sideB: ['jo'], confirmed: [] }));
    await assertFails(propose(db, { createdBy: 'jo' }));
    await assertFails(propose(db, { sideA: ['ava', 'mac'], confirmed: ['ava', 'mac'] }));
    await assertFails(propose(db, { confirmed: ['ava', 'jo'] }));
    await assertFails(propose(db, { confirmed: [] }));
    await assertFails(propose(db, { confirmed: ['ava', 'ava'] }));
    await assertFails(propose(db, { paidBy: ['ava'] }));
  });

  it('proposer must be first on side A', async () => {
    const db = dbAs(env, 'ava');
    await assertFails(propose(db, { sideA: ['mac', 'ava'] }));
    await assertFails(propose(db, { sideA: ['mac', 'kai', 'ava'] }));
    await assertSucceeds(propose(db, { sideA: ['ava', 'mac'] }));
    expect(await peek('bets/new')).toMatchObject({ sideA: ['ava', 'mac'] });
  });

  it('rejects a subject on a side, duplicates, a person on both sides, and 9 people', async () => {
    const db = dbAs(env, 'ava');
    await assertFails(propose(db, { subjects: ['jo'] }));
    await assertFails(propose(db, { subjects: ['ava'] }));
    await assertFails(propose(db, { sideA: ['ava', 'ava'] }));
    await assertFails(propose(db, { sideB: ['jo', 'jo'] }));
    await assertFails(propose(db, { subjects: ['zoe', 'zoe'] }));
    await assertFails(propose(db, { sideA: ['ava', 'mac'], sideB: ['jo', 'mac'] }));
    await assertFails(propose(db, { sideB: ['ava'] }));
    const nine = { sideA: ['ava', 'mac', 'kai'], sideB: ['jo', 'zoe', 'maya'], subjects: ['priya', 'sam', 'lee'] };
    await assertFails(propose(db, nine));
    await assertSucceeds(propose(db, { ...nine, subjects: ['priya', 'sam'] }));
  });

  it('rejects people fields that are not lists, and the old subject field', async () => {
    const db = dbAs(env, 'ava');
    await assertFails(propose(db, { sideA: 'ava' }));
    await assertFails(propose(db, { sideB: 'jo' }));
    await assertFails(propose(db, { subjects: null }));
    await assertFails(propose(db, { subject: null }));
  });

  it('rejects a non-member or former member anywhere on the bet', async () => {
    const db = dbAs(env, 'ava');
    for (const who of ['riley', 'fay', ADMIN_UID, 'nobody']) {
      await assertFails(propose(db, { sideA: ['ava', who] }));
      await assertFails(propose(db, { sideB: [who] }));
      await assertFails(propose(db, { subjects: [who] }));
    }
  });

  it('proposing needs the member list', async () => {
    await env.withSecurityRulesDisabled((ctx) =>
      deleteDoc(doc(ctx.firestore() as unknown as Firestore, 'group/members')),
    );
    await assertFails(propose(dbAs(env, 'ava')));
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
    const { paidBy: _p, ...noPaid } = newBet();
    await assertFails(setDoc(doc(db, 'bets/new'), noPaid));
    await assertFails(propose(db, { createdAt: betDoc().createdAt }));
  });

  it('pending user cannot propose', () =>
    assertFails(propose(dbAs(env, 'riley'), { sideA: ['riley'], createdBy: 'riley', confirmed: ['riley'] })));
});

describe("join, switch, leave, I'm in", () => {
  it('a non-member of the bet joins side B of an open challenge and, with side A all in, it goes active', async () => {
    await assertSucceeds(move('zoe', 'open', { sideB: ['zoe'], confirmed: ['ava', 'zoe'], status: 'active' }));
    expect(await peek('bets/open')).toMatchObject({ sideB: ['zoe'], confirmed: ['ava', 'zoe'], status: 'active' });
  });

  it('joining must also set the right status (proposed stays proposed when someone is still waiting)', async () => {
    // Open challenge with side A all in: joining B completes it, so it must go active.
    await assertFails(move('zoe', 'open', { sideB: ['zoe'], confirmed: ['ava', 'zoe'] }));
    await assertFails(move('zoe', 'open', { sideB: ['zoe'], confirmed: ['ava', 'zoe'], status: 'void' }));
    // jo is still waiting, so mac joining side A keeps it proposed.
    await assertFails(move('mac', 'proposed', { sideA: ['ava', 'mac'], confirmed: ['ava', 'mac'], status: 'active' }));
    await assertSucceeds(move('mac', 'proposed', { sideA: ['ava', 'mac'], confirmed: ['ava', 'mac'] }));
  });

  it('joining marks me in', async () => {
    await assertFails(move('mac', 'proposed', { sideA: ['ava', 'mac'] }));
    await assertFails(move('zoe', 'open', { sideB: ['zoe'] }));
  });

  it('pending, former, and signed-out users cannot join', async () => {
    await assertFails(move('riley', 'open', { sideB: ['riley'], confirmed: ['ava', 'riley'], status: 'active' }));
    await assertFails(move('fay', 'open', { sideB: ['fay'], confirmed: ['ava', 'fay'], status: 'active' }));
    await assertFails(
      updateDoc(doc(dbAs(env, null), 'bets/open'), { sideB: ['x'], confirmed: ['ava', 'x'], status: 'active' }),
    );
  });

  it('a member missing from the member list cannot join', async () => {
    await env.withSecurityRulesDisabled((ctx) =>
      setDoc(doc(ctx.firestore() as unknown as Firestore, 'group/members'), { uids: { ava: true, jo: true } }),
    );
    await assertFails(move('zoe', 'open', { sideB: ['zoe'], confirmed: ['ava', 'zoe'], status: 'active' }));
  });

  it('subject cannot join either side', async () => {
    await assertFails(move('zoe', 'team', { sideA: ['ava', 'mac', 'zoe'], confirmed: ['ava', 'zoe'] }));
    await assertFails(move('zoe', 'team', { sideB: ['jo', 'kai', 'zoe'], confirmed: ['ava', 'zoe'] }));
    // Even when the subject's join would complete the bet.
    await seed(env, { members: MEMBERS, bets: { openAbout: { sideB: [], subjects: ['zoe'] } } });
    await assertFails(move('zoe', 'openAbout', { sideB: ['zoe'], confirmed: ['ava', 'zoe'], status: 'active' }));
  });

  it('cannot add or remove someone else on a side or in confirmed', async () => {
    // ava adds mac, removes jo, or confirms jo.
    await assertFails(move('ava', 'proposed', { sideA: ['ava', 'mac'], confirmed: ['ava', 'mac'] }));
    await assertFails(move('ava', 'proposed', { sideA: ['ava', 'mac'] }));
    await assertFails(move('ava', 'proposed', { sideB: [] }));
    await assertFails(move('ava', 'proposed', { confirmed: ['ava', 'jo'], status: 'active' }));
    // mac joins and brings kai along, or joins and confirms jo.
    await assertFails(
      move('mac', 'proposed', { sideA: ['ava', 'mac', 'kai'], confirmed: ['ava', 'mac', 'kai'] }),
    );
    await assertFails(
      move('mac', 'proposed', { sideA: ['ava', 'mac'], confirmed: ['ava', 'mac', 'jo'], status: 'active' }),
    );
    // An outsider takes ava out of confirmed, or reorders side A.
    await assertFails(move('sam', 'team', { confirmed: [] }));
    await assertFails(move('sam', 'team', { sideA: ['mac', 'ava'] }));
    // jo swaps kai out for sam on side B.
    await assertFails(move('jo', 'team', { sideB: ['jo', 'sam'] }));
  });

  it('cannot un-confirm while staying on a side', async () => {
    // ava (the proposer, in) takes herself out of confirmed but stays on side A.
    await assertFails(move('ava', 'team', { confirmed: [] }));
    await assertFails(move('ava', 'proposed', { confirmed: [] }));
    // mac, in on `almost`, un-confirms; or joins then un-confirms in a later write.
    await assertFails(move('mac', 'almost', { confirmed: ['ava', 'jo'] }));
    await assertSucceeds(move('sam', 'proposed', { sideB: ['jo', 'sam'], confirmed: ['ava', 'sam'] }));
    await assertFails(move('sam', 'proposed', { confirmed: ['ava'] }));
    // An in switcher stays in.
    await assertFails(move('mac', 'almost', { sideA: ['ava'], sideB: ['jo', 'kai', 'mac'], confirmed: ['ava', 'jo'] }));
    await assertSucceeds(
      move('mac', 'almost', { sideA: ['ava'], sideB: ['jo', 'kai', 'mac'], confirmed: ['ava', 'mac', 'jo'] }),
    );
    // Leaving still takes me out of confirmed.
    await assertSucceeds(move('sam', 'proposed', { sideB: ['jo'], confirmed: ['ava'] }));
  });

  it('a joiner is added at the end, not the front', async () => {
    // mac joins side A of team at the front, or in the middle of side B.
    await assertFails(move('sam', 'team', { sideA: ['sam', 'ava', 'mac'], confirmed: ['ava', 'sam'] }));
    await assertFails(move('sam', 'team', { sideB: ['jo', 'sam', 'kai'], confirmed: ['ava', 'sam'] }));
    // kai switches to the front of side A.
    await assertFails(
      move('kai', 'team', { sideA: ['kai', 'ava', 'mac'], sideB: ['jo'], confirmed: ['ava', 'kai'] }),
    );
    // Someone already on a side cannot move themselves to the front.
    await assertFails(move('mac', 'team', { sideA: ['mac', 'ava'] }));
    await assertFails(move('mac', 'team', { sideA: ['mac', 'ava'], confirmed: ['ava', 'mac'] }));
    await assertSucceeds(move('sam', 'team', { sideB: ['jo', 'kai', 'sam'], confirmed: ['ava', 'sam'] }));
    expect(await peek('bets/team')).toMatchObject({ sideB: ['jo', 'kai', 'sam'] });
  });

  it('cannot add myself twice, to both sides, or to confirmed without being on a side', async () => {
    await assertFails(move('mac', 'proposed', { sideA: ['ava', 'mac', 'mac'], confirmed: ['ava', 'mac'] }));
    await assertFails(move('mac', 'proposed', { sideA: ['ava', 'mac'], confirmed: ['ava', 'mac', 'mac'] }));
    await assertFails(move('mac', 'proposed', { confirmed: ['ava', 'mac'] }));
    await assertFails(
      move('mac', 'proposed', { sideA: ['ava', 'mac'], sideB: ['jo', 'mac'], confirmed: ['ava', 'mac'] }),
    );
  });

  it('cannot join a bet already at 8 people', async () => {
    await seed(env, {
      members: MEMBERS,
      bets: {
        full: {
          sideA: ['ava', 'mac', 'kai'],
          sideB: ['jo', 'zoe', 'maya'],
          subjects: ['priya', 'sam'],
          confirmed: ['ava'],
        },
      },
    });
    await assertFails(move('lee', 'full', { sideB: ['jo', 'zoe', 'maya', 'lee'], confirmed: ['ava', 'lee'] }));
    // Moves within a full bet still work.
    await assertSucceeds(move('jo', 'full', { confirmed: ['ava', 'jo'] }));
  });

  it("I'm in adds only me; the last I'm in must set active", async () => {
    await assertSucceeds(move('mac', 'team', { confirmed: ['ava', 'mac'] }));
    await assertFails(move('jo', 'team', { confirmed: ['ava', 'mac', 'jo', 'kai'] }));
    await assertFails(move('kai', 'almost', { confirmed: ['ava', 'mac', 'jo', 'kai'] }));
    await assertSucceeds(move('kai', 'almost', { confirmed: ['ava', 'mac', 'jo', 'kai'], status: 'active' }));
    expect(await peek('bets/almost')).toMatchObject({ status: 'active' });
  });

  it('switch moves only me and marks me in', async () => {
    // kai switches to A without marking in: refused.
    await assertFails(move('kai', 'team', { sideA: ['ava', 'mac', 'kai'], sideB: ['jo'] }));
    // kai switches and takes jo along: refused.
    await assertFails(
      move('kai', 'team', { sideA: ['ava', 'mac', 'kai'], sideB: [], confirmed: ['ava', 'kai'] }),
    );
    await assertSucceeds(
      move('kai', 'team', { sideA: ['ava', 'mac', 'kai'], sideB: ['jo'], confirmed: ['ava', 'kai'] }),
    );
    expect(await peek('bets/team')).toMatchObject({
      sideA: ['ava', 'mac', 'kai'],
      sideB: ['jo'],
      confirmed: ['ava', 'kai'],
      status: 'proposed',
    });
  });

  it('switching so everyone is in on both sides must set active', async () => {
    // jo (the only one waiting) switches to A; B is now empty, so it stays proposed.
    await assertSucceeds(move('jo', 'proposed', { sideA: ['ava', 'jo'], sideB: [], confirmed: ['ava', 'jo'] }));
    // In `almost`, kai switching to A completes it.
    const all = { sideA: ['ava', 'mac', 'kai'], sideB: ['jo'], confirmed: ['ava', 'mac', 'jo', 'kai'] };
    await assertFails(move('kai', 'almost', all));
    await assertSucceeds(move('kai', 'almost', { ...all, status: 'active' }));
  });

  it('leave removes me from my side and confirmed', async () => {
    // ava (in) leaves team: she must leave confirmed too.
    await assertFails(move('ava', 'team', { sideA: ['mac'] }));
    await assertSucceeds(move('ava', 'team', { sideA: ['mac'], confirmed: [] }));
    // mac (not in) leaves, emptying side A.
    await assertSucceeds(move('mac', 'team', { sideA: [], status: 'void' }));
    expect(await peek('bets/team')).toMatchObject({ sideA: [], confirmed: [], status: 'void' });
  });

  it('leaving that leaves everyone else in must set active', async () => {
    // kai (the only one waiting) leaves `almost`.
    await assertFails(move('kai', 'almost', { sideB: ['jo'] }));
    await assertSucceeds(move('kai', 'almost', { sideB: ['jo'], status: 'active' }));
  });

  it('switching away as the last on side A voids the bet', async () => {
    await assertFails(move('ava', 'proposed', { sideA: [], sideB: ['jo', 'ava'] }));
    await assertFails(move('ava', 'proposed', { sideA: [], sideB: ['jo', 'ava'], status: 'active' }));
    await assertSucceeds(move('ava', 'proposed', { sideA: [], sideB: ['jo', 'ava'], status: 'void' }));
    expect(await peek('bets/proposed')).toMatchObject({ sideA: [], status: 'void' });
  });

  it('leaving as the last on side A voids the bet', async () => {
    await assertFails(move('ava', 'open', { sideA: [], confirmed: [] }));
    await assertSucceeds(move('ava', 'open', { sideA: [], confirmed: [], status: 'void' }));
  });

  it('leaving side B entirely on a proposed bet makes it an open challenge, not void', async () => {
    await assertFails(move('jo', 'proposed', { sideB: [], status: 'void' }));
    await assertFails(move('jo', 'proposed', { sideB: [], status: 'active' }));
    await assertSucceeds(move('jo', 'proposed', { sideB: [] }));
    expect(await peek('bets/proposed')).toMatchObject({ sideB: [], status: 'proposed' });
  });

  it("no moves once active: join, switch, leave, and I'm in all fail", async () => {
    await assertFails(move('mac', 'active', { sideA: ['ava', 'mac'], confirmed: ['ava', 'jo', 'mac'] }));
    await assertFails(move('jo', 'active', { sideA: ['ava', 'jo'], sideB: [] }));
    await assertFails(move('jo', 'active', { sideB: [], confirmed: ['ava'] }));
    await assertFails(move('jo', 'active', { confirmed: ['ava'] }));
    await assertFails(move('jo', 'active', { confirmed: ['ava'], status: 'proposed' }));
    // An active bet with someone not in (only the admin could make one) still takes no I'm in.
    await seed(env, { members: MEMBERS, bets: { odd: { status: 'active' } } });
    await assertFails(move('jo', 'odd', { confirmed: ['ava', 'jo'] }));
  });

  it('no moves once voting or void', async () => {
    await seed(env, { members: MEMBERS, bets: { voting: { status: 'voting', confirmed: ['ava', 'jo'] } } });
    await assertFails(move('jo', 'voting', { sideB: [], confirmed: ['ava'] }));
    await assertFails(move('mac', 'cancelled', { sideA: ['mac'], confirmed: ['mac'], status: 'proposed' }));
  });

  it('cannot change subjects, stakes, or voteStyle in a move', async () => {
    const join = { sideA: ['ava', 'mac'], confirmed: ['ava', 'mac'] };
    await assertFails(move('mac', 'proposed', { ...join, subjects: ['zoe'] }));
    await assertFails(move('mac', 'proposed', { ...join, stakeA: '$1' }));
    await assertFails(move('mac', 'proposed', { ...join, voteStyle: 'anonymous' }));
    await assertFails(move('mac', 'proposed', { ...join, paidBy: ['mac'] }));
    await assertFails(move('mac', 'proposed', { ...join, createdBy: 'mac' }));
    // A subject can't take themselves off the subjects either.
    await assertFails(move('zoe', 'team', { subjects: [] }));
  });

  it('members cannot delete bets anymore', async () => {
    await assertFails(deleteDoc(doc(dbAs(env, 'ava'), 'bets/proposed')));
    await assertFails(deleteDoc(doc(dbAs(env, 'jo'), 'bets/proposed')));
    await assertFails(deleteDoc(doc(dbAs(env, 'ava'), 'bets/cancelled')));
    await assertFails(withdraw(dbAs(env, 'ava'), 'anon', { tally: true }));
    await assertFails(withdraw(dbAs(env, 'jo'), 'anon', { tally: true }));
    await assertFails(deleteDoc(doc(dbAs(env, 'jo'), 'bets/anon/tally/counts')));
  });
});

describe('call it', () => {
  it('call it still works on an active bet', async () => {
    await assertFails(updateDoc(doc(dbAs(env, 'maya'), 'bets/proposed'), { status: 'voting' }));
    await assertFails(updateDoc(doc(dbAs(env, 'riley'), 'bets/active'), { status: 'voting' }));
    await assertSucceeds(updateDoc(doc(dbAs(env, 'maya'), 'bets/active'), { status: 'voting' }));
    expect(await peek('bets/active')).toMatchObject({ status: 'voting' });
  });

  it('call it changes only status', async () => {
    const db = dbAs(env, 'maya');
    await assertFails(updateDoc(doc(db, 'bets/active'), { status: 'voting', winner: 'A' }));
    await assertFails(updateDoc(doc(db, 'bets/active'), { status: 'voting', description: 'Changed' }));
    await assertFails(updateDoc(doc(db, 'bets/active'), { status: 'voting', sideB: [] }));
  });
});

describe('admin', () => {
  it('admin can edit description and subjects of any bet', async () => {
    await assertSucceeds(updateDoc(doc(dbAs(env, 'admin'), 'bets/active'), { description: 'Fixed typo' }));
    await assertSucceeds(updateDoc(doc(dbAs(env, 'admin'), 'bets/active'), { subjects: ['maya'] }));
    expect(await peek('bets/active')).toMatchObject({ description: 'Fixed typo', subjects: ['maya'] });
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
