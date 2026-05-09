'use client';

/**
 * ActionEditor — configures the trade action and risk parameters.
 *
 * Paper trading only — this never triggers a real order.
 */

import type { StrategyAction, RiskManagement, ActionType } from '@/types/strategy';

interface Props {
  action:   StrategyAction;
  risk:     RiskManagement;
  onChange: (action: StrategyAction, risk: RiskManagement) => void;
}

const ACTION_LABELS: Record<ActionType, string> = {
  enter_long:  'Enter Long (Buy)',
  enter_short: 'Enter Short (Sell)',
};

export function ActionEditor({ action, risk, onChange }: Props) {
  function setAction<K extends keyof StrategyAction>(key: K, value: StrategyAction[K]) {
    onChange({ ...action, [key]: value }, risk);
  }
  function setRisk<K extends keyof RiskManagement>(key: K, value: RiskManagement[K]) {
    onChange(action, { ...risk, [key]: value });
  }

  return (
    <div className="space-y-3">
      {/* ── Trade direction ────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <label className="field-label">Action</label>
        <select
          value={action.type}
          onChange={(e) => setAction('type', e.target.value as ActionType)}
          className="select-sm"
        >
          {(Object.keys(ACTION_LABELS) as ActionType[]).map((t) => (
            <option key={t} value={t}>
              {ACTION_LABELS[t]}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-2 text-sm text-text-muted">
          Position size
          <input
            type="number"
            min={1}
            max={100}
            step={1}
            value={action.positionSizePct}
            onChange={(e) => {
              const v = Math.min(100, Math.max(1, parseInt(e.target.value, 10)));
              setAction('positionSizePct', v);
            }}
            className="input-xs w-16"
          />
          <span>% of capital</span>
        </label>

        <label className="flex items-center gap-2 text-sm text-text-muted">
          Max positions
          <input
            type="number"
            min={1}
            max={50}
            step={1}
            value={action.maxPositions ?? 1}
            onChange={(e) => {
              const v = Math.min(50, Math.max(1, parseInt(e.target.value, 10)));
              setAction('maxPositions', v);
            }}
            className="input-xs w-16"
          />
          <span className="text-text-muted/70">
            {(action.maxPositions ?? 1) === 1
              ? '(classic single-position)'
              : `tip: set size to ${Math.round(100 / (action.maxPositions ?? 1))}% to stay within 100%`}
          </span>
        </label>
      </div>

      {/* ── Risk management ────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 flex-wrap">
        <label className="field-label">Risk</label>

        <label className="flex items-center gap-2 text-sm text-text-muted">
          Stop-loss
          <input
            type="number"
            min={0}
            max={100}
            step={0.1}
            value={risk.stopLossPct}
            onChange={(e) => setRisk('stopLossPct', parseFloat(e.target.value) || 0)}
            className="input-xs w-16"
          />
          <span>% (0 = off)</span>
        </label>

        <label className="flex items-center gap-2 text-sm text-text-muted">
          Take-profit
          <input
            type="number"
            min={0}
            max={1000}
            step={0.1}
            value={risk.takeProfitPct}
            onChange={(e) => setRisk('takeProfitPct', parseFloat(e.target.value) || 0)}
            className="input-xs w-16"
          />
          <span>% (0 = off)</span>
        </label>
      </div>

      <p className="text-xs text-text-muted italic">
        Paper trading only — no real orders will be placed.
      </p>
    </div>
  );
}
