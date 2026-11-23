export function Blocked(props: { onSignOut: () => void }) {
  return (
    <main class="screen">
      <h1 class="brand">WHITE ICE CREAM BETS</h1>
      <p>You're not in the group right now. Ask Kyle if you think this is a mistake.</p>
      <button type="button" class="btn link" onClick={props.onSignOut}>Sign out</button>
    </main>
  );
}
