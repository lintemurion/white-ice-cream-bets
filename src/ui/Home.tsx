import type { ComponentChildren } from 'preact';
import type { Sections } from './sections';

function Section(props: { title: string; count: number; children: ComponentChildren }) {
  if (props.count === 0) return null;
  return (
    <section class="home-section">
      <h2>{props.title}</h2>
      {props.children}
    </section>
  );
}

/** Home layout. Rendering of each card is injected so this stays free of Firebase. */
export function Home(props: {
  joinIds: string[];
  sections: Sections;
  renderJoin: (id: string) => ComponentChildren;
  renderBet: (id: string) => ComponentChildren;
  onNewBet: () => void;
  onProfile: () => void;
  onSignOut: () => void;
}) {
  const s = props.sections;
  const group = (items: { id: string }[]) => items.map((i) => props.renderBet(i.id));
  const empty =
    props.joinIds.length === 0 &&
    [s.needsYou, s.voting, s.active, s.waiting, s.openToJoin, s.settled].every((list) => list.length === 0);
  return (
    <main class="screen">
      <header class="home-header">
        <h1 class="brand">WHITE ICE CREAM BETS</h1>
        <button type="button" class="btn primary" onClick={props.onNewBet}>+ New Bet</button>
      </header>
      {empty && <p class="empty">No bets yet. Tap + New Bet to start one.</p>}
      <Section title="JOIN REQUESTS" count={props.joinIds.length}>{props.joinIds.map(props.renderJoin)}</Section>
      <Section title="NEEDS YOU" count={s.needsYou.length}>{group(s.needsYou)}</Section>
      <Section title="VOTING" count={s.voting.length}>{group(s.voting)}</Section>
      <Section title="ACTIVE" count={s.active.length}>{group(s.active)}</Section>
      <Section title="WAITING" count={s.waiting.length}>{group(s.waiting)}</Section>
      <Section title="OPEN TO JOIN" count={s.openToJoin.length}>{group(s.openToJoin)}</Section>
      <Section title="SETTLED" count={s.settled.length}>{group(s.settled)}</Section>
      <footer class="row">
        <button type="button" class="btn link" onClick={props.onProfile}>Profile</button>
        <button type="button" class="btn link" onClick={props.onSignOut}>Sign out</button>
      </footer>
    </main>
  );
}
