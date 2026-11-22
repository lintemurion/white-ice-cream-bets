// Generates firestore.rules from firestore.rules.src, substituting the admin email.
// Deploy mode (default): the email comes from VITE_ADMIN_EMAIL in .env.local and the
// output is firestore.rules. Fails loudly if the email is missing.
// Test mode (--test): uses the fixed test admin email and writes .emulator/firestore.rules,
// which firebase.test.json points the emulator at.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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
  if (!existsSync(envPath)) fail('.env.local not found; copy .env.example and set VITE_ADMIN_EMAIL');
  const match = readFileSync(envPath, 'utf8').match(/^\s*VITE_ADMIN_EMAIL\s*=\s*(.*?)\s*$/m);
  return match?.[1].replace(/^(['"])(.*)\1$/, '$2').trim();
}

const email = testMode ? TEST_ADMIN_EMAIL : deployEmail();
if (!email) fail('VITE_ADMIN_EMAIL is missing or empty in .env.local');
if (!/^[^\s'"\@]+@[^\s'"\@]+$/.test(email)) fail(`VITE_ADMIN_EMAIL is not a plain email: ${email}`);

const src = readFileSync(join(root, 'firestore.rules.src'), 'utf8');
if (!src.includes('__ADMIN_EMAIL__')) fail('firestore.rules.src has no __ADMIN_EMAIL__ placeholder');

const outDir = testMode ? join(root, '.emulator') : root;
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'firestore.rules'), src.replaceAll('__ADMIN_EMAIL__', email));
console.log(`build-rules: wrote ${testMode ? '.emulator/' : ''}firestore.rules for ${email}`);
