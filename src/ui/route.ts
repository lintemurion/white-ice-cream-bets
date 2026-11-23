import type { UserDoc } from '../model/types';

export type Screen = 'loading' | 'signIn' | 'chooseName' | 'pending' | 'blocked' | 'home' | 'admin' | 'error';

/** Which screen to show. `userDoc` undefined = still loading, null = no users doc yet. */
export function route(s: {
  authLoading: boolean;
  email: string | null;
  isAdmin: boolean;
  userDoc: UserDoc | null | undefined;
  /** The user doc listener failed; never route on its (missing) data. */
  userDocError?: boolean;
}): Screen {
  if (s.authLoading) return 'loading';
  if (!s.email) return 'signIn';
  // The admin never has a users doc, so decide before looking at it.
  if (s.isAdmin) return 'admin';
  if (s.userDocError) return 'error';
  if (s.userDoc === undefined) return 'loading';
  if (s.userDoc === null) return 'chooseName';
  switch (s.userDoc.status) {
    case 'pending':
      return 'pending';
    case 'member':
      return 'home';
    default:
      return 'blocked';
  }
}
