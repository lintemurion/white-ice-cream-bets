export function LoadError() {
  return (
    <main class="screen">
      <h1 class="brand">WHITE ICE CREAM BETS</h1>
      <p class="error" role="alert">Couldn't load. Check your connection.</p>
      <button type="button" class="btn primary" onClick={() => location.reload()}>Try again</button>
    </main>
  );
}
