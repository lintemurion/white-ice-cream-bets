export function SignIn(props: { onSignIn: () => void; error?: string | null }) {
  return (
    <main class="screen">
      <h1 class="brand">WHITE ICE CREAM BETS</h1>
      <button type="button" class="btn primary" onClick={props.onSignIn}>
        Sign in with Google
      </button>
      {props.error && <p class="error" role="alert">{props.error}</p>}
    </main>
  );
}
