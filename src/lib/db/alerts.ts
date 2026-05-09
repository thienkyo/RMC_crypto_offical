/**
 * DB query helpers for the Phase 5 alerts tables.
 * Server-side only — import only from API routes / Server Components.
 */

import { db } from './client';
import type { AlertRule, AlertHistoryEntry, CreateAlertInput, UpdateAlertInput } from '@/types/alert';
import type { Timeframe } from '@/types/market';

// ─── Row mappers ──────────────────────────────────────────────────────────────

function rowToAlertRule(row: Record<string, unknown>): AlertRule {
  return {
    id:           row['id'] as string,
    name:         row['name'] as string,
    symbol:       row['symbol'] as string,
    timeframe:    row['timeframe'] as Timeframe,
    enabled:      row['enabled'] as boolean,
    condition:    row['condition'] as AlertRule['condition'],
    cooldownMs:   row['cooldown_ms'] as number,
    lastFiredAt:  row['last_fired_at']
                    ? (row['last_fired_at'] as Date).getTime()
                    : null,
    createdAt:    (row['created_at'] as Date).getTime(),
    updatedAt:    (row['updated_at'] as Date).getTime(),
  };
}

function rowToHistoryEntry(row: Record<string, unknown>): AlertHistoryEntry {
  return {
    id:        row['id'] as string,
    ruleId:    row['rule_id'] as string,
    firedAt:   (row['fired_at'] as Date).getTime(),
    message:   row['message'] as string,
    delivered: row['delivered'] as boolean,
  };
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/** All alert rules (enabled + disabled), newest first. */
export async function getAllAlertRules(): Promise<AlertRule[]> {
  const { rows } = await db.query(
    `SELECT * FROM alert_rules ORDER BY created_at DESC`,
  );
  return rows.map(rowToAlertRule);
}

/** Only enabled rules — used by the cron evaluator. */
export async function getEnabledAlertRules(): Promise<AlertRule[]> {
  const { rows } = await db.query(
    `SELECT * FROM alert_rules WHERE enabled = TRUE ORDER BY created_at DESC`,
  );
  return rows.map(rowToAlertRule);
}

/** Recent alert history, newest-first, optionally filtered by ruleId. */
export async function getAlertHistory(
  ruleId?: string,
  limit:   number = 50,
): Promise<AlertHistoryEntry[]> {
  const params: unknown[] = [limit];
  const where = ruleId
    ? `WHERE rule_id = $2`
    : '';
  if (ruleId) params.push(ruleId);

  const { rows } = await db.query(
    `SELECT * FROM alert_history ${where} ORDER BY fired_at DESC LIMIT $1`,
    params,
  );
  return rows.map(rowToHistoryEntry);
}

// ─── Write ────────────────────────────────────────────────────────────────────

/** Insert a new alert rule and return it. */
export async function createAlertRule(input: CreateAlertInput): Promise<AlertRule> {
  const { rows } = await db.query(
    `INSERT INTO alert_rules (name, symbol, timeframe, condition, cooldown_ms)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      input.name,
      input.symbol,
      input.timeframe,
      JSON.stringify(input.condition),
      input.cooldownMs ?? 3_600_000,
    ],
  );
  return rowToAlertRule(rows[0] as Record<string, unknown>);
}

/** Update name / enabled / condition / cooldownMs on an existing rule. */
export async function updateAlertRule(input: UpdateAlertInput): Promise<AlertRule | null> {
  // Build SET clause dynamically from provided fields.
  const sets: string[]   = ['updated_at = NOW()'];
  const params: unknown[] = [];

  function addField(col: string, val: unknown) {
    params.push(val);
    sets.push(`${col} = $${params.length}`);
  }

  if (input.name      !== undefined) addField('name',        input.name);
  if (input.enabled   !== undefined) addField('enabled',     input.enabled);
  if (input.condition !== undefined) addField('condition',   JSON.stringify(input.condition));
  if (input.cooldownMs !== undefined) addField('cooldown_ms', input.cooldownMs);

  if (sets.length === 1) {
    // Nothing to update — just return current state.
    const { rows } = await db.query(`SELECT * FROM alert_rules WHERE id = $1`, [input.id]);
    return rows.length ? rowToAlertRule(rows[0] as Record<string, unknown>) : null;
  }

  params.push(input.id);
  const { rows } = await db.query(
    `UPDATE alert_rules SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params,
  );
  return rows.length ? rowToAlertRule(rows[0] as Record<string, unknown>) : null;
}

/** Hard-delete an alert rule (cascades to history). */
export async function deleteAlertRule(id: string): Promise<boolean> {
  const { rowCount } = await db.query(
    `DELETE FROM alert_rules WHERE id = $1`,
    [id],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Record a fired alert and stamp last_fired_at on the rule.
 * Returns the new history entry.
 */
export async function logAlertFired(
  ruleId:  string,
  message: string,
): Promise<AlertHistoryEntry> {
  // Run both writes in a transaction so they're atomic.
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `INSERT INTO alert_history (rule_id, message, delivered)
       VALUES ($1, $2, FALSE)
       RETURNING *`,
      [ruleId, message],
    );

    await client.query(
      `UPDATE alert_rules SET last_fired_at = NOW() WHERE id = $1`,
      [ruleId],
    );

    await client.query('COMMIT');
    return rowToHistoryEntry(rows[0] as Record<string, unknown>);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Mark a history entry as delivered after Telegram confirmed send. */
export async function markAlertDelivered(historyId: string): Promise<void> {
  await db.query(
    `UPDATE alert_history SET delivered = TRUE WHERE id = $1`,
    [historyId],
  );
}
