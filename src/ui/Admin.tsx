import { useState } from 'preact/hooks';
import { everyone, MAX_PEOPLE, sideLabel } from '../model/bet';
import type { BetDoc, JoinRequestDoc, Uid, UserDoc } from '../model/types';
import { FORMER } from '../model/tally';
import type { BetPatch } from '../data/admin';
import { errorMessage } from './errorMessage';
import { PeoplePicker } from './PeoplePicker';

export interface AdminActions {
  initGroup(): Promise<void>;
  approve(uid: Uid): Promise<void>;
  reject(uid: Uid): Promise<void>;
  clearRejection(uid: Uid): Promise<void>;
  removeMember(uid: Uid): Promise<void>;
  renameUser(uid: Uid, name: string): Promise<void>;
  editBet(betId: string, patch: BetPatch): Promise<void>;
  deleteBet(betId: string): Promise<void>;
  reopenVote(betId: string): Promise<void>;
  clearVote(betId: string, voter: Uid): Promise<void>;
  /** Marks one winner paid for her (say she was removed before she could). */
  markPaidFor(betId: string, winner: Uid): Promise<void>;
  /** Builds group/members and converts old-format bets; resolves to what it wrote. */
  upgradeData(): Promise<{ members: number; bets: number }>;
  signOut(): void;
}

export interface AdminProps {
  users: Array<{ uid: Uid; doc: UserDoc }>;
  bets: Array<{ id: string; bet: BetDoc }>;
  joinRequests: Array<{ id: string; req: JoinRequestDoc }>;
  memberCount: number;
  /** True when group/main does not exist yet. */
  groupMissing: boolean;
  /** True while Upgrade data has work to do. */
  needsUpgrade: boolean;
  actions: AdminActions;
}

const sameSet = (a: Uid[], b: Uid[]) => a.length === b.length && a.every((u) => b.includes(u));

/** Busy flag and inline error shared by a row's actions. */
function useRun() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<unknown>): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

const Err = (props: { error: string | null }) =>
  props.error ? <p class="error" role="alert">{props.error}</p> : null;

