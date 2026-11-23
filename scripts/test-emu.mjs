// Runs vitest inside the Firestore emulator, loaded with the generated test rules
// (never the allow-all fallback). Extra args select test files:
//   npm run test:emu -- tests/rules/joins.test.ts
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { delimiter, dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = process.argv.slice(2);
const target = files.length ? files.join(' ') : 'tests/rules tests/data';
// Local binaries (firebase, vitest) resolve even when run outside npm.
const env = { ...process.env, PATH: `${join(root, 'node_modules', '.bin')}${delimiter}${process.env.PATH}` };

function run(cmd) {
  const r = spawnSync(cmd, { stdio: 'inherit', shell: true, cwd: root, env });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run('node scripts/build-rules.mjs --test');
run(`firebase emulators:exec --config firebase.test.json --only firestore --project demo-wicb "vitest run ${target}"`);
