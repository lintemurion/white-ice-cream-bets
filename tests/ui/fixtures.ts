import type { Timestamp } from 'firebase/firestore';
import type { BetDoc } from '../../src/model/types';

export const names = { ava: 'Ava', jo: 'Jo', maya: 'Maya', sam: 'Sam', kayla: 'Kayla', mac: 'Mac', kaden: 'Kaden' };

/** An active one-on-one bet, Ava vs Jo, both in. */
export const bet = (over: Partial<BetDoc> = {}): BetDoc => ({
  description: 'Jo cannot do 20 pushups',
  sideA: ['ava'],
  sideB: ['jo'],
  subjects: [],
  confirmed: ['ava', 'jo'],
  paidBy: [],
  stakeA: 'a ride to the mall',
  stakeB: 'a coffee',
  voteStyle: 'open',
  status: 'active',
  winner: null,
  createdBy: 'ava',
  createdAt: {} as Timestamp,
  votesA: {},
  votesB: {},
  voters: {},
  voterCount: 0,
  ...over,
});
