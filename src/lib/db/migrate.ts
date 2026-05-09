/**
 * Database migration runner.
 * Usage: npm run migrate
 *
 * Loads .env.local manually (tsx doesn't auto-load it), then applies
 * schema.sql idempotently. Safe to run multiple times.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

// ── 1. Load .env.local BEFORE anything that reads process.env ────────────────
// Static imports are hoisted, so we can't use the db client module here.
// We parse the file ourselves and inject into process.env.
const envPath = join(process.cwd(), '.env.local');
try {
  const lines = readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (key && !(key in process.env)) process.env[key] = val;
  }
} catch {
  // No .env.local — DATABASE_URL must already be set in the shell environment
}

// ── 2. Now import db (dynamic so it runs after env is populated) ─────────────
import { Pool } from 'pg';

const url = process.env['DATABASE_URL'];
if (!url) {
  console.error('[migrate] ✗ DATABASE_URL is not set. Did you copy .env.local.example → .env.local?');
  process.exit(1);
}

const pool = new Pool({ connectionString: url });

// ── 3. Apply schema ───────────────────────────────────────────────────────────
async function migrate() {
  console.log('[migrate] Connecting…');
  const client = await pool.connect();
  try {
    const sql = readFileSync(join(process.cwd(), 'src/lib/db/schema.sql'), 'utf-8');
    await client.query(sql);
    console.log('[migrate] ✓ Schema applied successfully');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((err: Error) => {
  console.error('[migrate] ✗ Failed:', err.message);
  process.exit(1);
});
