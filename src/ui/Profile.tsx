import { useState } from 'preact/hooks';
import { NAME_MAX } from './ChooseName';

export function Profile(props: {
  displayName: string;
  onSave: (name: string) => Promise<void>;
  onBack: () => void;
  onSignOut: () => void;
}) {
  const [name, setName] = useState(props.displayName);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const trimmed = name.trim();
  const valid = trimmed.length >= 1 && trimmed.length <= NAME_MAX;

  async function submit(e: Event) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      await props.onSave(trimmed);
      setMsg({ text: 'Saved.', error: false });
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : 'Could not save. Try again.', error: true });
    }
    setBusy(false);
  }

  return (
    <main class="screen">
      <h1 class="brand">WHITE ICE CREAM BETS</h1>
      <form onSubmit={submit}>
        <label>
          Your name
          <input
            type="text"
            value={name}
            maxLength={NAME_MAX}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
          />
        </label>
        <button type="submit" class="btn primary" disabled={!valid || busy || trimmed === props.displayName}>
          Save
        </button>
        {msg && <p class={msg.error ? 'error' : 'ok'} role="alert">{msg.text}</p>}
      </form>
      <button type="button" class="btn link" onClick={props.onBack}>Back</button>
      <button type="button" class="btn link" onClick={props.onSignOut}>Sign out</button>
    </main>
  );
}
