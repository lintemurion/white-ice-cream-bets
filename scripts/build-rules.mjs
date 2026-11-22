// Generates firestore.rules from firestore.rules.src, substituting the admin email.
// The email comes from VITE_ADMIN_EMAIL in .env.local. Fails loudly if it is missing.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env.local');

function fail(msg) {
  console.error(`build-rules: ${msg}`);
  process.exit(1);
}

if (!existsSync(envPath)) fail('.env.local not found; copy .env.example and set VITE_ADMIN_EMAIL');

const match = readFileSync(envPath, 'utf8').match(/^\s*VITE_ADMIN_EMAIL\s*=\s*(.*?)\s*$/m);
const email = match?.[1].replace(/^(['"])(.*)\1$/, '$2').trim();
if (!email) fail('VITE_ADMIN_EMAIL is missing or empty in .env.local');
if (!/^[^\s'"\@]+@[^\s'"\@]+$/.test(email)) fail(`VITE_ADMIN_EMAIL is not a plain email: ${email}`);

const src = readFileSync(join(root, 'firestore.rules.src'), 'utf8');
if (!src.includes('__ADMIN_EMAIL__')) fail('firestore.rules.src has no __ADMIN_EMAIL__ placeholder');

writeFileSync(join(root, 'firestore.rules'), src.replaceAll('__ADMIN_EMAIL__', email));
console.log(`build-rules: wrote firestore.rules for ${email}`);
