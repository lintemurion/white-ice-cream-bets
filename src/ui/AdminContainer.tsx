import { db } from '../firebase';
import {
  adminApprove, adminClearVote, adminDeleteBet, adminEditBet, adminReject, adminReopenVote,
  clearRejection, initGroup, removeMember, renameUser,
} from '../data/admin';
import { markPaid } from '../data/bets';
import { useAllUsers, useBets, useGroup, useJoinRequests } from '../data/subscriptions';
import { Admin, type AdminActions } from './Admin';
import { LoadError } from './LoadError';

export function AdminContainer(props: { onSignOut: () => void }) {
  const users = useAllUsers(true);
  const bets = useBets(true);
  const joins = useJoinRequests(true);
  const group = useGroup(true);

  if (users.error || bets.error || joins.error || group.error) return <LoadError />;
  if (!users.data || !bets.data || !joins.data || group.data === undefined) {
    return <main class="screen"><p>Loading...</p></main>;
  }

  const actions: AdminActions = {
    initGroup: () => initGroup(db),
    approve: (uid) => adminApprove(db, uid),
    reject: (uid) => adminReject(db, uid),
    clearRejection: (uid) => clearRejection(db, uid),
    removeMember: (uid) => removeMember(db, uid),
    renameUser: (uid, name) => renameUser(db, uid, name),
    editBet: (id, patch) => adminEditBet(db, id, patch),
    deleteBet: (id) => adminDeleteBet(db, id),
    reopenVote: (id) => adminReopenVote(db, id),
    clearVote: (id, voter) => adminClearVote(db, id, voter),
    markPaid: (id) => markPaid(db, id),
    signOut: props.onSignOut,
  };

  return (
    <Admin
      users={users.data.map(({ id, ...doc }) => ({ uid: id, doc }))}
      bets={bets.data.map(({ id, ...bet }) => ({ id, bet }))}
      joinRequests={joins.data.map(({ id, ...req }) => ({ id, req }))}
      memberCount={group.data?.memberCount ?? 0}
      groupMissing={group.data === null}
      actions={actions}
    />
  );
}
