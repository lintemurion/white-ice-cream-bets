import { useState } from 'preact/hooks';
import { db } from '../firebase';
import {
  acceptBet, callIt, cancelBet, castAnonVote, castOpenVote, declineBet, markPaid, proposeBet, trySettle,
} from '../data/bets';
import { castJoinVote, tryDecideJoin } from '../data/joins';
import {
  useBetNames, useBetTally, useBets, useGroup, useJoinRequests, useMembers, useMyBallot, type WithId,
} from '../data/subscriptions';
import type { BetDoc, JoinRequestDoc, Side, Uid } from '../model/types';
import { BetCard, type BetActions } from './BetCard';
import { Home } from './Home';
import { JoinRequestCard, type JoinChoice } from './JoinRequestCard';
import { LoadError } from './LoadError';
import { NewBet } from './NewBet';
import { sections, tallyReadable } from './sections';

const actions: BetActions = {
  accept: (id) => acceptBet(db, id),
  decline: (id) => declineBet(db, id),
  cancel: (id) => cancelBet(db, id),
  callIt: (id) => callIt(db, id),
  castOpenVote: (me, id, side) => castOpenVote(db, me, id, side),
  castAnonVote: (me, id, side) => castAnonVote(db, me, id, side),
  trySettle: (id) => trySettle(db, id),
  markPaid: (id) => markPaid(db, id),
};

function BetRow(props: { id: string; bet: BetDoc; me: Uid; names: Record<Uid, string>; memberCount: number }) {
  const { id, bet, me } = props;
  const readable = tallyReadable(bet, props.memberCount);
  const tally = useBetTally(id, readable).data;
  const anonVoting = bet.voteStyle === 'anonymous' && bet.status === 'voting';
  const ballot = useMyBallot<Side>(anonVoting ? `bets/${id}/ballots/${me}` : null).data;
  return (
    <BetCard
      id={id}
      bet={bet}
      me={me}
      names={props.names}
      memberCount={props.memberCount}
      tally={tally}
      myVote={ballot?.choice ?? null}
      actions={actions}
    />
  );
}

function JoinRow(props: { id: string; req: JoinRequestDoc; me: Uid; memberCount: number }) {
  const ballot = useMyBallot<JoinChoice>(`joinRequests/${props.id}/ballots/${props.me}`).data;
  return (
    <JoinRequestCard
      applicant={props.id}
      req={props.req}
      myVote={ballot?.choice ?? null}
      memberCount={props.memberCount}
      onVote={(choice) => castJoinVote(db, props.me, props.id, choice)}
      tryDecide={() => tryDecideJoin(db, props.id)}
    />
  );
}

export function HomeContainer(props: { me: Uid; onProfile: () => void; onSignOut: () => void }) {
  const [creating, setCreating] = useState(false);
  const bets = useBets(true);
  const members = useMembers(true);
  const allNames = useBetNames(true);
  const joins = useJoinRequests(true);
  const group = useGroup(true);

  if (bets.error || members.error || allNames.error || joins.error || group.error) return <LoadError />;
  if (!bets.data || !members.data || !allNames.data || !joins.data || !group.data) {
    return <main class="screen"><p>Loading...</p></main>;
  }

  const memberCount = group.data.memberCount;
  const names: Record<Uid, string> = {};
  for (const m of allNames.data) names[m.id] = m.displayName;
  const byId = new Map<string, WithId<BetDoc>>(bets.data.map((b) => [b.id, b]));
  const joinById = new Map(joins.data.map((j) => [j.id, j]));

  if (creating) {
    return (
      <NewBet
        me={props.me}
        members={members.data.map((m) => ({ uid: m.id, displayName: m.displayName }))}
        onSubmit={async (input) => {
          await proposeBet(db, props.me, input);
          setCreating(false);
        }}
        onCancel={() => setCreating(false)}
      />
    );
  }

  return (
    <Home
      joinIds={joins.data.map((j) => j.id)}
      sections={sections(props.me, bets.data.map((b) => ({ id: b.id, bet: b })))}
      renderJoin={(id) => (
        <JoinRow key={id} id={id} req={joinById.get(id)!} me={props.me} memberCount={memberCount} />
      )}
      renderBet={(id) => (
        <BetRow key={id} id={id} bet={byId.get(id)!} me={props.me} names={names} memberCount={memberCount} />
      )}
      onNewBet={() => setCreating(true)}
      onProfile={props.onProfile}
      onSignOut={props.onSignOut}
    />
  );
}
