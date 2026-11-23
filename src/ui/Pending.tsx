export function Pending(props: {
  displayName: string;
  voterCount: number | undefined;
  memberCount: number | undefined;
  onSignOut: () => void;
}) {
  const known = props.voterCount !== undefined && props.memberCount !== undefined;
  return (
    <main class="screen">
      <h1 class="brand">WHITE ICE CREAM BETS</h1>
      <p>Thanks, {props.displayName}. The group is voting on your request.</p>
      {known && <p class="progress">{props.voterCount} of {props.memberCount} voted</p>}
      <button type="button" class="btn link" onClick={props.onSignOut}>Sign out</button>
    </main>
  );
}
