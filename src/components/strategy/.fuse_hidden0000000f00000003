'use client';

/**
 * ConditionGroupEditor — renders one AND-group of conditions.
 *
 * Multiple groups = OR logic between them (any group firing triggers the action).
 * Within a group all conditions must be satisfied (AND).
 */

import { ConditionRow } from './ConditionRow';
import type { ConditionGroup, StrategyCondition } from '@/types/strategy';
import { INDICATORS } from '@/lib/indicators';

function makeCondition(): StrategyCondition {
  const defaultId  = 'rsi';
  const indicator  = INDICATORS[defaultId];
  return {
    id:          `cond_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    indicatorId: defaultId,
    params:      indicator ? { ...indicator.defaultParams } : {},
    seriesIndex: 0,
    operator:    'lt',
    value:       30,
  };
}

interface Props {
  group:        ConditionGroup;
  groupIndex:   number;
  totalGroups:  number;
  onChange:     (updated: ConditionGroup) => void;
  onRemoveGroup: () => void;
}

export function ConditionGroupEditor({
  group,
  groupIndex,
  totalGroups,
  onChange,
  onRemoveGroup,
}: Props) {
  function addCondition() {
    onChange({ ...group, conditions: [...group.conditions, makeCondition()] });
  }

  function updateCondition(index: number, updated: StrategyCondition) {
    const next = [...group.conditions];
    next[index] = updated;
    onChange({ ...group, conditions: next });
  }

  function removeCondition(index: number) {
    onChange({
      ...group,
      conditions: group.conditions.filter((_, i) => i !== index),
    });
  }

  return (
    <div className="rounded border border-surface-border bg-surface-2 p-3 space-y-1">
      {/* ── Group header ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {groupIndex > 0 && (
            <span className="text-xs font-mono text-amber-400 font-semibold">OR</span>
          )}
          <input
            type="text"
            value={group.label}
            onChange={(e) => onChange({ ...group, label: e.target.value })}
            placeholder={`Group ${groupIndex + 1}`}
            className="input-xs w-36 text-text-muted"
          />
          <span className="text-xs text-text-muted">(AND within group)</span>
        </div>

        {totalGroups > 1 && (
          <button
            type="button"
            onClick={onRemoveGroup}
            className="btn-icon-xs text-red-400 hover:text-red-300"
            title="Remove group"
          >
            Remove group
          </button>
        )}
      </div>

      {/* ── Conditions ──────────────────────────────────────────────── */}
      {group.conditions.length === 0 && (
        <p className="text-xs text-text-muted italic pl-1">No conditions — add one below.</p>
      )}
      {group.conditions.map((condition, i) => (
        <div key={condition.id}>
          {i > 0 && (
            <span className="text-xs font-mono text-text-muted pl-1">AND</span>
          )}
          <ConditionRow
            condition={condition}
            onChange={(updated) => updateCondition(i, updated)}
            onRemove={() => removeCondition(i)}
          />
        </div>
      ))}

      {/* ── Add condition ───────────────────────────────────────────── */}
      <button
        type="button"
        onClick={addCondition}
        className="btn-xs mt-1"
      >
        + Add condition
      </button>
    </div>
  );
}
