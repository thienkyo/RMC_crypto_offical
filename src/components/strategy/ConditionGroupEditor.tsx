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

import { useState } from 'react';
import { ConditionRow } from './ConditionRow';
import type { ConditionGroup, StrategyCondition } from '@/types/strategy';
import type { Timeframe } from '@/types/market';
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
  baseTimeframe?: Timeframe;
}

export function ConditionGroupEditor({
  group,
  groupIndex,
  totalGroups,
  onChange,
  onRemoveGroup,
  isMultiTf = false,
  baseTimeframe,
}: Props) {
  const [collapsed, setCollapsed] = useState(groupIndex > 0);
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
    <div className={`rounded-lg border bg-surface-2/90 p-3 space-y-1 shadow-sm transition-all ${
      isOrGroup ? 'border-surface-border border-l-4 border-l-emerald-500/70' : 'border-amber-500/30 border-l-4 border-l-amber-500/70'
    }`}>
      {/* ── Group header ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 flex-wrap sm:flex-nowrap">
        <div className="flex items-center gap-2 flex-wrap min-w-0 flex-1">
          {/* Group number indicator */}
          <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-surface-3 text-text-secondary border border-surface-border flex-shrink-0">
            Group {groupIndex + 1}
          </span>

          {/* Group-type badge / toggle */}
          {groupIndex === 0 ? (
            <span
              className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded border
                         bg-emerald-500/10 text-emerald-400 border-emerald-500/30 flex-shrink-0 select-none"
              title="Primary setup (OR group: triggers strategy entry independently)"
            >
              OR setup
            </span>
          ) : (
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
            title={`Conditions inside combined with ${condOp.toUpperCase()}. Click to switch to ${condOp === 'and' ? 'OR (any condition matches)' : 'AND (all conditions must match)'}.`}
            className="text-[10px] font-mono px-2 py-0.5 rounded border
                       border-surface-border bg-surface-1/70 text-text-muted hover:text-text-primary
                       hover:border-text-muted/60 transition-colors flex items-center gap-1.5 flex-shrink-0"
          >
            <span className="text-[9px] uppercase tracking-wider text-text-muted">Match:</span>
            <span className={`font-semibold ${condOp === 'and' ? 'text-blue-400' : 'text-violet-400'}`}>
              {condOp === 'and' ? 'ALL (AND)' : 'ANY (OR)'}
            </span>
          </button>

          {/* Optional label input */}
          <input
            type="text"
            value={group.label}
            onChange={(e) => onChange({ ...group, label: e.target.value })}
            placeholder={`Group ${groupIndex + 1} name (optional)`}
            className="input-xs w-48 text-text-primary placeholder:text-text-muted/50 min-w-0"
          />
        </div>

        <div className="flex items-center gap-2 flex-shrink-0 ml-auto">
          {/* Condition count badge */}
          <span className="text-[10px] font-mono text-text-muted">
            {group.conditions.filter(c => c.enabled !== false).length} cond{group.conditions.filter(c => c.enabled !== false).length !== 1 ? 's' : ''}
          </span>

          {totalGroups > 1 && (
            <button
              type="button"
              onClick={onRemoveGroup}
              className="btn-icon-xs text-red-400 hover:text-red-300 text-xs px-1"
              title="Remove group"
            >
              Remove
            </button>
          )}

          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            title={collapsed ? 'Expand group' : 'Collapse group'}
            className="text-[11px] text-text-muted hover:text-text-primary transition-colors px-1"
          >
            {collapsed ? '▶' : '▼'}
          </button>
        </div>
      </div>

      {/* ── Conditions (indented child area) ──────────────────────── */}
      {!collapsed && (
        <div className="mt-2.5 pt-2.5 border-t border-surface-border/50 pl-3.5 ml-2.5 sm:ml-3 border-l-2 border-surface-border/60 space-y-2">
          {group.conditions.length === 0 && (
            <p className="text-xs text-text-muted italic py-1">No conditions in this group — click below to add one.</p>
          )}

          {group.conditions.map((condition, i) => (
            <div key={condition.id} className="relative">
              {i > 0 && (
                <div className="flex items-center gap-2 py-1 -ml-3.5 pl-3.5">
                  <div className="w-2.5 h-px bg-surface-border" />
                  <span className={`text-[9px] font-mono font-bold tracking-wider px-1.5 py-0.5 rounded border shadow-xs ${
                    condition.enabled === false
                      ? 'text-text-muted opacity-40 border-surface-border bg-surface'
                      : condOp === 'and'
                        ? 'text-blue-400 bg-blue-500/10 border-blue-500/30'
                        : 'text-violet-400 bg-violet-500/10 border-violet-500/30'
                  }`}>
                    {condOp.toUpperCase()}
                  </span>
                  <div className="h-px flex-1 bg-surface-border/40" />
                </div>
              )}
              <div className="rounded-md border border-surface-border/60 bg-surface-1/60 px-2.5 py-1.5 hover:border-surface-border transition-colors">
                <ConditionRow
                  condition={condition}
                  onChange={(updated) => updateCondition(i, updated)}
                  onRemove={() => removeCondition(i)}
                  isMultiTf={isMultiTf}
                  baseTimeframe={baseTimeframe}
                />
              </div>
            </div>
          ))}

          <div className="pt-1">
            <button
              type="button"
              onClick={addCondition}
              className="btn-xs flex items-center gap-1.5 text-text-secondary hover:text-text-primary"
            >
              <span>+</span> Add condition
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
