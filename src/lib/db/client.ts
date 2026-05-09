import { Pool } from 'pg';

/**
 * Singleton pg Pool.
 *
 * Next.js hot-reload in dev creates new module instances, which would create
 * new pools on every HMR cycle and exhaust connections. We store the pool on
 * the global object so it survives module re-evaluation.
 *
 * In production there is only one module instance, so the global trick is a
 * no-op — the pool is just created once normally.
 */
declare global {
  // eslint-disable-next-line no-var
  var _pgPool: Pool | undefined;
}

function createPool(): Pool {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.local.example → .env.local and fill it in.',
    );
  }

  const pool = new Pool({
    connectionString: url,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 3_000,
    // Required for Neon/Supabase hosted Postgres
    ssl: url.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
  });

  pool.on('error', (err) => {
    console.error('[db] Unexpected idle client error:', err.message);
  });

  return pool;
}

export const db: Pool = globalThis._pgPool ?? (globalThis._pgPool = createPool());
