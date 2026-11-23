import type { BetDoc, Side, Uid } from './types';

/** At most this many distinct people across sideA, sideB, and subjects. */
export const MAX_PEOPLE = 8;

type Sides = Pick<BetDoc, 'sideA' | 'sideB'>;
type Lineup = Pick<BetDoc, 'sideA' | 'sideB' | 'confirmed'>;

/** Everyone on a side, side A first. */
export function everyone(b: Sides): Uid[] {
  return [...b.sideA, ...b.sideB];
}

/**
 * The status a proposed bet must have after a member move (the rules check the same thing):
 * void if side A is empty; active if both sides have people and all of them are in; else proposed.
 */
export function nextStatus(b: Lineup): 'proposed' | 'active' | 'void' {
  if (b.sideA.length === 0) return 'void';
  if (b.sideB.length > 0 && waitingOn(b).length === 0) return 'active';
  return 'proposed';
}

/** Which side `uid` is on, or null for a subject or someone not on the bet. */
export function sideOf(b: Sides, uid: Uid): Side | null {
  if (b.sideA.includes(uid)) return 'A';
  if (b.sideB.includes(uid)) return 'B';
  return null;
}

/** People on a side who aren't in yet, side A first. */
export function waitingOn(b: Lineup): Uid[] {
  return everyone(b).filter((uid) => !b.confirmed.includes(uid));
}
