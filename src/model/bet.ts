import type { BetDoc, BetStatus, Side, Uid } from './types';

/** Shown for a uid with no name on record. */
export const FORMER = 'Former member';

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

/**
 * Names on a side for a card: one or two joined with " & ", more as "<first>, <second> +<n>",
 * and "(open challenge)" for nobody. A uid with no name on record shows as FORMER.
 */
export function sideLabel(uids: Uid[], names: Record<Uid, string>): string {
  if (uids.length === 0) return '(open challenge)';
  const [first, second] = uids.map((u) => names[u] ?? FORMER);
  if (uids.length === 1) return first;
  if (uids.length === 2) return `${first} & ${second}`;
  return `${first}, ${second} +${uids.length - 2}`;
}

const LIST_FIELDS = ['sideA', 'sideB', 'subjects', 'confirmed', 'paidBy'] as const;

/** True for a bet written before team bets (string sides, `subject`, no confirmed/paidBy). */
export function isOldFormat(raw: Record<string, unknown>): boolean {
  return LIST_FIELDS.some((f) => !Array.isArray(raw[f]));
}

/** A uid list from a new-shape list, an old single id, or nothing. */
function asList(v: unknown): Uid[] {
  if (Array.isArray(v)) return v as Uid[];
  return typeof v === 'string' ? [v] : [];
}

/**
 * Reads a bet doc in either shape as the new one, so bets written before Upgrade data never
 * crash a screen: string sides become one-item lists, `subject` becomes `subjects`, a missing
 * `confirmed` is everyone on a side once past proposed (else just the proposer), and a missing
 * `paidBy` is the winning side on a paid bet (else nobody). New-shape fields pass through.
 */
export function normalizeBet(raw: Record<string, unknown>): BetDoc {
  if (!isOldFormat(raw)) return raw as unknown as BetDoc;
  const { subject, ...rest } = raw;
  const sideA = asList(raw.sideA);
  const sideB = asList(raw.sideB);
  const status = raw.status as BetStatus;
  const winner = raw.winner as Side | null;
  const confirmed = Array.isArray(raw.confirmed)
    ? (raw.confirmed as Uid[])
    : status === 'proposed'
      ? asList(raw.createdBy)
      : [...sideA, ...sideB];
  const paidBy = Array.isArray(raw.paidBy)
    ? (raw.paidBy as Uid[])
    : status === 'paid' && winner
      ? winner === 'A'
        ? sideA
        : sideB
      : [];
  return {
    ...(rest as unknown as BetDoc),
    sideA,
    sideB,
    subjects: Array.isArray(raw.subjects) ? (raw.subjects as Uid[]) : asList(subject),
    confirmed,
    paidBy,
  };
}

export type UpgradeCheck = {
  membersDocExists: boolean;
  /** The keys in group/members.uids (empty if the doc is missing). */
  listed: Uid[];
  /** Users whose status is member. */
  memberUsers: Uid[];
  /** Every bet doc as stored. */
  bets: Array<Record<string, unknown>>;
};

/**
 * True while Upgrade data has work to do: group/members is missing or does not list exactly
 * the users with status member (say it was hand-deleted or emptied), or any bet is old-format.
 */
export function needsUpgrade(input: UpgradeCheck): boolean {
  if (!input.membersDocExists) return true;
  const listed = new Set(input.listed);
  const members = new Set(input.memberUsers);
  if (listed.size !== members.size || [...members].some((u) => !listed.has(u))) return true;
  return input.bets.some(isOldFormat);
}
