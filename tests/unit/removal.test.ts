import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import { DELETE, planRemoval, type RemovalInput, type Write } from '../../src/model/removal';
import type { BetDoc, JoinRequestDoc } from '../../src/model/types';
import { betDoc } from '../rules/helpers';

// Six members; 'zoe' is removed unless a test says otherwise.
const votes = (...uids: string[]) => Object.fromEntries(uids.map((u) => [u, true as const]));

function input(over: Partial<RemovalInput> = {}): RemovalInput {
  return { uid: 'zoe', memberCount: 6, bets: [], joins: [], ...over };
}

function joinReq(createdAtMs: number, over: Partial<JoinRequestDoc> = {}): JoinRequestDoc {
  return { displayName: 'x', status: 'open', voterCount: 0, createdAt: Timestamp.fromMillis(createdAtMs), ...over };
}

const voting = (over: Partial<BetDoc>) => betDoc({ status: 'voting', ...over });

/** The single write to `path`, or undefined. Fails if there are several. */
function at(writes: Write[], path: string): Write | undefined {
  const found = writes.filter((w) => w.path === path);
  expect(found.length).toBeLessThanOrEqual(1);
  return found[0];
}

describe('planRemoval', () => {
  it('marks her former and drops memberCount by 1', () => {
    const w = planRemoval(input());
    expect(at(w, 'users/zoe')).toEqual({ op: 'update', path: 'users/zoe', data: { status: 'former' } });
    expect(at(w, 'group/main')).toEqual({ op: 'update', path: 'group/main', data: { memberCount: 5 } });
    expect(w).toHaveLength(3);
  });

  it('removes her open vote and her anonymous ballot with matching tally decrement', () => {
    const w = planRemoval(
      input({
        bets: [
          { id: 'open1', bet: voting({ votesA: votes('ava'), votesB: votes('zoe', 'jo') }) },
          {
            id: 'anon1',
            bet: voting({ voteStyle: 'anonymous', voters: votes('ava', 'zoe'), voterCount: 2 }),
            tally: { A: 1, B: 1 },
            ballot: { choice: 'B' },
          },
        ],
        joins: [
          {
            applicant: 'riley',
            req: joinReq(1, { voterCount: 2 }),
            tally: { yes: 1, no: 1 },
            ballot: { choice: 'no' },
            voted: true,
          },
        ],
      }),
    );
    expect(at(w, 'bets/open1')).toEqual({
      op: 'update',
      path: 'bets/open1',
      data: { votesA: votes('ava'), votesB: votes('jo') },
    });
    expect(at(w, 'bets/anon1')).toEqual({
      op: 'update',
      path: 'bets/anon1',
      data: { voters: votes('ava'), voterCount: 1 },
    });
    expect(at(w, 'bets/anon1/ballots/zoe')).toEqual({ op: 'delete', path: 'bets/anon1/ballots/zoe' });
    expect(at(w, 'bets/anon1/tally/counts')).toEqual({
      op: 'update',
      path: 'bets/anon1/tally/counts',
      data: { A: 1, B: 0 },
    });
    expect(at(w, 'joinRequests/riley')).toEqual({ op: 'update', path: 'joinRequests/riley', data: { voterCount: 1 } });
    expect(at(w, 'joinRequests/riley/ballots/zoe')).toEqual({ op: 'delete', path: 'joinRequests/riley/ballots/zoe' });
    expect(at(w, 'joinRequests/riley/voters/zoe')).toEqual({ op: 'delete', path: 'joinRequests/riley/voters/zoe' });
    expect(at(w, 'joinRequests/riley/tally/counts')).toEqual({
      op: 'update',
      path: 'joinRequests/riley/tally/counts',
      data: { yes: 1, no: 0 },
    });
  });

  it('removes her from a proposed team bet; the bet goes active if everyone left is in', () => {
    const w = planRemoval(
      input({
        bets: [
          // Everyone but zoe is in: without her the bet is active.
          { id: 'p1', bet: betDoc({ sideA: ['ava', 'mac'], sideB: ['jo', 'zoe'], confirmed: ['ava', 'mac', 'jo'] }) },
          // Someone else is still waiting: stays proposed, her confirmation goes too.
          { id: 'p2', bet: betDoc({ sideA: ['ava', 'zoe'], sideB: ['jo'], confirmed: ['ava', 'zoe'] }) },
          // She is the proposer; the next on side A leads.
          { id: 'p3', bet: betDoc({ sideA: ['zoe', 'ava'], sideB: [], confirmed: ['zoe', 'ava'], createdBy: 'zoe' }) },
          // Not on it: no write.
          { id: 'p4', bet: betDoc() },
        ],
      }),
    );
    expect(at(w, 'bets/p1')).toEqual({
      op: 'update',
      path: 'bets/p1',
      data: { sideA: ['ava', 'mac'], sideB: ['jo'], confirmed: ['ava', 'mac', 'jo'], subjects: [], status: 'active' },
    });
    expect(at(w, 'bets/p2')?.data).toEqual({
      sideA: ['ava'],
      sideB: ['jo'],
      confirmed: ['ava'],
      subjects: [],
      status: 'proposed',
    });
    expect(at(w, 'bets/p3')?.data).toMatchObject({ sideA: ['ava'], sideB: [], confirmed: ['ava'], status: 'proposed' });
    expect(at(w, 'bets/p4')).toBeUndefined();
  });

  it('voids a proposed bet when she was the last on side A', () => {
    const w = planRemoval(
      input({ bets: [{ id: 'p1', bet: betDoc({ sideA: ['zoe'], sideB: ['jo'], confirmed: ['zoe', 'jo'], createdBy: 'zoe' }) }] }),
    );
    expect(at(w, 'bets/p1')?.data).toEqual({ sideA: [], sideB: ['jo'], confirmed: ['jo'], subjects: [], status: 'void' });
  });

  it('removes her from an active bet side; voids it if that side empties', () => {
    const all = (a: string[], b: string[]) => ({ status: 'active' as const, sideA: a, sideB: b, confirmed: [...a, ...b] });
    const w = planRemoval(
      input({
        bets: [
          { id: 'a1', bet: betDoc(all(['ava', 'zoe'], ['jo'])) },
          { id: 'a2', bet: betDoc(all(['ava'], ['zoe'])) },
          { id: 'a3', bet: betDoc(all(['zoe'], ['jo', 'mac'])) },
          { id: 'a4', bet: betDoc(all(['ava'], ['jo'])) },
        ],
      }),
    );
    expect(at(w, 'bets/a1')?.data).toEqual({ sideA: ['ava'], sideB: ['jo'], confirmed: ['ava', 'jo'], subjects: [] });
    expect(at(w, 'bets/a2')?.data).toEqual({ sideA: ['ava'], sideB: [], confirmed: ['ava'], subjects: [], status: 'void' });
    expect(at(w, 'bets/a3')?.data).toMatchObject({ sideA: [], status: 'void' });
    expect(at(w, 'bets/a4')).toBeUndefined();
  });

  it('removes her from subjects', () => {
    const w = planRemoval(
      input({
        bets: [
          { id: 'p1', bet: betDoc({ subjects: ['zoe', 'mac'] }) },
          { id: 'a1', bet: betDoc({ status: 'active', confirmed: ['ava', 'jo'], subjects: ['zoe'] }) },
        ],
      }),
    );
    expect(at(w, 'bets/p1')?.data).toEqual({
      sideA: ['ava'],
      sideB: ['jo'],
      confirmed: ['ava'],
      subjects: ['mac'],
      status: 'proposed',
    });
    // Still active: both sides keep their people.
    expect(at(w, 'bets/a1')?.data).toEqual({ sideA: ['ava'], sideB: ['jo'], confirmed: ['ava', 'jo'], subjects: [] });
  });

  it('keeps her on voting, settled, and paid bets', () => {
    const w = planRemoval(
      input({
        bets: [
          { id: 'v1', bet: voting({ sideA: ['zoe', 'ava'], confirmed: ['zoe', 'ava', 'jo'], subjects: ['mac'] }) },
          { id: 'v2', bet: voting({ subjects: ['zoe'], confirmed: ['ava', 'jo'] }) },
          { id: 's1', bet: betDoc({ status: 'settled', winner: 'A', sideB: ['zoe'], confirmed: ['ava', 'zoe'] }) },
          { id: 'pd1', bet: betDoc({ status: 'paid', winner: 'B', sideA: ['zoe'], paidBy: ['jo'] }) },
        ],
      }),
    );
    for (const id of ['v1', 'v2', 's1', 'pd1']) expect(at(w, `bets/${id}`)).toBeUndefined();
  });

  it('removes her from the member list', () => {
    const w = planRemoval(input());
    expect(at(w, 'group/members')).toEqual({ op: 'update', path: 'group/members', data: { 'uids.zoe': DELETE } });
  });

  it('settles a bet that was 3 of 6 for A once the count drops to 5', () => {
    const w = planRemoval(
      input({
        bets: [
          { id: 'open1', bet: voting({ votesA: votes('ava', 'jo', 'maya') }) },
          {
            id: 'anon1',
            bet: voting({ voteStyle: 'anonymous', voters: votes('ava', 'jo', 'maya'), voterCount: 3 }),
            tally: { A: 3, B: 0 },
          },
          { id: 'open2', bet: voting({ votesA: votes('ava', 'jo'), votesB: votes('maya') }) },
        ],
      }),
    );
    expect(at(w, 'bets/open1')).toEqual({ op: 'update', path: 'bets/open1', data: { status: 'settled', winner: 'A' } });
    expect(at(w, 'bets/anon1')).toEqual({ op: 'update', path: 'bets/anon1', data: { status: 'settled', winner: 'A' } });
    expect(at(w, 'bets/open2')).toBeUndefined();
  });

  it('a 3-3 bet becomes 3-2 when her B vote is removed, and settles for A with 5 members', () => {
    const w = planRemoval(
      input({
        bets: [
          { id: 'open1', bet: voting({ votesA: votes('ava', 'jo', 'maya'), votesB: votes('priya', 'sam', 'zoe') }) },
          {
            id: 'anon1',
            bet: voting({ voteStyle: 'anonymous', voters: votes('ava', 'jo', 'maya', 'priya', 'sam', 'zoe'), voterCount: 6 }),
            tally: { A: 3, B: 3 },
            ballot: { choice: 'B' },
          },
        ],
      }),
    );
    expect(at(w, 'bets/open1')).toEqual({
      op: 'update',
      path: 'bets/open1',
      data: { votesA: votes('ava', 'jo', 'maya'), votesB: votes('priya', 'sam'), status: 'settled', winner: 'A' },
    });
    expect(at(w, 'bets/anon1')).toEqual({
      op: 'update',
      path: 'bets/anon1',
      data: { voters: votes('ava', 'jo', 'maya', 'priya', 'sam'), voterCount: 5, status: 'settled', winner: 'A' },
    });
    expect(at(w, 'bets/anon1/tally/counts')?.data).toEqual({ A: 3, B: 2 });
  });

  it('admits a pending girl whose 3 yes now beat 5 members, then uses 6 for the bets after', () => {
    const w = planRemoval(
      input({
        bets: [
          // 3 of 6 again after the admission: stays open.
          { id: 'stays', bet: voting({ votesA: votes('ava', 'jo', 'maya') }) },
          // 4 of 6: settles.
          { id: 'settles', bet: voting({ votesB: votes('ava', 'jo', 'maya', 'priya') }) },
        ],
        joins: [
          // Created second, so tallied second: 3 yes against 6 is not enough.
          { applicant: 'tess', req: joinReq(2, { voterCount: 3 }), tally: { yes: 3, no: 0 }, voted: false },
          { applicant: 'riley', req: joinReq(1, { voterCount: 3 }), tally: { yes: 3, no: 0 }, voted: false },
          // 3 no against 6: stays open.
          { applicant: 'uma', req: joinReq(3, { voterCount: 3 }), tally: { yes: 0, no: 3 }, voted: false },
        ],
      }),
    );
    expect(at(w, 'joinRequests/riley')).toEqual({ op: 'update', path: 'joinRequests/riley', data: { status: 'approved' } });
    expect(at(w, 'users/riley')).toEqual({ op: 'update', path: 'users/riley', data: { status: 'member' } });
    expect(at(w, 'group/main')).toEqual({
      op: 'update',
      path: 'group/main',
      data: { memberCount: 6, lastAdmitted: 'riley' },
    });
    expect(at(w, 'group/members')?.data).toEqual({ 'uids.zoe': DELETE, 'uids.riley': true });
    expect(at(w, 'joinRequests/tess')).toBeUndefined();
    expect(at(w, 'joinRequests/uma')).toBeUndefined();
    expect(at(w, 'bets/stays')).toBeUndefined();
    expect(at(w, 'bets/settles')).toEqual({ op: 'update', path: 'bets/settles', data: { status: 'settled', winner: 'B' } });
  });

  it('rejects a pending girl whose no votes now beat the lower count', () => {
    const w = planRemoval(
      input({
        joins: [{ applicant: 'riley', req: joinReq(1, { voterCount: 3 }), tally: { yes: 0, no: 3 }, voted: false }],
      }),
    );
    expect(at(w, 'joinRequests/riley')?.data).toEqual({ status: 'rejected' });
    expect(at(w, 'users/riley')?.data).toEqual({ status: 'rejected' });
    expect(at(w, 'group/main')?.data).toEqual({ memberCount: 5 });
  });

  it('leaves decided join requests and votes on settled bets alone', () => {
    const w = planRemoval(
      input({
        bets: [{ id: 's1', bet: betDoc({ status: 'settled', winner: 'A', votesA: votes('zoe', 'ava', 'jo', 'maya') }) }],
        joins: [
          { applicant: 'riley', req: joinReq(1, { status: 'approved', voterCount: 4 }), tally: { yes: 4, no: 0 }, ballot: { choice: 'yes' }, voted: true },
        ],
      }),
    );
    expect(w.map((x) => x.path).sort()).toEqual(['group/main', 'group/members', 'users/zoe']);
  });
});
