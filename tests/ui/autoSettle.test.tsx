// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/preact';
import { decideKey, settleKey, useBackgroundAttempt } from '../../src/ui/autoSettle';
import { bet } from './fixtures';

afterEach(cleanup);

const voting = (over = {}) => bet({ status: 'voting', ...over });

describe('settleKey (open bets)', () => {
  it('is null without a visible majority, and set once one side has more than half', () => {
    expect(settleKey(voting({ votesA: { a: true, b: true }, votesB: { c: true } }), 4)).toBeNull();
    expect(settleKey(voting({ votesA: { a: true, b: true, c: true } }), 4)).not.toBeNull();
    expect(settleKey(voting({ votesB: { a: true, b: true, c: true } }), 5)).not.toBeNull();
  });

  it('is null when not voting or the group is empty', () => {
    expect(settleKey(bet({ status: 'settled', winner: 'A', votesA: { a: true, b: true, c: true } }), 4)).toBeNull();
    expect(settleKey(voting({ votesA: { a: true } }), 0)).toBeNull();
  });

  it('changes when the counts change, not otherwise', () => {
    const k1 = settleKey(voting({ votesA: { a: true, b: true, c: true } }), 4);
    expect(settleKey(voting({ votesA: { a: true, b: true, c: true } }), 4)).toBe(k1);
    expect(settleKey(voting({ votesA: { a: true, b: true, c: true }, votesB: { d: true } }), 4)).not.toBe(k1);
  });
});

describe('settleKey (anonymous bets)', () => {
  const anon = (voterCount: number) => voting({ voteStyle: 'anonymous', voterCount });

  it('tries once more than half the members have voted, keyed on voterCount', () => {
    expect(settleKey(anon(2), 4)).toBeNull();
    const k3 = settleKey(anon(3), 4);
    expect(k3).not.toBeNull();
    expect(settleKey(anon(4), 4)).not.toBe(k3);
  });

  it('retries when the tally becomes readable, and skips a revealed tie', () => {
    expect(settleKey(anon(4), 4, { A: 3, B: 1 })).not.toBe(settleKey(anon(4), 4));
    expect(settleKey(anon(4), 4, { A: 2, B: 2 })).toBeNull();
  });
});

describe('decideKey', () => {
  it('tries once more than half the members have voted on an open request', () => {
    expect(decideKey(3, 6, 'open')).toBeNull();
    expect(decideKey(4, 6, 'open')).not.toBeNull();
    expect(decideKey(5, 6, 'open')).not.toBe(decideKey(4, 6, 'open'));
    expect(decideKey(6, 6, 'approved')).toBeNull();
    expect(decideKey(1, 0, 'open')).toBeNull();
  });
});

describe('useBackgroundAttempt', () => {
  function Probe(props: { k: string | null; fn: () => Promise<unknown>; n: number }) {
    useBackgroundAttempt(props.k, props.fn);
    return <p>{props.n}</p>;
  }

  it('runs once per key change, not per render, and swallows errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('permission-denied'));
    const { rerender } = render(<Probe k={null} fn={fn} n={0} />);
    expect(fn).not.toHaveBeenCalled();
    rerender(<Probe k="a" fn={fn} n={1} />);
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
    rerender(<Probe k="a" fn={fn} n={2} />);
    rerender(<Probe k="a" fn={fn} n={3} />);
    expect(fn).toHaveBeenCalledTimes(1);
    rerender(<Probe k="b" fn={fn} n={4} />);
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(2));
  });
});
