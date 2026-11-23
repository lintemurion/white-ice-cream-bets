import { useEffect, useState } from 'preact/hooks';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  type DocumentReference,
  type Query,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import type { BetDoc, BetTally, GroupDoc, JoinRequestDoc, JoinTally, Uid, UserDoc } from '../model/types';

export type WithId<T> = T & { id: string };

/** Live doc. undefined = loading (or disabled), null = does not exist. Errors resolve to null. */
function useDocData<T>(ref: () => DocumentReference | null, key: string): T | null | undefined {
  const [data, setData] = useState<T | null | undefined>(undefined);
  useEffect(() => {
    setData(undefined);
    const r = ref();
    if (!r) return;
    return onSnapshot(
      r,
      (snap) => setData(snap.exists() ? (snap.data() as T) : null),
      (err) => {
        console.error(`snapshot ${key}`, err);
        setData(null);
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return data;
}

/** Live query. undefined = loading (or disabled). Errors resolve to an empty list. */
function useQueryData<T>(q: () => Query | null, key: string): WithId<T>[] | undefined {
  const [data, setData] = useState<WithId<T>[] | undefined>(undefined);
  useEffect(() => {
    setData(undefined);
    const query_ = q();
    if (!query_) return;
    return onSnapshot(
      query_,
      (snap) => setData(snap.docs.map((d) => ({ ...(d.data() as T), id: d.id }))),
      (err) => {
        console.error(`snapshot ${key}`, err);
        setData([]);
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return data;
}

/** undefined = auth still resolving, null = signed out. */
export function useAuthUser(): User | null | undefined {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => onAuthStateChanged(auth, setUser), []);
  return user;
}

export function useMyUser(uid: Uid | null | undefined) {
  return useDocData<UserDoc>(() => (uid ? doc(db, `users/${uid}`) : null), `user:${uid ?? ''}`);
}

/** group/main: readable by pending users, members and the admin. */
export function useGroup(enabled = true) {
  return useDocData<GroupDoc>(() => (enabled ? doc(db, 'group/main') : null), `group:${enabled}`);
}

/** Members only. Pass enabled=false until the caller is a member. */
export function useMembers(enabled: boolean) {
  return useQueryData<UserDoc>(
    () => (enabled ? query(collection(db, 'users'), where('status', '==', 'member')) : null),
    `members:${enabled}`,
  );
}

export function useBets(enabled: boolean) {
  return useQueryData<BetDoc>(() => (enabled ? collection(db, 'bets') : null), `bets:${enabled}`);
}

export function useJoinRequests(enabled: boolean) {
  return useQueryData<JoinRequestDoc>(
    () => (enabled ? query(collection(db, 'joinRequests'), where('status', '==', 'open')) : null),
    `joins:${enabled}`,
  );
}

/** The applicant's own request (she may read it). */
export function useMyJoinRequest(uid: Uid | null | undefined) {
  return useDocData<JoinRequestDoc>(() => (uid ? doc(db, `joinRequests/${uid}`) : null), `myjoin:${uid ?? ''}`);
}

/** Subscribes only when `readable`; a hidden tally would be a permission error. */
export function useBetTally(betId: string, readable: boolean) {
  return useDocData<BetTally>(
    () => (readable ? doc(db, `bets/${betId}/tally/counts`) : null),
    `bettally:${betId}:${readable}`,
  );
}

export function useJoinTally(applicant: Uid, readable: boolean) {
  return useDocData<JoinTally>(
    () => (readable ? doc(db, `joinRequests/${applicant}/tally/counts`) : null),
    `jointally:${applicant}:${readable}`,
  );
}

/** My own ballot at `path` (e.g. `bets/{id}/ballots/{uid}`); null path = disabled. */
export function useMyBallot<C = string>(path: string | null) {
  return useDocData<{ choice: C }>(() => (path ? doc(db, path) : null), `ballot:${path ?? ''}`);
}
