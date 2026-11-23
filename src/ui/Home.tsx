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
  return (
    <main class="screen">
      <header class="home-header">
        <h1 class="brand">WHITE ICE CREAM BETS</h1>
        <button type="button" class="btn primary" onClick={props.onNewBet}>+ New Bet</button>
      </header>
      <Section title="JOIN REQUESTS" count={props.joinIds.length}>{props.joinIds.map(props.renderJoin)}</Section>
      <Section title="NEEDS YOU" count={s.needsYou.length}>{group(s.needsYou)}</Section>
      <Section title="VOTING" count={s.voting.length}>{group(s.voting)}</Section>
      <Section title="ACTIVE" count={s.active.length}>{group(s.active)}</Section>
      <Section title="WAITING" count={s.proposedByMe.length}>{group(s.proposedByMe)}</Section>
      <Section title="SETTLED" count={s.settled.length}>{group(s.settled)}</Section>
      <footer class="row">
        <button type="button" class="btn link" onClick={props.onProfile}>Profile</button>
        <button type="button" class="btn link" onClick={props.onSignOut}>Sign out</button>
      </footer>
    </main>
  );
}
