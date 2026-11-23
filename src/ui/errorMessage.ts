import { isPermissionDenied } from '../data/errors';

/** Short inline message for a failed action. Validation errors keep their own text. */
export function errorMessage(err: unknown): string {
  if (isPermissionDenied(err)) return "That isn't allowed right now. Try again in a moment.";
  if (err instanceof Error && err.message && !('code' in err)) return err.message;
  return 'Something went wrong. Try again.';
}
