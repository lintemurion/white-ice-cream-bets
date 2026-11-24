import { sideOf } from '../model/bet';
import type { BetDoc, Uid } from '../model/types';

export interface BetItem {
  id: string;
  bet: BetDoc;
}

export interface Sections {
  needsYou: BetItem[];
  voting: BetItem[];
  active: BetItem[];
  settled: BetItem[];
  /** Proposed bets I'm on and in, waiting on others. */
  waiting: BetItem[];
  /** Proposed bets with nobody on side B that I could join (not on it, not a subject). */
  openChallenges: BetItem[];
}

/** createdAt in ms; a pending server timestamp (null until it lands) counts as newest. */
function createdMs(item: BetItem): number {
  const t = item.bet.createdAt as { toMillis?: () => number } | null | undefined;
  return typeof t?.toMillis === 'function' ? t.toMillis() : Number.POSITIVE_INFINITY;
}

/** Newest first. Stable, so equal timestamps keep their incoming order. */
function newestFirst(items: BetItem[]): BetItem[] {
  return items.sort((x, y) => {
    const a = createdMs(x);
    const b = createdMs(y);
    return a === b ? 0 : a > b ? -1 : 1;
  });
}

/**
 * Groups bets for the home screen, newest first within each section. A proposed bet goes to
 * needsYou when I'm on a side and not in, to waiting when I'm on a side and in, and to
 * openChallenges when side B is empty and I'm neither on it nor a subject. Being on a bet
 * comes only from the sides, never from createdBy. Void bets are hidden; settled lists unpaid
 * first, then paid.
 */
export function sections(me: Uid, bets: BetItem[]): Sections {
  const out: Sections = { needsYou: [], voting: [], active: [], settled: [], waiting: [], openChallenges: [] };
  const paid: BetItem[] = [];
  for (const item of bets) {
    switch (item.bet.status) {
      case 'proposed': {
        const b = item.bet;
        if (sideOf(b, me)) (b.confirmed.includes(me) ? out.waiting : out.needsYou).push(item);
        else if (b.sideB.length === 0 && !b.subjects.includes(me)) out.openChallenges.push(item);
        break;
      }
      case 'voting':
        out.voting.push(item);
        break;
      case 'active':
        out.active.push(item);
        break;
      case 'settled':
        out.settled.push(item);
        break;
      case 'paid':
        paid.push(item);
        break;
      case 'void':
        break;
    }
  }
  newestFirst(out.needsYou);
  newestFirst(out.voting);
  newestFirst(out.active);
  newestFirst(out.waiting);
  newestFirst(out.openChallenges);
  out.settled = [...newestFirst(out.settled), ...newestFirst(paid)];
  return out;
}

/**
 * Whether the hidden anonymous tally may be read (reading it earlier is a permission error):
 * the vote is decided, or every current member has voted.
 */
export function tallyReadable(bet: BetDoc, memberCount: number): boolean {
  if (bet.voteStyle !== 'anonymous') return false;
  if (bet.status === 'settled' || bet.status === 'paid') return true;
  return bet.status === 'voting' && memberCount > 0 && bet.voterCount >= memberCount;
}
