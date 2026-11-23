import { useState } from 'preact/hooks';
import type { BetDoc, BetTally, Side, Uid } from '../model/types';
import { FORMER, needed, owesLine, voteProgress } from '../model/tally';
import { errorMessage } from './errorMessage';

export interface BetActions {
  accept(betId: string): Promise<void>;
  decline(betId: string): Promise<void>;
  cancel(betId: string): Promise<void>;
  callIt(betId: string): Promise<void>;
  castOpenVote(me: Uid, betId: string, side: Side | null): Promise<void>;
  castAnonVote(me: Uid, betId: string, side: Side): Promise<void>;
  trySettle(betId: string): Promise<unknown>;
  markPaid(betId: string): Promise<void>;
}

const DESC_CLAMP_CHARS = 140;
const DESC_CLAMP_LINES = 3;
const STAKE_CLAMP_CHARS = 90;
const STAKE_CLAMP_LINES = 2;

const isLong = (text: string, chars: number, lines: number) => text.length > chars || text.split('\n').length > lines;

function dots(count: number, total: number): string {
  return '●'.repeat(count) + '○'.repeat(Math.max(0, total - count));
}

export function BetCard(props: {
  id: string;
  bet: BetDoc;
  me: Uid;
  names: Record<Uid, string>;
  memberCount: number;
  tally?: BetTally | null;
  myVote?: Side | null;
  actions: BetActions;
}) {
  const { id, bet, me, names, memberCount, actions } = props;
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameOf = (u: Uid) => names[u] ?? FORMER;
  const nameA = nameOf(bet.sideA);
  const nameB = nameOf(bet.sideB);

  async function run(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  const vote = (fn: () => Promise<void>) =>
    run(async () => {
      await fn();
      await actions.trySettle(id);
    });

  const hasMore =
    isLong(bet.description, DESC_CLAMP_CHARS, DESC_CLAMP_LINES) ||
    isLong(bet.stakeA, STAKE_CLAMP_CHARS, STAKE_CLAMP_LINES) ||
    isLong(bet.stakeB, STAKE_CLAMP_CHARS, STAKE_CLAMP_LINES);
  const clamp = hasMore && !expanded;

  const myVote: Side | null =
    bet.voteStyle === 'open'
      ? bet.votesA[me] ? 'A' : bet.votesB[me] ? 'B' : null
      : (props.myVote ?? null);

  const settledLike = bet.status === 'settled' || bet.status === 'paid';
  const tag = `(${bet.voteStyle})`;

  function voteButton(side: Side) {
    const pressed = myVote === side;
    return (
      <button
        type="button"
        class={`btn${pressed ? ' primary' : ''}`}
        aria-pressed={pressed}
        disabled={busy}
        onClick={() =>
          vote(() =>
            bet.voteStyle === 'open'
              ? actions.castOpenVote(me, id, pressed ? null : side)
              : actions.castAnonVote(me, id, side),
          )
        }
      >
        {side === 'A' ? nameA : nameB} won
      </button>
    );
  }

  const stakes = (
    <p class={`stakes${clamp ? ' clamped' : ''}`}>
      {bet.stakeA} vs {bet.stakeB}
    </p>
  );

  let body;
  if (settledLike && bet.winner) {
    const [w, l] = bet.winner === 'A' ? [nameA, nameB] : [nameB, nameA];
    const winnerUid = bet.winner === 'A' ? bet.sideA : bet.sideB;
    body = (
      <>
        <p class="title">{w} beat {l}</p>
        <p class={`desc${clamp ? ' clamped' : ''}`}>{bet.description}</p>
        <p class={`stakes${clamp ? ' clamped' : ''}`}>{owesLine(bet, names)}</p>
        {bet.voteStyle === 'anonymous' && props.tally && (
          <p class="tally">Final count: {nameA} {props.tally.A}, {nameB} {props.tally.B}</p>
        )}
        {bet.status === 'paid' && <p class="paid-note">Paid</p>}
        {bet.status === 'settled' && winnerUid === me && (
          <div class="row">
            <button type="button" class="btn primary" disabled={busy} onClick={() => run(() => actions.markPaid(id))}>
              Mark paid
            </button>
          </div>
        )}
      </>
    );
  } else {
    body = (
      <>
        {bet.status === 'proposed' ? (
          <>
            <p class="title">{nameA} proposed:</p>
            <p class={`desc${clamp ? ' clamped' : ''}`}>"{bet.description}"</p>
            {stakes}
            <p class="tag">{tag}</p>
          </>
        ) : (
          <>
            <p class={`desc${clamp ? ' clamped' : ''}`}>{bet.description}</p>
            <p class="title">{nameA} vs {nameB} <span class="tag">{tag}</span></p>
            {stakes}
          </>
        )}
        {bet.status === 'proposed' && bet.sideB === me && (
          <div class="row">
            <button type="button" class="btn primary" disabled={busy} onClick={() => run(() => actions.accept(id))}>
              Accept
            </button>
            <button type="button" class="btn" disabled={busy} onClick={() => run(() => actions.decline(id))}>
              Decline
            </button>
          </div>
        )}
        {bet.status === 'proposed' && bet.sideA === me && (
          <>
            <p class="waiting">Waiting for {nameB} to accept</p>
            <div class="row">
              <button type="button" class="btn" disabled={busy} onClick={() => run(() => actions.cancel(id))}>
                Cancel
              </button>
            </div>
          </>
        )}
        {bet.status === 'active' && (
          <div class="row">
            <button type="button" class="btn primary" disabled={busy} onClick={() => run(() => actions.callIt(id))}>
              Call it
            </button>
          </div>
        )}
        {bet.status === 'voting' && (
          <>
            {bet.voteStyle === 'open' ? (
              <p class="dots">
                {nameA} won {dots(Object.keys(bet.votesA).length, needed(memberCount))}{' '}
                {nameB} won {dots(Object.keys(bet.votesB).length, needed(memberCount))}
              </p>
            ) : (
              <>
                <p class="voted">Voted: {Object.keys(bet.voters).map(nameOf).join(', ') || 'nobody yet'}</p>
                {props.tally && <p class="tally">Counts: {nameA} {props.tally.A}, {nameB} {props.tally.B}</p>}
              </>
            )}
            <p class="progress">
              {voteProgress({
                forA: Object.keys(bet.votesA).length,
                forB: Object.keys(bet.votesB).length,
                voterCount: bet.voteStyle === 'open' ? Object.keys(bet.votesA).length + Object.keys(bet.votesB).length : bet.voterCount,
                memberCount,
                nameA,
                nameB,
                style: bet.voteStyle,
              })}
            </p>
            <div class="row">
              {voteButton('A')}
              {voteButton('B')}
            </div>
          </>
        )}
      </>
    );
  }

  return (
    <section class={`card bet ${bet.status}`}>
      {settledLike && <span class="tag">{tag}</span>}
      {body}
      {hasMore && (
        <button type="button" class="btn link more" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'less' : 'more'}
        </button>
      )}
      {error && <p class="error" role="alert">{error}</p>}
    </section>
  );
}
