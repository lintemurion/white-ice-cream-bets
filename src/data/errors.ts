/** True for a Firestore write the security rules refused. */
export function isPermissionDenied(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'permission-denied';
}

/**
 * Commits `write`; a rules denial means "not decided" and resolves to false.
 * Any other error is rethrown.
 */
export async function attempt(write: () => Promise<void>): Promise<boolean> {
  try {
    await write();
    return true;
  } catch (err) {
    if (isPermissionDenied(err)) return false;
    throw err;
  }
}

/**
 * Trims `value` and checks it is 1 to `max` chars, matching the rules' validText. Both count
 * UTF-16 code units: the rules' string.size() measures the same as .length (an emoji counts
 * as 2), pinned against the emulator in tests/data/text-limits.test.ts.
 */
export function cleanText(value: string, max: number, label: string): string {
  const s = value.trim();
  if (s.length < 1) throw new Error(`${label} cannot be blank`);
  if (s.length > max) throw new Error(`${label} must be ${max} characters or fewer`);
  return s;
}
