import { useState } from 'preact/hooks';
import { everyone, MAX_PEOPLE, sideLabel, sideOf, waitingOn } from '../model/bet';
import type { BetDoc, BetTally, Side, Uid } from '../model/types';
import { FORMER, needed, owesLine, voteProgress } from '../model/tally';
import { BET_CHANGED, errorMessage } from './errorMessage';

export interface BetActions {
  joinSide(me: Uid, betId: string, side: Side): Promise<void>;
  switchSide(me: Uid, betId: string): Promise<void>;
  leave(me: Uid, betId: string): Promise<void>;
  confirmIn(me: Uid, betId: string): Promise<void>;
  callIt(betId: string): Promise<void>;
  castOpenVote(me: Uid, betId: string, side: Side | null): Promise<void>;
  castAnonVote(me: Uid, betId: string, side: Side): Promise<void>;
  trySettle(betId: string): Promise<unknown>;
  markIGotPaid(me: Uid, betId: string): Promise<void>;
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
  const nameA = sideLabel(bet.sideA, names);
  const nameB = sideLabel(bet.sideB, names);

  async function run(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err, BET_CHANGED));
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

  function button(label: string, fn: () => Promise<unknown>, primary = false) {
    return (
      <button type="button" class={`btn${primary ? ' primary' : ''}`} disabled={busy} onClick={() => run(fn)}>
        {label}
      </button>
    );
  }

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

  /**
   * Moves on a proposed bet, from the sides only (createdBy never counts): someone on a side
   * can switch or leave, plus I'm in until she is in; someone not on it can join either side,
   * unless she's a subject or the bet already has MAX_PEOPLE people.
   */
  function moves() {
    const mine = sideOf(bet, me);
    if (mine) {
      return (
        <div class="row">
          {!bet.confirmed.includes(me) && button("I'm in", () => actions.confirmIn(me, id), true)}
          {button('Switch sides', () => actions.switchSide(me, id))}
          {button('Leave', () => actions.leave(me, id))}
        </div>
      );
    }
    if (bet.subjects.includes(me)) return null;
    if (everyone(bet).length + bet.subjects.length >= MAX_PEOPLE) return null;
    const join = (side: Side) => {
      const list = side === 'A' ? bet.sideA : bet.sideB;
      const label = list.length === 0 ? 'Join other side' : `Join ${nameOf(list[0])}'s side`;
      return button(label, () => actions.joinSide(me, id, side));
    };
    return (
      <div class="row">
        {join('A')}
        {join('B')}
      </div>
    );
  }

  const stakes = (
    <p class={`stakes${clamp ? ' clamped' : ''}`}>
      {bet.stakeA} vs {bet.stakeB}
    </p>
  );
  const about = bet.subjects.length > 0 && <p class="about">About: {bet.subjects.map(nameOf).join(', ')}</p>;

  let body;
  if (settledLike && bet.winner) {
    const [w, l] = bet.winner === 'A' ? [nameA, nameB] : [nameB, nameA];
    const winners = bet.winner === 'A' ? bet.sideA : bet.sideB;
    const paidCount = winners.filter((u) => bet.paidBy.includes(u)).length;
    body = (
      <>
        <p class="title">{w} beat {l}</p>
        <p class={`desc${clamp ? ' clamped' : ''}`}>{bet.description}</p>
        <p class={`stakes${clamp ? ' clamped' : ''}`}>{owesLine(bet, names)}</p>
        {bet.voteStyle === 'anonymous' && props.tally && (
          <p class="tally">Final count: {nameA} {props.tally.A}, {nameB} {props.tally.B}</p>
        )}
        {bet.status === 'paid' && <p class="paid-note">Paid</p>}
        {bet.status === 'settled' && winners.length >= 2 && (
          <p class="waiting">Paid: {paidCount} of {winners.length}</p>
        )}
        {bet.status === 'settled' && winners.includes(me) && !bet.paidBy.includes(me) && (
          <div class="row">{button('I got paid', () => actions.markIGotPaid(me, id), true)}</div>
        )}
      </>
    );
  } else if (bet.status === 'proposed') {
    const waiting = waitingOn(bet);
    body = (
      <>
        <p class={`desc${clamp ? ' clamped' : ''}`}>{bet.description}</p>
        {about}
        <p class="title">{nameA} vs {nameB}</p>
        {stakes}
        <p class="tag">{tag}</p>
        {waiting.length > 0 && <p class="waiting">Waiting on: {waiting.map(nameOf).join(', ')}</p>}
        {moves()}
      </>
    );
  } else {
    body = (
      <>
        <p class={`desc${clamp ? ' clamped' : ''}`}>{bet.description}</p>
        {about}
        <p class="title">{nameA} vs {nameB} <span class="tag">{tag}</span></p>
        {stakes}
        {bet.status === 'active' && (
          <div class="row">{button('Call it', () => actions.callIt(id), true)}</div>
        )}
        {bet.status === 'voting' && (
          <>
            {bet.voteStyle === 'open' ? (
              <>
                <p class="dots">
                  {nameA} won {dots(Object.keys(bet.votesA).length, needed(memberCount))}{' '}
                  {nameB} won {dots(Object.keys(bet.votesB).length, needed(memberCount))}
                </p>
                {([[nameA, bet.votesA], [nameB, bet.votesB]] as const).map(
                  ([name, votes]) =>
                    Object.keys(votes).length > 0 && (
                      <p class="voted">{name} won: {Object.keys(votes).map(nameOf).join(', ')}</p>
                    ),
                )}
              </>
            ) : (
              <>
                <p class="voted">Voted: {Object.keys(bet.voters).map(nameOf).join(', ') || 'nobody yet'}</p>
                {props.tally && <p class="tally">Counts: {nameA} {props.tally.A}, {nameB} {props.tally.B}</p>}
              </>
            )}
            <p class="progress">
              {voteProgress({
                forA: bet.voteStyle === 'open' ? Object.keys(bet.votesA).length : (props.tally?.A ?? 0),
                forB: bet.voteStyle === 'open' ? Object.keys(bet.votesB).length : (props.tally?.B ?? 0),
                voterCount: bet.voteStyle === 'open' ? Object.keys(bet.votesA).length + Object.keys(bet.votesB).length : bet.voterCount,
                memberCount,
                nameA,
                nameB,
                style: bet.voteStyle,
                revealed: bet.voteStyle === 'anonymous' && !!props.tally,
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
