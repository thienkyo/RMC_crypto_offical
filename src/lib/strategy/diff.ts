/**
 * Semantic strategy diff.
 *
 * Compares two Strategy snapshots and returns a structured list of changes.
 * Pure function — no side-effects, no imports beyond the Strategy type.
 *
 * Designed for the History tab diff view: readable by a human, not a machine.
 * Does NOT do git-style line diffs — it does structural, field-level diffing.
 */

import type { Strategy, StrategyCondition, ConditionGroup } from '@/types/strategy';

// ── Change types ──────────────────────────────────────────────────────────────

export type DiffSection = 'meta' | 'action' | 'risk' | 'entry' | 'exit';

export interface ScalarChange {
  kind:    'scalar';
  section: DiffSection;
  field:   string;
  from:    string;
  to:      string;
}

export interface ConditionChange {
  kind:      'condition';
  section:   'entry' | 'exit';
  groupIdx:  number;
  groupLabel: string;
  change:    'added_group' | 'removed_group' | 'added_cond' | 'removed_cond' | 'changed_cond';
  /** Human-readable description of what changed. */
  detail:    string;
}

export type DiffChange = ScalarChange | ConditionChange;

// ── Helpers ───────────────────────────────────────────────────────────────────

function str(v: unknown): string {
  if (v === null || v === undefined) return '—';
  return String(v);
}

function condLabel(c: StrategyCondition): string {
  return `${c.indicatorId.toUpperCase()}[${c.seriesIndex}] ${c.operator} ${c.value}`;
}

function groupLabel(g: ConditionGroup, idx: number): string {
  return g.label?.trim() ? g.label : `Group ${idx + 1}`;
}

// ── Scalar field diffing ──────────────────────────────────────────────────────

function diffScalars(from: Strategy, to: Strategy): ScalarChange[] {
  const changes: ScalarChange[] = [];

  const metaFields: Array<[keyof Strategy, string]> = [
    ['name',      'Name'],
    ['symbol',    'Symbol'],
    ['timeframe', 'Timeframe'],
    ['description', 'Description'],
  ];
  for (const [key, label] of metaFields) {
    const f = str(from[key]);
    const t = str(to[key]);
    if (f !== t) changes.push({ kind: 'scalar', section: 'meta', field: label, from: f, to: t });
  }

  // Action
  if (from.action.type !== to.action.type) {
    changes.push({ kind: 'scalar', section: 'action', field: 'Direction',
      from: from.action.type === 'enter_long' ? 'Long' : 'Short',
      to:   to.action.type   === 'enter_long' ? 'Long' : 'Short' });
  }
  if (from.action.positionSizePct !== to.action.positionSizePct) {
    changes.push({ kind: 'scalar', section: 'action', field: 'Position size',
      from: `${from.action.positionSizePct}%`, to: `${to.action.positionSizePct}%` });
  }
  if (from.action.maxPositions !== to.action.maxPositions) {
    changes.push({ kind: 'scalar', section: 'action', field: 'Max positions',
      from: str(from.action.maxPositions), to: str(to.action.maxPositions) });
  }

  // Risk
  if (from.risk.stopLossPct !== to.risk.stopLossPct) {
    changes.push({ kind: 'scalar', section: 'risk', field: 'Stop loss',
      from: `${from.risk.stopLossPct}%`, to: `${to.risk.stopLossPct}%` });
  }
  if (from.risk.takeProfitPct !== to.risk.takeProfitPct) {
    changes.push({ kind: 'scalar', section: 'risk', field: 'Take profit',
      from: `${from.risk.takeProfitPct}%`, to: `${to.risk.takeProfitPct}%` });
  }

  return changes;
}

// ── Condition group diffing ───────────────────────────────────────────────────

function diffConditionSection(
  fromGroups: ConditionGroup[],
  toGroups:   ConditionGroup[],
  section:    'entry' | 'exit',
): ConditionChange[] {
  const changes: ConditionChange[] = [];
  const maxLen = Math.max(fromGroups.length, toGroups.length);

  for (let i = 0; i < maxLen; i++) {
    const fromG = fromGroups[i];
    const toG   = toGroups[i];

    if (!fromG && toG) {
      // Entire group added
      changes.push({
        kind: 'condition', section, groupIdx: i,
        groupLabel: groupLabel(toG, i),
        change: 'added_group',
        detail: `Added group "${groupLabel(toG, i)}" with ${toG.conditions.length} condition(s)`,
      });
      continue;
    }

    if (fromG && !toG) {
      // Entire group removed
      changes.push({
        kind: 'condition', section, groupIdx: i,
        groupLabel: groupLabel(fromG, i),
        change: 'removed_group',
        detail: `Removed group "${groupLabel(fromG, i)}" (had ${fromG.conditions.length} condition(s))`,
      });
      continue;
    }

    if (!fromG || !toG) continue;

    // Both exist — diff conditions within the group
    const label = groupLabel(toG, i);
    const fromConds = fromG.conditions;
    const toConds   = toG.conditions;
    const condMax   = Math.max(fromConds.length, toConds.length);

    for (let j = 0; j < condMax; j++) {
      const fc = fromConds[j];
      const tc = toConds[j];

      if (!fc && tc) {
        changes.push({
          kind: 'condition', section, groupIdx: i, groupLabel: label,
          change: 'added_cond',
          detail: `Added: ${condLabel(tc)}`,
        });
      } else if (fc && !tc) {
        changes.push({
          kind: 'condition', section, groupIdx: i, groupLabel: label,
          change: 'removed_cond',
          detail: `Removed: ${condLabel(fc)}`,
        });
      } else if (fc && tc) {
        const changed =
          fc.indicatorId  !== tc.indicatorId  ||
          fc.seriesIndex  !== tc.seriesIndex   ||
          fc.operator     !== tc.operator      ||
          fc.value        !== tc.value         ||
          JSON.stringify(fc.params) !== JSON.stringify(tc.params);

        if (changed) {
          changes.push({
            kind: 'condition', section, groupIdx: i, groupLabel: label,
            change: 'changed_cond',
            detail: `Changed: ${condLabel(fc)} → ${condLabel(tc)}`,
          });
        }
      }
    }
  }

  return changes;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface DiffResult {
  changes:   DiffChange[];
  /** true when the two snapshots are identical in all diffed fields. */
  identical: boolean;
}

/**
 * Compute a semantic diff between two strategy snapshots.
 *
 * @param from  The older / selected historical version.
 * @param to    The newer / current version (what's in the editor now).
 */
export function diffStrategies(from: Strategy, to: Strategy): DiffResult {
  const changes: DiffChange[] = [
    ...diffScalars(from, to),
    ...diffConditionSection(from.entryConditions, to.entryConditions, 'entry'),
    ...diffConditionSection(from.exitConditions,  to.exitConditions,  'exit'),
  ];
  return { changes, identical: changes.length === 0 };
}

// ── Display helpers (used by the UI component) ────────────────────────────────

export const SECTION_LABELS: Record<DiffSection, string> = {
  meta:   'Metadata',
  action: 'Action',
  risk:   'Risk',
  entry:  'Entry Conditions',
  exit:   'Exit Conditions',
};

export const CHANGE_COLORS: Record<ConditionChange['change'], string> = {
  added_group:   'text-emerald-400',
  removed_group: 'text-red-400',
  added_cond:    'text-emerald-400',
  removed_cond:  'text-red-400',
  changed_cond:  'text-amber-400',
};
