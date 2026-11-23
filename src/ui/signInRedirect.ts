/**
 * Redirect sign-in can come back with no user and no error (for example a blocked
 * third-party cookie or a misconfigured auth domain). A sessionStorage flag set before the
 * redirect lets the app notice that and say so instead of silently showing Sign in again.
 */

const KEY = 'wicb.signInRedirect';

export const UNFINISHED_SIGN_IN = "Sign-in didn't finish. Please try again.";

/** Whether to report an unfinished sign-in: a redirect was started and auth settled signed out. */
export function unfinishedSignIn(flagSet: boolean, user: object | null | undefined): boolean {
  return flagSet && user === null;
}

function safeStorage(): Storage | undefined {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}

/** Call right before signInWithRedirect. */
export function markRedirectStarted(storage: Storage | undefined = safeStorage()): void {
  try {
    storage?.setItem(KEY, '1');
  } catch {
    // Storage blocked: we just lose the failure message.
  }
}

/** Call when the redirect never started (signInWithRedirect rejected). */
export function clearRedirectStarted(storage: Storage | undefined = safeStorage()): void {
  try {
    storage?.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}

/**
 * Call when the auth state changes. Once auth has settled (user is not undefined) the flag
 * is cleared; returns true when the redirect came back without a user.
 */
export function checkRedirectReturn(
  user: object | null | undefined,
  storage: Storage | undefined = safeStorage(),
): boolean {
  if (user === undefined || !storage) return false;
  try {
    const flagSet = storage.getItem(KEY) !== null;
    if (flagSet) storage.removeItem(KEY);
    return unfinishedSignIn(flagSet, user);
  } catch {
    return false;
  }
}
