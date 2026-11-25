import path from 'node:path';

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 3000),
  dataDir: path.resolve(env.DATA_DIR ?? './data'),
  timezone: env.APP_TIMEZONE ?? 'Asia/Makassar',
  dailyTarget: Math.max(1, Number(env.DAILY_TARGET ?? 1000)),
  adminUsername: env.ADMIN_USERNAME ?? 'admin',
  adminPassword: env.ADMIN_PASSWORD ?? '',
  cookieSecure: (env.COOKIE_SECURE ?? 'false') === 'true',
  referenceAccess: (env.REFERENCE_ACCESS === 'authenticated' ? 'authenticated' : 'admin') as 'admin' | 'authenticated',
  maxUploadMb: Number(env.MAX_UPLOAD_MB ?? 300),
  anthropicApiKey: env.ANTHROPIC_API_KEY ?? '',
  aiModel: env.AI_MODEL ?? 'claude-opus-5-5',
  aiPagesPerBatch: Math.max(1, Number(env.AI_PAGES_PER_BATCH ?? 6)),
};

export const SESSION_SIZES = [10, 25, 50, 100, 250, 500, 1000] as const;
