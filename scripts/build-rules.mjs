// Generates firestore.rules from firestore.rules.src, substituting the admin email.
// Deploy mode (default): the email comes from the VITE_ADMIN_EMAIL environment variable
// (set by CI), falling back to .env.local, and the output is firestore.rules. Fails loudly
// if the email is missing.
// Test mode (--test): uses the fixed test admin email and writes .emulator/firestore.rules,
// which firebase.test.json points the emulator at.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolveAdminEmail } from './lib/deploy-config.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env.local');
// Must match ADMIN_EMAIL in tests/rules/helpers.ts.
const TEST_ADMIN_EMAIL = 'admin@example.test';
const testMode = process.argv.includes('--test');

function fail(msg) {
  console.error(`build-rules: ${msg}`);
  process.exit(1);
}

function deployEmail() {
  const envLocalText = existsSync(envPath) ? readFileSync(envPath, 'utf8') : null;
  try {
    return resolveAdminEmail({ env: process.env, envLocalText });
  } catch (err) {
    fail(err.message);
  }
}

// Lowercased: the rules compare against the lowercased token email.
const email = testMode ? TEST_ADMIN_EMAIL : deployEmail();

const src = readFileSync(join(root, 'firestore.rules.src'), 'utf8');
if (!src.includes('__ADMIN_EMAIL__')) fail('firestore.rules.src has no __ADMIN_EMAIL__ placeholder');

const outDir = testMode ? join(root, '.emulator') : root;
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'firestore.rules'), src.replaceAll('__ADMIN_EMAIL__', email));
console.log(`build-rules: wrote ${testMode ? '.emulator/' : ''}firestore.rules for ${email}`);
