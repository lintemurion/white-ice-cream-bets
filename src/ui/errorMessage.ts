import { isPermissionDenied } from '../data/errors';

/** For a denied move or vote on a bet: someone else most likely changed it first. */
export const BET_CHANGED = "That didn't work. The bet may have changed; try again.";

/**
 * Short inline message for a failed action. Validation errors (and the "Ask Kyle" ones) keep
 * their own text; a rules denial gets `denied`.
 */
export function errorMessage(err: unknown, denied = "That isn't allowed right now. Try again in a moment."): string {
  if (isPermissionDenied(err)) return denied;
  if (err instanceof Error && err.message && !('code' in err)) return err.message;
  return 'Something went wrong. Try again.';
}
