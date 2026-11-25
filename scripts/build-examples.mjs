// Bangun paket contoh: public/examples/contoh-paket-demo.zip dan salin template.
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { zipSync } from 'fflate';

function collect(dir, base = dir, out = {}) {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) collect(full, base, out);
    else out[relative(base, full).split('\\').join('/')] = new Uint8Array(readFileSync(full));
  }
  return out;
}

mkdirSync('public/examples', { recursive: true });
const files = collect('examples/contoh-paket-demo');
writeFileSync('public/examples/contoh-paket-demo.zip', zipSync(files, { mtime: new Date('2026-01-01T00:00:00Z') }));
copyFileSync('examples/stations.template.json', 'public/examples/stations.template.json');
console.log('ditulis public/examples/contoh-paket-demo.zip (', Object.keys(files).join(', '), ')');
