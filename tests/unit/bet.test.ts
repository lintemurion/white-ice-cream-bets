import { describe, expect, it } from 'vitest';
import { everyone, isOldFormat, MAX_PEOPLE, nextStatus, normalizeBet, sideLabel, sideOf, waitingOn } from '../../src/model/bet';
import { betDoc } from '../rules/helpers';

describe('nextStatus', () => {
  it('voids an empty side A, stays proposed while anyone is waiting, goes active when all are in', () => {
    expect(nextStatus({ sideA: [], sideB: ['jo'], confirmed: [] })).toBe('void');
    expect(nextStatus({ sideA: ['ava'], sideB: [], confirmed: ['ava'] })).toBe('proposed'); // open challenge
    expect(nextStatus({ sideA: ['ava'], sideB: ['jo'], confirmed: ['ava'] })).toBe('proposed');
    expect(nextStatus({ sideA: ['ava'], sideB: ['jo'], confirmed: ['ava', 'jo'] })).toBe('active');
    expect(nextStatus({ sideA: ['ava', 'mac'], sideB: ['jo'], confirmed: ['ava', 'jo'] })).toBe('proposed');
  });

  it('ignores the order of confirmed', () => {
    expect(nextStatus({ sideA: ['ava', 'mac'], sideB: ['jo'], confirmed: ['jo', 'mac', 'ava'] })).toBe('active');
  });
});

describe('waitingOn', () => {
  it('lists people on a side who are not in, side A first', () => {
    expect(waitingOn({ sideA: ['ava', 'mac'], sideB: ['jo'], confirmed: ['ava'] })).toEqual(['mac', 'jo']);
    expect(waitingOn({ sideA: ['ava'], sideB: ['jo'], confirmed: ['jo', 'ava'] })).toEqual([]);
  });
});

describe('everyone and sideOf', () => {
  it('everyone is both sides, A first', () => {
    expect(everyone({ sideA: ['ava', 'mac'], sideB: ['jo'] })).toEqual(['ava', 'mac', 'jo']);
  });

  it('sideOf finds the side or null for a subject or outsider', () => {
    const b = { sideA: ['ava'], sideB: ['jo', 'kai'] };
    expect(sideOf(b, 'ava')).toBe('A');
    expect(sideOf(b, 'kai')).toBe('B');
    expect(sideOf(b, 'zoe')).toBeNull();
  });

  it('caps a bet at 8 people', () => {
    expect(MAX_PEOPLE).toBe(8);
  });
});

describe('normalizeBet', () => {
  const old = {
    description: 'Maya texts him first',
    sideA: 'ava',
    sideB: 'jo',
    subject: 'maya',
    stakeA: '$5',
    stakeB: '$5',
    voteStyle: 'open',
    status: 'proposed',
    winner: null,
    createdBy: 'ava',
    votesA: {},
    votesB: {},
    voters: {},
    voterCount: 0,
  };

  it('normalizeBet converts the old single-id shape', () => {
    const b = normalizeBet(old);
    expect(b).toMatchObject({ sideA: ['ava'], sideB: ['jo'], subjects: ['maya'], confirmed: ['ava'], paidBy: [] });
    expect(b).not.toHaveProperty('subject');
    expect(normalizeBet({ ...old, subject: null }).subjects).toEqual([]);
    // Past proposed, everyone on a side was in.
    expect(normalizeBet({ ...old, status: 'active' }).confirmed).toEqual(['ava', 'jo']);
    expect(normalizeBet({ ...old, status: 'settled', winner: 'B' }).paidBy).toEqual([]);
    expect(normalizeBet({ ...old, status: 'paid', winner: 'B' }).paidBy).toEqual(['jo']);
    expect(normalizeBet({ ...old, status: 'paid', winner: 'A' }).paidBy).toEqual(['ava']);
  });

  it('leaves a new-shape bet as it is', () => {
    const b = betDoc({ sideA: ['ava', 'mac'], sideB: [], subjects: ['maya'], confirmed: ['ava'] });
    expect(normalizeBet(b as unknown as Record<string, unknown>)).toEqual(b);
  });

  it('isOldFormat spots any old-shape field', () => {
    expect(isOldFormat(old)).toBe(true);
    expect(isOldFormat(betDoc() as unknown as Record<string, unknown>)).toBe(false);
    const { paidBy: _paidBy, ...noPaidBy } = betDoc();
    expect(isOldFormat(noPaidBy)).toBe(true);
  });
});

describe('sideLabel', () => {
  const names = { ava: 'Ava', jo: 'Jo', mac: 'Mac', kai: 'Kai', zoe: 'Zoe' };
  it('sideLabel: one, two, three-plus names, and empty', () => {
    expect(sideLabel(['ava'], names)).toBe('Ava');
    expect(sideLabel(['ava', 'jo'], names)).toBe('Ava & Jo');
    expect(sideLabel(['ava', 'jo', 'mac'], names)).toBe('Ava, Jo +1');
    expect(sideLabel(['ava', 'jo', 'mac', 'kai', 'zoe'], names)).toBe('Ava, Jo +3');
    expect(sideLabel([], names)).toBe('(open challenge)');
  });

  it('never prints a raw uid', () => {
    expect(sideLabel(['ava', 'gone'], names)).toBe('Ava & Former member');
  });
});
