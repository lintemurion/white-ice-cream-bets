import { nextStatus } from './bet';
import type { Ballot, BetDoc, BetTally, JoinRequestDoc, JoinTally, Side, Uid } from './types';

/** Stands for "delete this field" in a Write; src/data/admin.ts maps it to deleteField(). */
export const DELETE = Symbol('delete');

/** One document write, with absolute field values (no increment()). */
export type Write = { op: 'set' | 'update' | 'delete'; path: string; data?: Record<string, unknown> };

export type RemovalInput = {
  uid: Uid;
  memberCount: number;
  /**
   * Every bet, already read through normalizeBet. `tally` for anonymous bets; `ballot` is the
   * removed member's own, if any.
   */
  bets: Array<{ id: string; bet: BetDoc; tally?: BetTally; ballot?: Ballot<Side> }>;
  /** Join requests. `ballot` is the removed member's own; `voted` is whether her voters doc exists. */
  joins: Array<{ applicant: Uid; req: JoinRequestDoc; tally: JoinTally; ballot?: Ballot<'yes' | 'no'>; voted: boolean }>;
};

/** Strict majority: `votes * 2 > count`. */
const wins = (votes: number, count: number) => votes * 2 > count;

function without<T>(map: Record<Uid, T>, uid: Uid): Record<Uid, T> {
  const { [uid]: _, ...rest } = map;
  return rest;
}

/** Collects writes, merging several updates to the same doc into one. */
class Plan {
  private writes = new Map<string, Write>();

  update(path: string, data: Record<string, unknown>) {
    const prev = this.writes.get(path);
    this.writes.set(path, { op: 'update', path, data: { ...prev?.data, ...data } });
  }

  delete(path: string) {
    this.writes.set(path, { op: 'delete', path });
  }

  list(): Write[] {
    return [...this.writes.values()];
  }
}

/**
 * The admin removes member `uid` (spec, "Admin page"). Pure: the caller reads everything
 * (the admin can read hidden tallies and ballots) and commits the result in one batch.
 *
 * 1. She becomes former; the member count drops by 1.
 * 2. Her votes on bets in voting go: her key leaves votesA/votesB, or for anonymous bets her
 *    ballot is deleted, her voters key removed, voterCount -1, and her choice taken off the tally.
 * 3. The same for open join requests (ballot, voters doc, voterCount, tally).
 * 4. Proposed bets: she leaves both sides, `confirmed`, and `subjects`; the status follows
 *    nextStatus (void if side A empties, active if everyone left is in). Active bets: she
 *    leaves her side, `confirmed`, and `subjects`; void if a side empties. Bets in voting,
 *    settled, or paid keep her on the sides as recorded.
 * 5. Her key leaves group/members (and anyone admitted in step 6 gains hers).
 * 6. Re-tally against the new count: open join requests oldest first (each admission raises
 *    the count used afterwards), then bets in voting.
 */
export function planRemoval(input: RemovalInput): Write[] {
  const { uid } = input;
  const plan = new Plan();
  let count = input.memberCount - 1;
  let lastAdmitted: Uid | null = null;

  plan.update(`users/${uid}`, { status: 'former' });
  plan.update('group/members', { [`uids.${uid}`]: DELETE });

  // Bets: her votes out, her pending bets void. Keep the post-removal counts for the re-tally.
  const voting: Array<{ id: string; forA: number; forB: number }> = [];
  for (const { id, bet, tally, ballot } of input.bets) {
    const path = `bets/${id}`;
    if (bet.status === 'proposed' || bet.status === 'active') {
      const lists = [bet.sideA, bet.sideB, bet.confirmed, bet.subjects];
      if (!lists.some((l) => l.includes(uid))) continue;
      const drop = (l: Uid[]) => l.filter((u) => u !== uid);
      const next = { sideA: drop(bet.sideA), sideB: drop(bet.sideB), confirmed: drop(bet.confirmed), subjects: drop(bet.subjects) };
      if (bet.status === 'proposed') {
        plan.update(path, { ...next, status: nextStatus(next) });
      } else {
        const emptied = next.sideA.length === 0 || next.sideB.length === 0;
        plan.update(path, emptied ? { ...next, status: 'void' } : next);
      }
      continue;
    }
    if (bet.status !== 'voting') continue;

    if (bet.voteStyle === 'open') {
      const votesA = without(bet.votesA, uid);
      const votesB = without(bet.votesB, uid);
      if (uid in bet.votesA || uid in bet.votesB) plan.update(path, { votesA, votesB });
      voting.push({ id, forA: Object.keys(votesA).length, forB: Object.keys(votesB).length });
    } else {
      const t = { A: tally?.A ?? 0, B: tally?.B ?? 0 };
      if (ballot) {
        t[ballot.choice] -= 1;
        plan.delete(`${path}/ballots/${uid}`);
        plan.update(`${path}/tally/counts`, { ...t });
      }
      if (uid in bet.voters) {
        plan.update(path, { voters: without(bet.voters, uid), voterCount: bet.voterCount - 1 });
      }
      voting.push({ id, forA: t.A, forB: t.B });
    }
  }

  // Open join requests: her vote out, then re-tally oldest first.
  const open = input.joins
    .filter((j) => j.req.status === 'open' && j.applicant !== uid)
    .sort((x, y) => x.req.createdAt.toMillis() - y.req.createdAt.toMillis() || x.applicant.localeCompare(y.applicant));
  for (const { applicant, req, tally, ballot, voted } of open) {
    const path = `joinRequests/${applicant}`;
    const t = { ...tally };
    if (ballot) {
      t[ballot.choice] -= 1;
      plan.delete(`${path}/ballots/${uid}`);
      plan.update(`${path}/tally/counts`, { ...t });
    }
    if (voted) {
      plan.delete(`${path}/voters/${uid}`);
      plan.update(path, { voterCount: req.voterCount - 1 });
    }

    // Same shape as a member's approve or reject batch.
    if (wins(t.yes, count)) {
      plan.update(path, { status: 'approved' });
      plan.update(`users/${applicant}`, { status: 'member' });
      plan.update('group/members', { [`uids.${applicant}`]: true });
      count += 1;
      lastAdmitted = applicant;
    } else if (wins(t.no, count)) {
      plan.update(path, { status: 'rejected' });
      plan.update(`users/${applicant}`, { status: 'rejected' });
    }
  }

  plan.update('group/main', lastAdmitted === null ? { memberCount: count } : { memberCount: count, lastAdmitted });

  // Bets in voting, against the count after any admissions.
  for (const { id, forA, forB } of voting) {
    if (wins(forA, count)) plan.update(`bets/${id}`, { status: 'settled', winner: 'A' });
    else if (wins(forB, count)) plan.update(`bets/${id}`, { status: 'settled', winner: 'B' });
  }

  return plan.list();
}
