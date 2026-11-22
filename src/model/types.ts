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
  /** Always the creator. */
  sideA: Uid;
  sideB: Uid;
  subject: string | null;
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
