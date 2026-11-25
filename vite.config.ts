import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';

/**
 * Plugin kecil yang menghasilkan dist/sw.js dengan daftar precache
 * (semua file hasil build + isi folder public). Tidak butuh dependensi tambahan.
 */
function serviceWorkerPlugin(): Plugin {
  return {
    name: 'osce-service-worker',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const files = new Set<string>(['./', 'index.html']);
      for (const name of Object.keys(bundle)) {
        if (!name.endsWith('.map')) files.add(name);
      }
      const walk = (dir: string) => {
        for (const entry of readdirSync(dir)) {
          const full = join(dir, entry);
          if (statSync(full).isDirectory()) walk(full);
          else files.add(relative('public', full).split('\\').join('/'));
        }
      };
      walk('public');
      files.delete('sw-template.js');
      const list = [...files].sort();
      const version = createHash('sha256').update(list.join('|') + Date.now()).digest('hex').slice(0, 12);
      const template = readFileSync('src/sw-template.js', 'utf8');
      const source = template
        .replace('__PRECACHE__', JSON.stringify(list))
        .replace('__VERSION__', version);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), serviceWorkerPlugin()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
