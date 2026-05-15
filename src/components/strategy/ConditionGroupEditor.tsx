'use client';

/**
 * ConditionGroupEditor — renders one condition group with configurable logic.
 *
 * operator (inter-group role):
 *   'or'  (default) — alternative setup; OR'd with other groups.
 *   'and'           — required filter; AND'd with other groups.
 *
 * conditionOperator (intra-group):
 *   Defaults to 'and' for OR groups, 'or' for AND groups.
 *   Independently overridable via the toggle in the header.
 */

import { ConditionRow } from './ConditionRow';
import type { ConditionGroup, StrategyCondition } from '@/types/strategy';
import { INDICATORS } from '@/lib/indicators';

function makeCondition(): StrategyCondition {
  const defaultId = 'rsi';
  const indicator = INDICATORS[defaultId];
  return {
    id:          `cond_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    indicatorId: defaultId,
    params:      indicator ? { ...indicator.defaultParams } : {},
    seriesIndex: 0,
    operator:    'lt',
    value:       30,
  };
}

/** Resolve the effective intra-group operator, respecting the smart default. */
function resolveCondOp(group: ConditionGroup): 'and' | 'or' {
  if (group.conditionOperator !== undefined) return group.conditionOperator;
  return group.operator === 'and' ? 'or' : 'and';
}

interface Props {
  group:         ConditionGroup;
  groupIndex:    number;
  totalGroups:   number;
  onChange:      (updated: ConditionGroup) => void;
  onRemoveGroup: () => void;
  /** When true, renders a timeframe selector in the group header (Multi-TF mode). */
  isMultiTf?:    boolean;
}

export function ConditionGroupEditor({
  group,
  groupIndex,
  totalGroups,
  onChange,
  onRemoveGroup,
  isMultiTf = false,
}: Props) {
  const groupOp  = group.operator ?? 'or';
  const condOp   = resolveCondOp(group);
  const isOrGroup = groupOp === 'or';

  function addCondition() {
    onChange({ ...group, conditions: [...group.conditions, makeCondition()] });
  }

  function updateCondition(index: number, updated: StrategyCondition) {
    const next = [...group.conditions];
    next[index] = updated;
    onChange({ ...group, conditions: next });
  }

  function removeCondition(index: number) {
    onChange({ ...group, conditions: group.conditions.filter((_, i) => i !== index) });
  }

  function toggleGroupOperator() {
    const next = groupOp === 'or' ? 'and' : 'or';
    // Reset conditionOperator so the smart default kicks in for the new role,
    // unless it was already explicitly overridden to match the new default.
    const newCondOp: 'and' | 'or' = next === 'and' ? 'or' : 'and';
    const keepExplicit = group.conditionOperator !== undefined
      && group.conditionOperator !== newCondOp;
    onChange({
      ...group,
      operator: next,
      conditionOperator: keepExplicit ? group.conditionOperator : undefined,
    });
  }

  function toggleConditionOperator() {
    const current = resolveCondOp(group);
    onChange({ ...group, conditionOperator: current === 'and' ? 'or' : 'and' });
  }

  return (
    <div className={`rounded border bg-surface-2 p-3 space-y-1 ${
      isOrGroup ? 'border-surface-border' : 'border-amber-500/30'
    }`}>
      {/* ── Group header ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-2 gap-2">
        <div className="flex items-center gap-2 flex-wrap min-w-0">

          {/* Group-type badge — hidden for the first group (always OR, role is implicit) */}
          {groupIndex > 0 && (
            <button
              type="button"
              onClick={toggleGroupOperator}
              title={isOrGroup
                ? 'OR group: any OR group firing is enough. Click to change to AND group (required filter).'
                : 'AND group: this must fire alongside all other AND groups. Click to change to OR group.'}
              className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded border
                          transition-colors cursor-pointer flex-shrink-0 ${
                isOrGroup
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
                  : 'bg-amber-500/10  text-amber-400  border-amber-500/30  hover:bg-amber-500/20'
              }`}
            >
              {isOrGroup ? 'OR group' : 'AND group'}
            </button>
          )}

          {/* Inner condition operator toggle */}
          <button
            type="button"
            onClick={toggleConditionOperator}
            title={`Conditions inside combined with ${condOp.toUpperCase()}. Click to flip.`}
            className="text-[10px] font-mono px-1.5 py-0.5 rounded border
                       border-surface-border text-text-muted hover:text-text-primary
                       hover:border-text-muted transition-colors flex-shrink-0"
          >
            inside: <span className="font-semibold text-text-secondary">{condOp.toUpperCase()}</span>
          </button>

          {/* Optional label input */}
          <input
            type="text"
            value={group.label}
            onChange={(e) => onChange({ ...group, label: e.target.value })}
            placeholder={`Group ${groupIndex + 1}`}
            className="input-xs w-32 text-text-muted min-w-0"
          />
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {totalGroups > 1 && (
            <button
              type="button"
              onClick={onRemoveGroup}
              className="btn-icon-xs text-red-400 hover:text-red-300 text-xs"
              title="Remove group"
            >
              Remove
            </button>
          )}
        </div>
      </div>

      {/* ── Conditions ──────────────────────────────────────────────── */}
      {group.conditions.length === 0 && (
        <p className="text-xs text-text-muted italic pl-1">No conditions — add one below.</p>
      )}

      {group.conditions.map((condition, i) => (
        <div key={condition.id}>
          {/* Operator separator between conditions */}
          {i > 0 && (
            <div className="flex items-center gap-1 py-0.5 pl-1">
              <span className={`text-[10px] font-mono font-semibold px-1.5 py-px rounded ${
                condition.enabled === false
                  ? 'text-text-muted opacity-30'
                  : condOp === 'and'
                    ? 'text-blue-400 bg-blue-500/10'
                    : 'text-violet-400 bg-violet-500/10'
              }`}>
                {condOp.toUpperCase()}
              </span>
            </div>
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
