import { describe, expect, it } from 'vitest';
import { needed, owesLine, voteProgress } from '../../src/model/tally';
import { betDoc } from '../rules/helpers';

const open = { nameA: 'Maya', nameB: 'Priya', style: 'open' as const };

describe('needed', () => {
  it('is a strict majority of members', () => {
    expect(needed(6)).toBe(4);
    expect(needed(7)).toBe(4);
    expect(needed(1)).toBe(1);
  });
});

describe('voteProgress', () => {
  it('names the leader and how many more settle it', () => {
    expect(voteProgress({ forA: 3, forB: 1, voterCount: 4, memberCount: 6, ...open })).toBe(
      '4 of 6 voted. 1 more for Maya settles it.',
    );
    expect(voteProgress({ forA: 0, forB: 2, voterCount: 2, memberCount: 6, ...open })).toBe(
      '2 of 6 voted. 2 more for Priya settles it.',
    );
  });

  it('hides counts for anonymous bets', () => {
    expect(
      voteProgress({ forA: 0, forB: 0, voterCount: 3, memberCount: 6, nameA: 'Maya', nameB: 'Sam', style: 'anonymous' }),
    ).toBe("3 of 6 voted. Count shown when it's decided.");
  });

  it('says Tied once everyone voted and the sides are even', () => {
    expect(voteProgress({ forA: 3, forB: 3, voterCount: 6, memberCount: 6, ...open })).toBe('6 of 6 voted. Tied.');
  });

  it('says only the count when nobody leads', () => {
    expect(voteProgress({ forA: 0, forB: 0, voterCount: 0, memberCount: 6, ...open })).toBe('0 of 6 voted.');
    expect(voteProgress({ forA: 2, forB: 2, voterCount: 4, memberCount: 6, ...open })).toBe('4 of 6 voted.');
  });

  it('voteProgress uses the memberCount passed in', () => {
    expect(voteProgress({ forA: 3, forB: 0, voterCount: 3, memberCount: 7, ...open })).toBe(
      '3 of 7 voted. 1 more for Maya settles it.',
    );
    expect(voteProgress({ forA: 3, forB: 0, voterCount: 3, memberCount: 8, ...open })).toBe(
      '3 of 8 voted. 2 more for Maya settles it.',
    );
  });
});

describe('owesLine', () => {
  it('has the loser owe the winner her stake', () => {
    expect(owesLine(betDoc({ status: 'settled', winner: 'A', stakeB: 'a ride to the mall' }), { ava: 'Ava', jo: 'Jo' })).toBe(
      'Jo owes Ava: a ride to the mall',
    );
    expect(owesLine(betDoc({ status: 'paid', winner: 'B', stakeA: 'fries' }), { ava: 'Ava', jo: 'Jo' })).toBe(
      'Ava owes Jo: fries',
    );
  });

  it('throws when the bet has no winner', () => {
    expect(() => owesLine(betDoc(), { ava: 'Ava', jo: 'Jo' })).toThrow();
  });
});
