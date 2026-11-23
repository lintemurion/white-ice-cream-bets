import { useState } from 'preact/hooks';

export const NAME_MAX = 30;

/** Google first name, trimmed and cut to the name limit. */
export function defaultName(googleName: string | null | undefined): string {
  return (googleName ?? '').trim().split(/\s+/)[0].slice(0, NAME_MAX);
}

export function ChooseName(props: {
  initialName: string;
  onSubmit: (name: string) => Promise<void>;
  onSignOut: () => void;
}) {
  const [name, setName] = useState(props.initialName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = name.trim();
  const valid = trimmed.length >= 1 && trimmed.length <= NAME_MAX;

  async function submit(e: Event) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await props.onSubmit(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
      setBusy(false);
    }
  }

  return (
    <main class="screen">
      <h1 class="brand">WHITE ICE CREAM BETS</h1>
      <form onSubmit={submit}>
        <label>
          What should the group call you?
          <input
            type="text"
            value={name}
            maxLength={NAME_MAX}
            autoComplete="given-name"
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
          />
        </label>
        <button type="submit" class="btn primary" disabled={!valid || busy}>
          Ask to join
        </button>
        {error && <p class="error" role="alert">{error}</p>}
      </form>
      <button type="button" class="btn link" onClick={props.onSignOut}>Sign out</button>
    </main>
  );
}
