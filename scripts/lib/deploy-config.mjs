// Pure helpers for the deploy pipeline. No file or process access here, so they're unit-testable.

/** Strings that must never appear in a production bundle: emulator project, test admin, auth emulator. */
export const FORBIDDEN_MARKERS = ['demo-wicb', 'admin@example.test', '127.0.0.1:9099'];

const PLAIN_EMAIL = /^[^\s'"@]+@[^\s'"@]+$/;

function fromEnvLocal(text) {
  if (!text) return '';
  const match = text.match(/^\s*VITE_ADMIN_EMAIL\s*=\s*(.*?)\s*$/m);
  return (match?.[1] ?? '').replace(/^(['"])(.*)\1$/, '$2').trim();
}

/**
 * The admin email for the deployed rules: VITE_ADMIN_EMAIL from the environment (CI) if set,
 * otherwise from .env.local (local deploys). Lowercased, because the rules compare lowercase.
 */
export function resolveAdminEmail({ env, envLocalText }) {
  const fromEnv = (env.VITE_ADMIN_EMAIL ?? '').trim();
  const email = (fromEnv || fromEnvLocal(envLocalText)).toLowerCase();
  if (!email) {
    throw new Error('VITE_ADMIN_EMAIL is not set: set it in the environment (CI) or in .env.local');
  }
  if (!PLAIN_EMAIL.test(email)) throw new Error(`VITE_ADMIN_EMAIL is not a plain email: ${email}`);
  return email;
}

/** Which of the markers appear in the text. */
export function findForbidden(text, markers = FORBIDDEN_MARKERS) {
  return markers.filter((m) => text.includes(m));
}
