import { describe, expect, it } from 'vitest';
import { sections, tallyReadable } from '../../src/ui/sections';
import type { Timestamp } from 'firebase/firestore';
import { bet } from './fixtures';

const at = (ms: number) => ({ toMillis: () => ms }) as Timestamp;

const item = (id: string, over = {}) => ({ id, bet: bet(over) });

describe('sections', () => {
  it('sections: needsYou, waiting, open to join', () => {
    const s = sections('jo', [
      // Named on side B, not in yet.
      item('named', { status: 'proposed', sideA: ['ava'], sideB: ['jo'], confirmed: ['ava'] }),
      // Named on side A as a teammate, not in yet.
      item('teammate', { status: 'proposed', sideA: ['ava', 'jo'], sideB: ['sam'], confirmed: ['ava'] }),
      // My own proposal, waiting on Ava.
      item('mine', { status: 'proposed', sideA: ['jo'], sideB: ['ava'], confirmed: ['jo'], createdBy: 'jo' }),
      // My own open challenge.
      item('my-open', { status: 'proposed', sideA: ['jo'], sideB: [], confirmed: ['jo'], createdBy: 'jo' }),
      // Someone else's open challenge.
      item('open', { status: 'proposed', sideA: ['ava'], sideB: [], confirmed: ['ava'] }),
      // An open challenge about me: not offered.
      item('about-me', { status: 'proposed', sideA: ['ava'], sideB: [], subjects: ['jo'], confirmed: ['ava'] }),
      // I proposed it but left: not mine any more, but I can join it again.
      item('left', { status: 'proposed', sideA: ['ava'], sideB: ['sam'], confirmed: ['ava'], createdBy: 'jo' }),
      // A 2 vs 1 bet between others: I can join either side.
      item('others', { status: 'proposed', sideA: ['ava', 'sam'], sideB: ['lee'], confirmed: ['ava'] }),
      // A bet between others about me: not offered.
      item('others-about-me', { status: 'proposed', sideA: ['ava'], sideB: ['sam'], subjects: ['jo'], confirmed: ['ava'] }),
      // A bet already at MAX_PEOPLE: nothing I can do, not offered.
      item('full', {
        status: 'proposed',
        sideA: ['ava', 'sam', 'lee', 'kim'],
        sideB: ['zoe', 'max', 'kai', 'ron'],
        confirmed: ['ava'],
      }),
    ]);
    expect(s.needsYou.map((x) => x.id)).toEqual(['named', 'teammate']);
    expect(s.waiting.map((x) => x.id)).toEqual(['mine', 'my-open']);
    expect(s.openToJoin.map((x) => x.id)).toEqual(['open', 'left', 'others']);
  });

  it('hides void bets; settled lists unpaid bets first, then paid', () => {
    const s = sections('jo', [
      item('p', { status: 'paid', winner: 'A' }),
      item('v', { status: 'void' }),
      item('s', { status: 'settled', winner: 'B' }),
      item('a', { status: 'active' }),
      item('c', { status: 'voting' }),
    ]);
    expect(s.settled.map((x) => x.id)).toEqual(['s', 'p']);
    expect(s.active.map((x) => x.id)).toEqual(['a']);
    expect(s.voting.map((x) => x.id)).toEqual(['c']);
    const all = [s.needsYou, s.voting, s.active, s.settled, s.waiting, s.openToJoin].flat().map((x) => x.id);
    expect(all).not.toContain('v');
  });

  it('sorts each section newest first; settled keeps unpaid before paid, each newest first', () => {
    const s = sections('jo', [
      item('old', { status: 'voting', createdAt: at(1) }),
      item('new', { status: 'voting', createdAt: at(3) }),
      item('mid', { status: 'voting', createdAt: at(2) }),
      item('pending', { status: 'voting', createdAt: null as unknown as Timestamp }),
      item('p-old', { status: 'paid', winner: 'A', createdAt: at(5) }),
      item('p-new', { status: 'paid', winner: 'A', createdAt: at(9) }),
      item('s-old', { status: 'settled', winner: 'A', createdAt: at(1) }),
      item('s-new', { status: 'settled', winner: 'A', createdAt: at(4) }),
    ]);
    // A just-created bet whose server timestamp hasn't landed yet counts as newest.
    expect(s.voting.map((x) => x.id)).toEqual(['pending', 'new', 'mid', 'old']);
    expect(s.settled.map((x) => x.id)).toEqual(['s-new', 's-old', 'p-new', 'p-old']);
  });

  it("offers other people's proposed bets that have both sides as open to join", () => {
    const s = sections('jo', [item('x', { status: 'proposed', sideA: ['ava'], sideB: ['sam'], confirmed: ['ava'] })]);
    expect(s.needsYou).toEqual([]);
    expect(s.waiting).toEqual([]);
    expect(s.openToJoin.map((x) => x.id)).toEqual(['x']);
  });
});

describe('tallyReadable', () => {
  it('only anonymous bets in voting or later, and in voting only when everyone voted', () => {
    expect(tallyReadable(bet({ voteStyle: 'open', status: 'voting' }), 4)).toBe(false);
    expect(tallyReadable(bet({ voteStyle: 'anonymous', status: 'active' }), 4)).toBe(false);
    expect(tallyReadable(bet({ voteStyle: 'anonymous', status: 'voting', voterCount: 3 }), 4)).toBe(false);
    expect(tallyReadable(bet({ voteStyle: 'anonymous', status: 'voting', voterCount: 4 }), 4)).toBe(true);
    expect(tallyReadable(bet({ voteStyle: 'anonymous', status: 'settled', winner: 'A' }), 4)).toBe(true);
  });
});
