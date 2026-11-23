import { describe, expect, it } from 'vitest';
import { sections, tallyReadable } from '../../src/ui/sections';
import { bet } from './fixtures';

const item = (id: string, over = {}) => ({ id, bet: bet(over) });

describe('sections', () => {
  it('puts proposed bets where I am side B in needsYou, and mine in proposedByMe', () => {
    const s = sections('jo', [
      item('1', { status: 'proposed', sideA: 'ava', sideB: 'jo' }),
      item('2', { status: 'proposed', sideA: 'jo', sideB: 'ava' }),
    ]);
    expect(s.needsYou.map((x) => x.id)).toEqual(['1']);
    expect(s.proposedByMe.map((x) => x.id)).toEqual(['2']);
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
    const all = [s.needsYou, s.voting, s.active, s.settled, s.proposedByMe].flat().map((x) => x.id);
    expect(all).not.toContain('v');
  });

  it("ignores other people's proposed bets", () => {
    const s = sections('jo', [item('x', { status: 'proposed', sideA: 'ava', sideB: 'sam' })]);
    expect(s.needsYou).toEqual([]);
    expect(s.proposedByMe).toEqual([]);
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
