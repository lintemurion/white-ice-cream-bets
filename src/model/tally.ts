import { sideLabel } from './bet';
import type { BetDoc, Uid, VoteStyle } from './types';

export { FORMER } from './bet';

/** Votes one side needs to win: strictly more than half of current members. */
export function needed(memberCount: number): number {
  return Math.floor(memberCount / 2) + 1;
}

export interface VoteProgressInput {
  forA: number;
  forB: number;
  voterCount: number;
  memberCount: number;
  nameA: string;
  nameB: string;
  style: VoteStyle;
  /** Anonymous only: forA/forB hold the revealed counts (the tally is readable). */
  revealed?: boolean;
}

/**
 * Progress line for a bet in voting, against the live member count.
 * Anonymous bets hide counts until revealed (then only say Tied); open bets name the leader and how many more settle it.
 */
export function voteProgress(p: VoteProgressInput): string {
  const head = `${p.voterCount} of ${p.memberCount} voted.`;
  if (p.style === 'anonymous') {
    if (!p.revealed) return `${head} Count shown when it's decided.`;
    // Counts are out: everyone voted. Even means a tie; otherwise it is about to settle.
    return p.forA === p.forB ? `${head} Tied.` : head;
  }

  if (p.forA === p.forB) {
    return p.forA > 0 && p.voterCount >= p.memberCount ? `${head} Tied.` : head;
  }
  const [lead, name] = p.forA > p.forB ? [p.forA, p.nameA] : [p.forB, p.nameB];
  const more = needed(p.memberCount) - lead;
  return more > 0 ? `${head} ${more} more for ${name} settles it.` : head;
}

/**
 * "<losers> owe <winners>: <losing side's stake>" for a settled or paid bet, names per
 * sideLabel; "owes" when one person lost.
 */
export function owesLine(bet: BetDoc, names: Record<Uid, string>): string {
  if (bet.winner === null) throw new Error('owesLine needs a bet with a winner');
  const [winner, loser, stake] =
    bet.winner === 'A' ? [bet.sideA, bet.sideB, bet.stakeB] : [bet.sideB, bet.sideA, bet.stakeA];
  const verb = loser.length >= 2 ? 'owe' : 'owes';
  return `${sideLabel(loser, names)} ${verb} ${sideLabel(winner, names)}: ${stake}`;
}
