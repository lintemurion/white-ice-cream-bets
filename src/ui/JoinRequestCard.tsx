import { useState } from 'preact/hooks';
import type { JoinRequestDoc, Uid } from '../model/types';
import { errorMessage } from './errorMessage';

export type JoinChoice = 'yes' | 'no';

export function JoinRequestCard(props: {
  applicant: Uid;
  req: JoinRequestDoc;
  myVote?: JoinChoice | null;
  memberCount: number;
  voterNames?: string[];
  onVote: (choice: JoinChoice) => Promise<void>;
  /** Called after each vote; the app wires this to tryDecideJoin. */
  tryDecide: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function vote(choice: JoinChoice) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await props.onVote(choice);
      await props.tryDecide();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section class="card join">
      <p class="title">{props.req.displayName} wants to join</p>
      <p class="progress">{props.req.voterCount} of {props.memberCount} voted</p>
      {props.voterNames && props.voterNames.length > 0 && <p class="voted">Voted: {props.voterNames.join(', ')}</p>}
      <div class="row">
        {(['yes', 'no'] as const).map((c) => (
          <button
            type="button"
            class={`btn${props.myVote === c ? ' primary' : ''}`}
            aria-pressed={props.myVote === c}
            disabled={busy}
            onClick={() => vote(c)}
          >
            {c === 'yes' ? 'Yes' : 'No'}
          </button>
        ))}
      </div>
      {error && <p class="error" role="alert">{error}</p>}
    </section>
  );
}