/** A Remove/Delete style button that asks for a typed phrase before the real action. */
function TypedConfirm(props: {
  label: string;
  phrase: string;
  busy: boolean;
  onConfirm: () => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  if (!open) {
    return <button type="button" class="btn" onClick={() => setOpen(true)}>{props.label}</button>;
  }
  return (
    <div class="confirm">
      <label>
        Type {props.phrase} to confirm
        <input type="text" value={typed} onInput={(e) => setTyped((e.target as HTMLInputElement).value)} />
      </label>
      <button
        type="button"
        class="btn primary"
        disabled={props.busy || typed !== props.phrase}
        onClick={async () => {
          if (await props.onConfirm()) {
            setOpen(false);
            setTyped('');
          }
        }}
      >
        Confirm {props.label.toLowerCase()}
      </button>
      <button type="button" class="btn link" onClick={() => { setOpen(false); setTyped(''); }}>Cancel</button>
    </div>
  );
}

function MemberRow(props: { uid: Uid; doc: UserDoc; actions: AdminActions }) {
  const { uid, actions } = props;
  const [name, setName] = useState(props.doc.displayName);
  const { busy, error, run } = useRun();
  return (
    <li class="card" data-testid={`member-${uid}`}>
      <label>
        Name
        <input type="text" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
      </label>
      <div class="row">
        <button
          type="button"
          class="btn"
          disabled={busy || name.trim() === props.doc.displayName}
          onClick={() => run(() => actions.renameUser(uid, name))}
        >
          Rename
        </button>
        <TypedConfirm
          label="Remove"
          phrase={props.doc.displayName}
          busy={busy}
          onConfirm={() => run(() => actions.removeMember(uid))}
        />
      </div>
      <Err error={error} />
    </li>
  );
}

function PendingRow(props: { uid: Uid; doc: UserDoc; req?: JoinRequestDoc; memberCount: number; actions: AdminActions }) {
  const { uid, actions } = props;
  const { busy, error, run } = useRun();
  return (
    <li class="card" data-testid={`pending-${uid}`}>
      <p class="title">{props.doc.displayName} wants to join</p>
      <p>{props.req?.voterCount ?? 0} of {props.memberCount} voted</p>
      <div class="row">
        <button type="button" class="btn primary" disabled={busy} onClick={() => run(() => actions.approve(uid))}>Approve</button>
        <button type="button" class="btn" disabled={busy} onClick={() => run(() => actions.reject(uid))}>Reject</button>
      </div>
      <Err error={error} />
    </li>
  );
}

function RejectedRow(props: { uid: Uid; doc: UserDoc; actions: AdminActions }) {
  const { busy, error, run } = useRun();
  return (
    <li class="card" data-testid={`rejected-${props.uid}`}>
      <p class="title">{props.doc.displayName}</p>
      <div class="row">
        <button type="button" class="btn" disabled={busy} onClick={() => run(() => props.actions.clearRejection(props.uid))}>
          Clear
        </button>
      </div>
      <Err error={error} />
    </li>
  );
}

function BetRow(props: { id: string; bet: BetDoc; names: Record<Uid, string>; members: Record<Uid, string>; actions: AdminActions }) {
  const { id, bet, names, members, actions } = props;
  const [description, setDescription] = useState(bet.description);
  const [stakeA, setStakeA] = useState(bet.stakeA);
  const [stakeB, setStakeB] = useState(bet.stakeB);
  const [subjects, setSubjects] = useState<Uid[]>(bet.subjects);
  const { busy, error, run } = useRun();
  const nameOf = (u: Uid) => names[u] ?? FORMER;

  const voters: Uid[] =
    bet.status !== 'voting'
      ? []
      : bet.voteStyle === 'open'
        ? [...Object.keys(bet.votesA), ...Object.keys(bet.votesB)]
        : Object.keys(bet.voters);
  // Current members, plus any subject who has since left so her chip still has a name.
  const subjectOptions = [
    ...Object.entries(members).map(([uid, name]) => ({ uid, name })),
    ...bet.subjects
      .filter((u) => !(u in members))
      .map((uid) => ({ uid, name: names[uid] ? `${names[uid]} (former)` : FORMER })),
  ];
  const sides = everyone(bet);
  const winners = bet.winner === 'A' ? bet.sideA : bet.winner === 'B' ? bet.sideB : [];
  const unpaid = bet.status === 'settled' ? winners.filter((u) => !bet.paidBy.includes(u)) : [];
  const settledLike = bet.status === 'settled' || bet.status === 'paid';

  return (
    <li class="card" data-testid={`bet-${id}`}>
      <p class="title">{sideLabel(bet.sideA, names)} vs {sideLabel(bet.sideB, names)} ({bet.status}, {bet.voteStyle})</p>
      <label>
        Description
        <textarea value={description} onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)} />
      </label>
      <label>
        Stake A
        <input type="text" value={stakeA} onInput={(e) => setStakeA((e.target as HTMLInputElement).value)} />
      </label>
      <label>
        Stake B
        <input type="text" value={stakeB} onInput={(e) => setStakeB((e.target as HTMLInputElement).value)} />
      </label>
      <PeoplePicker
        label="Subjects"
        options={subjectOptions}
        selected={subjects}
        disabled={new Set(sides)}
        full={sides.length + subjects.length >= MAX_PEOPLE}
        onChange={setSubjects}
      />
      <div class="row">
        <button
          type="button"
          class="btn"
          disabled={busy}
          onClick={() => {
            const patch: BetPatch = { description, stakeA, stakeB };
            if (!sameSet(subjects, bet.subjects)) patch.subjects = subjects;
            return run(() => actions.editBet(id, patch));
          }}
        >
          Save
        </button>
        {unpaid.map((u) => (
          <button key={u} type="button" class="btn primary" disabled={busy} onClick={() => run(() => actions.markPaidFor(id, u))}>
            Mark {nameOf(u)} paid
          </button>
        ))}
        {settledLike && (
          <button type="button" class="btn" disabled={busy} onClick={() => run(() => actions.reopenVote(id))}>
            Reopen vote
          </button>
        )}
        <TypedConfirm label="Delete" phrase="delete" busy={busy} onConfirm={() => run(() => actions.deleteBet(id))} />
      </div>
      {voters.length > 0 && (
        <div class="row">
          {voters.map((v) => (
            <button key={v} type="button" class="btn link" disabled={busy} onClick={() => run(() => actions.clearVote(id, v))}>
              Clear vote: {nameOf(v)}
            </button>
          ))}
        </div>
      )}
      <Err error={error} />
    </li>
  );
}

