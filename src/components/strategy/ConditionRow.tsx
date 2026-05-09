'use client';

/**
 * ConditionRow — a single "IF [indicator] [operator] [value]" row.
 *
 * Series options per indicator (0-based index = seriesIndex):
 *   ema/sma  → [0] Line
 *   rsi      → [0] RSI, [1] EMA of RSI
 *   macd     → [0] MACD Line, [1] Signal, [2] Histogram
 *   bollinger → [0] Middle Band, [1] Upper Band, [2] Lower Band
 */

import { useState, useEffect } from 'react';
import { INDICATORS } from '@/lib/indicators';
import type { StrategyCondition, ConditionOperator } from '@/types/strategy';

// ── Metadata ──────────────────────────────────────────────────────────────────

const OPERATOR_LABELS: Record<ConditionOperator, string> = {
  gt:            '>',
  lt:            '<',
  gte:           '≥',
  lte:           '≤',
  crosses_above: 'crosses above',
  crosses_below: 'crosses below',
};

const SERIES_LABELS: Record<string, string[]> = {
  ema:       ['EMA Line'],
  sma:       ['SMA Line'],
  rsi:       ['RSI', 'EMA of RSI'],
  macd:      ['MACD Line', 'Signal', 'Histogram'],
  bollinger: ['Middle Band', 'Upper Band', 'Lower Band'],
};

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  condition: StrategyCondition;
  onChange:  (updated: StrategyCondition) => void;
  onRemove:  () => void;
}

export function ConditionRow({ condition, onChange, onRemove }: Props) {
  const indicatorIds = Object.keys(INDICATORS);
  const seriesOptions = SERIES_LABELS[condition.indicatorId] ?? ['Series 0'];
  const selectedIndicator = INDICATORS[condition.indicatorId];
  const paramEntries = selectedIndicator
    ? Object.entries(selectedIndicator.defaultParams)
    : [];

  // ── Local string state for the threshold value input ───────────────────────
  // Keeping it as a string avoids React clobbering mid-entry decimals like "0."
  // (a controlled <input type="number" value={0} /> renders "0", losing the dot).
  const [valueInput, setValueInput] = useState(String(condition.value));

  // Re-sync display when a different condition is loaded or the indicator changes
  // (which resets the threshold to a new default).  We deliberately do NOT sync
  // on every condition.value change so that typing "0.0" doesn't get clobbered
  // by the parent echoing back 0.
  useEffect(() => {
    setValueInput(String(condition.value));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [condition.id, condition.indicatorId]);

  function set<K extends keyof StrategyCondition>(key: K, value: StrategyCondition[K]) {
    onChange({ ...condition, [key]: value });
  }

  function handleIndicatorChange(newId: string) {
    const indicator = INDICATORS[newId];
    onChange({
      ...condition,
      indicatorId:  newId,
      params:       indicator ? { ...indicator.defaultParams } : {},
      seriesIndex:  0,
    });
  }

  function handleParamChange(key: string, raw: string) {
    const num = parseFloat(raw);
    if (!Number.isNaN(num)) {
      set('params', { ...condition.params, [key]: num });
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 py-1.5">
      {/* ── Indicator selector ─────────────────────────────────────────── */}
      <select
        value={condition.indicatorId}
        onChange={(e) => handleIndicatorChange(e.target.value)}
        className="select-sm"
      >
        {indicatorIds.map((id) => (
          <option key={id} value={id}>
            {INDICATORS[id]?.name ?? id}
          </option>
        ))}
      </select>

      {/* ── Indicator params (inline, compact) ────────────────────────── */}
      {paramEntries.map(([key]) => (
        <label key={key} className="flex items-center gap-1 text-xs text-text-muted">
          <span>{selectedIndicator?.paramsMeta[key]?.label ?? key}</span>
          <input
            type="number"
            value={condition.params[key] ?? 0}
            min={selectedIndicator?.paramsMeta[key]?.min ?? 0}
            max={selectedIndicator?.paramsMeta[key]?.max ?? 9999}
            step={selectedIndicator?.paramsMeta[key]?.step ?? 1}
            onChange={(e) => handleParamChange(key, e.target.value)}
            className="input-xs w-16"
          />
        </label>
      ))}

      {/* ── Series selector (only shown for multi-series indicators) ──── */}
      {seriesOptions.length > 1 && (
        <select
          value={condition.seriesIndex}
          onChange={(e) => set('seriesIndex', Number(e.target.value))}
          className="select-sm"
        >
          {seriesOptions.map((label, idx) => (
            <option key={idx} value={idx}>
              {label}
            </option>
          ))}
        </select>
      )}

      {/* ── Operator ──────────────────────────────────────────────────── */}
      <select
        value={condition.operator}
        onChange={(e) => set('operator', e.target.value as ConditionOperator)}
        className="select-sm"
      >
        {(Object.keys(OPERATOR_LABELS) as ConditionOperator[]).map((op) => (
          <option key={op} value={op}>
            {OPERATOR_LABELS[op]}
          </option>
        ))}
      </select>

      {/* ── Threshold value ───────────────────────────────────────────── */}
      <input
        type="number"
        value={valueInput}
        step="any"
        onChange={(e) => {
          setValueInput(e.target.value);           // always update display
          const num = parseFloat(e.target.value);
          if (!Number.isNaN(num)) set('value', num); // commit when parseable
        }}
        onBlur={() => {
          // Normalise display on blur (e.g. "0." → "0", trailing zeros dropped)
          const num = parseFloat(valueInput);
          setValueInput(Number.isNaN(num) ? String(condition.value) : String(num));
        }}
        className="input-xs w-24"
        placeholder="value"
      />

      {/* ── Alert check mode ──────────────────────────────────────────── */}
      <span className="text-xs text-text-muted opacity-50 select-none">|</span>
      <select
        value={condition.checkMode ?? 'confirmation'}
        onChange={(e) => set('checkMode', e.target.value as 'confirmation' | 'lookback')}
        className="select-sm text-text-muted"
        title="Alert check mode for this condition"
      >
        <option value="confirmation">Confirm</option>
        <option value="lookback">Lookback</option>
      </select>
      <input
        type="number"
        min={1}
        max={50}
        value={condition.checkCandles ?? 1}
        onChange={(e) => {
          const v = Math.max(1, Math.min(50, parseInt(e.target.value, 10) || 1));
          set('checkCandles', v);
        }}
        className="input-xs w-12 font-mono text-center"
        title={
          (condition.checkMode ?? 'confirmation') === 'confirmation'
            ? 'Consecutive candles that must ALL match before alert fires'
            : 'Scan last N candles — fire if ANY matched'
        }
      />
      <span className="text-xs text-text-muted">
        {(condition.checkMode ?? 'confirmation') === 'confirmation' ? 'c' : 'l'}
      </span>

      {/* ── Remove button ─────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={onRemove}
        className="btn-icon-xs text-red-400 hover:text-red-300"
        title="Remove condition"
      >
        ✕
      </button>
    </div>
  );
}
