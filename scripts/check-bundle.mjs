// Fails if the built site contains test settings (emulator project, test admin, auth emulator).
// Usage: node scripts/check-bundle.mjs [dir]   (default: dist)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { findForbidden } from './lib/deploy-config.mjs';

const dir = process.argv[2] ?? 'dist';

function files(path) {
  return statSync(path).isDirectory()
    ? readdirSync(path).flatMap((name) => files(join(path, name)))
    : /\.(js|html)$/.test(path) ? [path] : [];
}

let all;
try {
  all = files(dir);
} catch {
  console.error(`check-bundle: ${dir} not found; run npm run build first`);
  process.exit(1);
}

const hits = all.flatMap((file) => findForbidden(readFileSync(file, 'utf8')).map((m) => `${file}: ${m}`));
if (hits.length) {
  console.error('check-bundle: test settings found in the build:');
  for (const hit of hits) console.error(`  ${hit}`);
  process.exit(1);
}
console.log(`check-bundle: ok (${all.length} files)`);
