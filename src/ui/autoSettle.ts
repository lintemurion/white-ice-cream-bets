import { useEffect } from 'preact/hooks';
import type { BetDoc, BetTally } from '../model/types';

/**
 * Background settle retries. The voter's own client tries to settle right after her vote,
 * but if she locks her phone first nobody else would. So every member's client retries
 * whenever the vote state could now show a majority. These helpers return a key that
 * changes only when the counts change (null means "don't try"), so the effect runs once
 * per change instead of on every render. A denied attempt is harmless.
 */

/** Key for a bet's settle attempt, or null when no majority can be showing. */
export function settleKey(bet: BetDoc, memberCount: number, tally?: BetTally | null): string | null {
  if (bet.status !== 'voting' || memberCount <= 0) return null;
  if (bet.voteStyle === 'open') {
    const a = Object.keys(bet.votesA).length;
    const b = Object.keys(bet.votesB).length;
    return Math.max(a, b) * 2 > memberCount ? `open:${a}:${b}:${memberCount}` : null;
  }
  // Anonymous: a majority needs more than half the members to have voted at all.
  if (bet.voterCount * 2 <= memberCount) return null;
  // Once the tally is readable, skip it when it plainly shows no majority (a tie).
  if (tally && Math.max(tally.A, tally.B) * 2 <= memberCount) return null;
  return `anon:${bet.voterCount}:${memberCount}:${tally ? `${tally.A}:${tally.B}` : 'hidden'}`;
}

/** Key for a join request's decide attempt, or null when no majority can be showing. */
export function decideKey(voterCount: number, memberCount: number, status: string): string | null {
  if (status !== 'open' || memberCount <= 0) return null;
  return voterCount * 2 > memberCount ? `join:${voterCount}:${memberCount}` : null;
}

/** Runs `attempt` once each time `key` changes to a non-null value. Errors are ignored. */
export function useBackgroundAttempt(key: string | null, attempt: () => Promise<unknown>): void {
  useEffect(() => {
    if (key === null) return;
    attempt().catch(() => {
      // Expected: another client settled first, or the rules denied it. Nothing to show.
    });
    // Keyed on the counts only, so re-renders don't retry.
  }, [key]);
}
