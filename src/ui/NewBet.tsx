import { useState } from 'preact/hooks';
import type { NewBetInput } from '../data/bets';
import { MAX_PEOPLE } from '../model/bet';
import type { Uid, VoteStyle } from '../model/types';
import { errorMessage } from './errorMessage';
import { PeoplePicker } from './PeoplePicker';

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
  const others = props.members.filter((m) => m.uid !== props.me).map((m) => ({ uid: m.uid, name: m.displayName }));
  const myName = props.members.find((m) => m.uid === props.me)?.displayName ?? 'Me';
  const [description, setDescription] = useState('');
  const [subjects, setSubjects] = useState<Uid[]>([]);
  const [teammates, setTeammates] = useState<Uid[]>([]);
  const [opponents, setOpponents] = useState<Uid[]>([]);
  const [stakeMine, setStakeMine] = useState('');
  const [stakeTheirs, setStakeTheirs] = useState('');
  const [theirsEdited, setTheirsEdited] = useState(false);
  const [voteStyle, setVoteStyle] = useState<VoteStyle>('open');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = description.trim().length > 0 && stakeMine.trim().length > 0 && stakeTheirs.trim().length > 0;
  // Me plus everyone picked; nobody can be in two lists, so this counts distinct people.
  const full = 1 + subjects.length + teammates.length + opponents.length >= MAX_PEOPLE;
  /** Everyone picked in the other two lists, so no one lands in two. */
  const takenBesides = (mine: Uid[]) =>
    new Set([...subjects, ...teammates, ...opponents].filter((u) => !mine.includes(u)));
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
        teammates,
        opponents,
        subjects,
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
        <PeoplePicker
          label="About anyone?"
          hint="(optional)"
          options={others}
          selected={subjects}
          disabled={takenBesides(subjects)}
          full={full}
          onChange={setSubjects}
        />
        <PeoplePicker
          label="My side:"
          options={others}
          selected={teammates}
          disabled={takenBesides(teammates)}
          full={full}
          fixed={`${myName} (you)`}
          onChange={setTeammates}
        />
        <PeoplePicker
          label="Against:"
          hint="(leave empty for an open challenge)"
          options={others}
          selected={opponents}
          disabled={takenBesides(opponents)}
          full={full}
          onChange={setOpponents}
        />
        <label>
          If my side loses:
          <textarea rows={2} value={stakeMine} maxLength={STAKE_MAX} onInput={(e) => changeMine(val(e))} />
          <Counter value={stakeMine} max={STAKE_MAX} />
        </label>
        <label>
          If their side loses:
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
