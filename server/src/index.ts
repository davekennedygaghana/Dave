import { config } from './config.js';
import { openDb } from './db.js';
import { ensureAdmin } from './auth.js';
import { createApp } from './app.js';
import { startWorker, aiEnabled } from './services/ai.js';

const db = openDb();
const problem = ensureAdmin(db);
if (problem) {
  console.error(`[orthoboard] ${problem}`);
  process.exit(1);
}

const app = createApp(db);
startWorker(db);

app.listen(config.port, () => {
  console.log(`[orthoboard] berjalan di http://localhost:${config.port}`);
  console.log(`[orthoboard] data: ${config.dataDir} | zona waktu: ${config.timezone} | target harian: ${config.dailyTarget}`);
  console.log(`[orthoboard] integrasi AI: ${aiEnabled() ? `aktif (${config.aiModel})` : 'nonaktif (ANTHROPIC_API_KEY kosong)'}`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    db.close();
    process.exit(0);
  });
}
