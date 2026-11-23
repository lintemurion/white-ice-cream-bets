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
  proposedByMe: BetItem[];
}

/** Groups bets for the home screen. Void bets are hidden; settled lists unpaid first, then paid. */
export function sections(me: Uid, bets: BetItem[]): Sections {
  const out: Sections = { needsYou: [], voting: [], active: [], settled: [], proposedByMe: [] };
  const paid: BetItem[] = [];
  for (const item of bets) {
    switch (item.bet.status) {
      case 'proposed':
        if (item.bet.sideB === me) out.needsYou.push(item);
        else if (item.bet.sideA === me) out.proposedByMe.push(item);
        break;
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
  out.settled.push(...paid);
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