export function Admin(props: AdminProps) {
  const { users, actions } = props;
  const setup = useRun();
  const upgrade = useRun();
  const [upgraded, setUpgraded] = useState<{ members: number; bets: number } | null>(null);
  const runUpgrade = () =>
    upgrade.run(async () => {
      setUpgraded(await actions.upgradeData());
    });
  const names: Record<Uid, string> = {};
  const members: Record<Uid, string> = {};
  for (const u of users) if (u.doc.status === 'member' || u.doc.status === 'former') names[u.uid] = u.doc.displayName;
  for (const u of users) if (u.doc.status === 'member') members[u.uid] = u.doc.displayName;
  const reqById = new Map(props.joinRequests.map((j) => [j.id, j.req]));
  const by = (status: UserDoc['status']) => users.filter((u) => u.doc.status === status);

  return (
    <main class="screen admin">
      <header class="row">
        <h1 class="brand">WHITE ICE CREAM BETS</h1>
        <button type="button" class="btn link" onClick={actions.signOut}>Sign out</button>
      </header>
      <h2>Admin</h2>

      {props.groupMissing && (
        <section>
          <button type="button" class="btn primary" disabled={setup.busy} onClick={() => setup.run(actions.initGroup)}>
            Set up group
          </button>
          <Err error={setup.error} />
        </section>
      )}

      {(props.needsUpgrade || upgraded) && (
        <section>
          {props.needsUpgrade && (
            <button type="button" class="btn primary" disabled={upgrade.busy} onClick={runUpgrade}>
              Upgrade data
            </button>
          )}
          {upgraded && (
            <p class="ok">Upgraded: {upgraded.members} members listed, {upgraded.bets} bets converted.</p>
          )}
          <Err error={upgrade.error} />
        </section>
      )}

      <section>
        <h2>Members</h2>
        <ul>{by('member').map((u) => <MemberRow key={u.uid} uid={u.uid} doc={u.doc} actions={actions} />)}</ul>
      </section>

      <section>
        <h2>Pending requests</h2>
        <ul>
          {by('pending').map((u) => (
            <PendingRow key={u.uid} uid={u.uid} doc={u.doc} req={reqById.get(u.uid)} memberCount={props.memberCount} actions={actions} />
          ))}
        </ul>
      </section>

      <section>
        <h2>Rejected</h2>
        <ul>{by('rejected').map((u) => <RejectedRow key={u.uid} uid={u.uid} doc={u.doc} actions={actions} />)}</ul>
      </section>

      <section>
        <h2>Former members</h2>
        <ul>
          {by('former').map((u) => <li key={u.uid} data-testid={`former-${u.uid}`}>{u.doc.displayName}</li>)}
        </ul>
      </section>

      <section>
        <h2>Bets</h2>
        <ul>{props.bets.map((b) => <BetRow key={b.id} id={b.id} bet={b.bet} names={names} members={members} actions={actions} />)}</ul>
      </section>
    </main>
  );
}
