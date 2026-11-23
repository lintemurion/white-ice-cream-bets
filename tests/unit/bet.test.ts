import { describe, expect, it } from 'vitest';
import { everyone, MAX_PEOPLE, nextStatus, sideOf, waitingOn } from '../../src/model/bet';

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
