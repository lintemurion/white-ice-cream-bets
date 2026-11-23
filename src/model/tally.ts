import type { BetDoc, Uid, VoteStyle } from './types';

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
}

/**
 * Progress line for a bet in voting, against the live member count.
 * Anonymous bets never reveal counts; open bets name the leader and how many more settle it.
 */
export function voteProgress(p: VoteProgressInput): string {
  const head = `${p.voterCount} of ${p.memberCount} voted.`;
  if (p.style === 'anonymous') return `${head} Count shown when it's decided.`;

  if (p.forA === p.forB) {
    return p.forA > 0 && p.voterCount >= p.memberCount ? `${head} Tied.` : head;
  }
  const [lead, name] = p.forA > p.forB ? [p.forA, p.nameA] : [p.forB, p.nameB];
  const more = needed(p.memberCount) - lead;
  return more > 0 ? `${head} ${more} more for ${name} settles it.` : head;
}

/** "<loser> owes <winner>: <loser's stake>" for a settled or paid bet. */
export function owesLine(bet: BetDoc, names: Record<Uid, string>): string {
  if (bet.winner === null) throw new Error('owesLine needs a bet with a winner');
  const [winner, loser, stake] =
    bet.winner === 'A' ? [bet.sideA, bet.sideB, bet.stakeB] : [bet.sideB, bet.sideA, bet.stakeA];
  return `${names[loser] ?? loser} owes ${names[winner] ?? winner}: ${stake}`;
}
