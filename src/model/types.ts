import type { Timestamp } from 'firebase/firestore';

export type Uid = string;

export type UserStatus = 'pending' | 'member' | 'rejected' | 'former';

/** users/{uid} */
export interface UserDoc {
  status: UserStatus;
  displayName: string;
  createdAt: Timestamp;
}

/** group/main */
export interface GroupDoc {
  memberCount: number;
  lastAdmitted: Uid | null;
}

/** group/members: every current member's uid as a key. Members only; admission adds a key. */
export interface MembersDoc {
  uids: Record<Uid, true>;
}

export type JoinStatus = 'open' | 'approved' | 'rejected';

/** joinRequests/{uid} */
export interface JoinRequestDoc {
  displayName: string;
  status: JoinStatus;
  voterCount: number;
  createdAt: Timestamp;
}

/** joinRequests/{uid}/tally/counts */
export interface JoinTally {
  yes: number;
  no: number;
}

export type Side = 'A' | 'B';

export type BetStatus = 'proposed' | 'active' | 'voting' | 'settled' | 'paid' | 'void';

export type VoteStyle = 'open' | 'anonymous';

/** bets/{betId} */
export interface BetDoc {
  description: string;
  /** The proposer first. Never empty while proposed; emptied only by a move that voids the bet. */
  sideA: Uid[];
  /** May be empty while proposed (an open challenge). */
  sideB: Uid[];
  /** Who the bet is about. Never on a side. Replaces the old single `subject`. */
  subjects: Uid[];
  /** People on a side who are in. Starts as [proposer]. */
  confirmed: Uid[];
  /** Winners who marked themselves paid. Starts empty. */
  paidBy: Uid[];
  /** What side A owes if A loses. */
  stakeA: string;
  stakeB: string;
  voteStyle: VoteStyle;
  status: BetStatus;
  winner: Side | null;
  createdBy: Uid;
  createdAt: Timestamp;
  /** Open bets only. */
  votesA: Record<Uid, true>;
  votesB: Record<Uid, true>;
  /** Anonymous bets only. */
  voters: Record<Uid, true>;
  voterCount: number;
}

/** bets/{betId}/tally/counts */
export interface BetTally {
  A: number;
  B: number;
}

/** joinRequests/{uid}/ballots/{v} (C = 'yes'|'no') and bets/{betId}/ballots/{v} (C = Side) */
export interface Ballot<C> {
  choice: C;
}
