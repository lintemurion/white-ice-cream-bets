import { useState } from 'preact/hooks';
import type { NewBetInput } from '../data/bets';
import type { Uid, VoteStyle } from '../model/types';
import { errorMessage } from './errorMessage';

export const DESCRIPTION_MAX = 2000;
export const STAKE_MAX = 500;
const COUNTER_WITHIN = 100;

function Counter(props: { value: string; max: number }) {
  if (props.value.length < props.max - COUNTER_WITHIN) return null;
  return <span class="counter">{props.value.length} / {props.max}</span>;
}

export function NewBet(props: {
  me: Uid;
  members: Array<{ uid: Uid; displayName: string }>;
  onSubmit: (input: NewBetInput) => Promise<void>;
  onCancel?: () => void;
}) {
  const others = props.members.filter((m) => m.uid !== props.me);
  const [description, setDescription] = useState('');
  const [subject, setSubject] = useState<Uid>('');
  const [opponent, setOpponent] = useState<Uid>('');
  const [stakeMine, setStakeMine] = useState('');
  const [stakeTheirs, setStakeTheirs] = useState('');
  const [theirsEdited, setTheirsEdited] = useState(false);
  const [voteStyle, setVoteStyle] = useState<VoteStyle>('open');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const opponentName = others.find((m) => m.uid === opponent)?.displayName ?? 'they';
  const valid =
    description.trim().length > 0 && opponent !== '' && stakeMine.trim().length > 0 && stakeTheirs.trim().length > 0;

  function changeSubject(uid: Uid) {
    setSubject(uid);
    if (uid !== '' && uid === opponent) setOpponent('');
  }
  function changeMine(v: string) {
    const next = v.slice(0, STAKE_MAX);
    setStakeMine(next);
    if (!theirsEdited) setStakeTheirs(next);
  }

  async function submit(e: Event) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await props.onSubmit({
        description: description.trim(),
        opponent,
        subject: subject === '' ? null : subject,
        stakeMine: stakeMine.trim(),
        stakeTheirs: stakeTheirs.trim(),
        voteStyle,
      });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  const val = (e: Event) => (e.target as HTMLInputElement).value;

  return (
    <main class="screen">
      <h1 class="brand">New Bet</h1>
      <form onSubmit={submit}>
        <label>
          What's the bet?
          <textarea
            rows={3}
            value={description}
            maxLength={DESCRIPTION_MAX}
            onInput={(e) => setDescription(val(e).slice(0, DESCRIPTION_MAX))}
          />
          <Counter value={description} max={DESCRIPTION_MAX} />
        </label>
        <label>
          About someone?
          <select value={subject} onChange={(e) => changeSubject(val(e))}>
            <option value="">(none)</option>
            {others.map((m) => (
              <option value={m.uid}>{m.displayName}</option>
            ))}
          </select>
        </label>
        <label>
          Me vs:
          <select value={opponent} onChange={(e) => setOpponent(val(e))}>
            <option value="">Choose...</option>
            {others.map((m) => (
              <option value={m.uid} disabled={m.uid === subject}>{m.displayName}</option>
            ))}
          </select>
        </label>
        <label>
          If I lose:
          <textarea rows={2} value={stakeMine} maxLength={STAKE_MAX} onInput={(e) => changeMine(val(e))} />
          <Counter value={stakeMine} max={STAKE_MAX} />
        </label>
        <label>
          {`If ${opponentName} loses:`}
          <textarea
            rows={2}
            value={stakeTheirs}
            maxLength={STAKE_MAX}
            onInput={(e) => {
              setTheirsEdited(true);
              setStakeTheirs(val(e).slice(0, STAKE_MAX));
            }}
          />
          <Counter value={stakeTheirs} max={STAKE_MAX} />
        </label>
        <fieldset>
          <legend>Votes:</legend>
          <label class="inline">
            <input type="radio" name="voteStyle" checked={voteStyle === 'open'} onChange={() => setVoteStyle('open')} />
            Open
          </label>
          <label class="inline">
            <input
              type="radio"
              name="voteStyle"
              checked={voteStyle === 'anonymous'}
              onChange={() => setVoteStyle('anonymous')}
            />
            Anonymous
          </label>
        </fieldset>
        <button type="submit" class="btn primary" disabled={!valid || busy}>Propose bet</button>
        {error && <p class="error" role="alert">{error}</p>}
      </form>
      {props.onCancel && <button type="button" class="btn link" onClick={props.onCancel}>Back</button>}
    </main>
  );
}
