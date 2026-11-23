// Renders public/icon.svg into the PNG icons used by the manifest and iOS.
// Run: node scripts/build-icons.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const svg = readFileSync(new URL('../public/icon.svg', import.meta.url), 'utf8');
// iOS rounds the corners itself and fills transparent pixels with black, so its icon is full-bleed.
const square = svg.replace('rx="112"', 'rx="0"');

const outputs = [
  ['icon-192.png', 192, svg],
  ['icon-512.png', 512, svg],
  ['apple-touch-icon.png', 180, square],
];

for (const [name, size, source] of outputs) {
  const png = new Resvg(source, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(new URL(`../public/${name}`, import.meta.url), png);
  console.log(`wrote public/${name} (${size}x${size})`);
}
