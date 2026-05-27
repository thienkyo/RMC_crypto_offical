/**
 * Strategy import / export helpers.
 *
 * Pure functions — no React, no store, no side-effects beyond the
 * browser download trick in exportToFile().
 *
 * Export envelope:
 *   { version: 1, exportedAt: ISO string, count: N, strategies: Strategy[] }
 *
 * Import: accepts both the envelope format and a raw Strategy[].
 * Validation is intentionally permissive — we only require the fields
 * the backtester and evaluator actually need, not every optional field.
 */

import type { Strategy } from '@/types/strategy';

// ── Export ─────────────────────────────────────────────────────────────────────

export interface StrategyExportEnvelope {
  version:    1;
  exportedAt: string;   // ISO 8601
  count:      number;
  strategies: Strategy[];
}

/**
 * Serialise `strategies` to a JSON blob and trigger a browser download.
 * Filename: rmc-strategies-YYYY-MM-DD.json
 */
export function exportToFile(strategies: Strategy[]): void {
  const payload: StrategyExportEnvelope = {
    version:    1,
    exportedAt: new Date().toISOString(),
    count:      strategies.length,
    strategies,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `rmc-strategies-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Import ─────────────────────────────────────────────────────────────────────

export type ImportResult =
  | { ok: true;  strategies: Strategy[]; count: number }
  | { ok: false; error: string };

/** Minimum required keys for a strategy object to be considered valid. */
const REQUIRED_KEYS = [
  'id', 'name', 'symbol', 'timeframe',
  'entryConditions', 'exitConditions',
  'action', 'risk',
] as const;

/**
 * Parse the text content of a .json file and extract valid Strategy objects.
 *
 * Accepts:
 *   - A StrategyExportEnvelope (version + strategies array)
 *   - A raw Strategy[]
 *
 * Returns { ok: true, strategies, count } on success,
 * or       { ok: false, error }           on any parse/validation failure.
 */
export function parseImportFile(text: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Invalid JSON — the file could not be parsed.' };
  }

  // Unwrap envelope or accept raw array
  let raw: unknown[];
  if (Array.isArray(parsed)) {
    raw = parsed;
  } else if (
    parsed !== null &&
    typeof parsed === 'object' &&
    'strategies' in parsed &&
    Array.isArray((parsed as { strategies: unknown }).strategies)
  ) {
    raw = (parsed as { strategies: unknown[] }).strategies;
  } else {
    return {
      ok:    false,
      error: 'Unrecognised format. Expected a RMC strategies export file.',
    };
  }

  // Filter to objects that have all required keys
  const valid: Strategy[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue;
    const obj = item as Record<string, unknown>;
    if (REQUIRED_KEYS.every((k) => k in obj)) {
      valid.push(obj as unknown as Strategy);
    }
  }

  if (valid.length === 0) {
    return { ok: false, error: 'No valid strategies found in the file.' };
  }

  return { ok: true, strategies: valid, count: valid.length };
}
