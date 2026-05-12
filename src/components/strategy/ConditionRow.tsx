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

import { useState, useEffect, useRef } from 'react';
import { clsx } from 'clsx';
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
  macd:      ['MACD Line', 'Signal', 'Histogram', 'Strategy Signal'],
  bollinger: ['Middle Band', 'Upper Band', 'Lower Band'],
};

// ── Enable / disable toggle ───────────────────────────────────────────────────

function EnableToggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={enabled ? 'Disable condition (config preserved)' : 'Enable condition'}
      className={`flex-shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded border
        font-mono text-[10px] font-semibold transition-all select-none
        ${enabled
          ? 'bg-up/10 border-up/30 text-up hover:bg-up/20'
          : 'bg-surface-2 border-surface-border text-text-muted hover:border-accent/40 hover:text-text-primary'
        }`}
    >
      <span className="text-[8px]">{enabled ? '●' : '○'}</span>
      <span>{enabled ? 'ON' : 'OFF'}</span>
    </button>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  condition: StrategyCondition;
  onChange:  (updated: StrategyCondition) => void;
  onRemove:  () => void;
}

export function ConditionRow({ condition, onChange, onRemove }: Props) {
  const allIds = Object.keys(INDICATORS);
  // Patterns are indicators with a bias field; plain indicators have no bias.
  const patternIds    = allIds.filter((id) => INDICATORS[id]?.bias !== undefined);
  const indicatorIds  = allIds.filter((id) => INDICATORS[id]?.bias === undefined);
  
  const seriesOptions = SERIES_LABELS[condition.indicatorId] ?? ['Signal'];
  const selectedIndicator = INDICATORS[condition.indicatorId];
  const isPattern = selectedIndicator?.bias !== undefined;
  const paramEntries = selectedIndicator
    ? Object.entries(selectedIndicator.defaultParams)
    : [];

  // ── Local string state for the threshold value input ───────────────────────
  // Keeping it as a string avoids React clobbering mid-entry decimals like "0."
  // (a controlled <input type="number" value={0} /> renders "0", losing the dot).
  const [valueInput, setValueInput] = useState(String(condition.value));
  
  // ── Dropdown state ────────────────────────────────────────────────────────────
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // ── Help tooltip state ────────────────────────────────────────────────────────
  const [showHelp, setShowHelp] = useState(false);
  const helpContainerRef = useRef<HTMLDivElement>(null);

  const [showCheckModeHelp, setShowCheckModeHelp] = useState(false);
  const checkModeHelpRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (helpContainerRef.current && !helpContainerRef.current.contains(event.target as Node)) {
        setShowHelp(false);
      }
      if (checkModeHelpRef.current && !checkModeHelpRef.current.contains(event.target as Node)) {
        setShowCheckModeHelp(false);
      }
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

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
    const isPattern = indicator?.bias !== undefined;
    onChange({
      ...condition,
      indicatorId:  newId,
      params:       indicator ? { ...indicator.defaultParams } : {},
      seriesIndex:  0,
      // Patterns always evaluate `> 0` — lock it in so the engine is always correct.
      ...(isPattern ? { operator: 'gt' as const, value: 0 } : {}),
    });
  }

  function handleParamChange(key: string, raw: string) {
    const num = parseFloat(raw);
    if (!Number.isNaN(num)) {
      set('params', { ...condition.params, [key]: num });
    }
  }

  const isEnabled = condition.enabled !== false;

  return (
    <div className={`flex flex-wrap items-center gap-2 py-1.5 transition-opacity ${isEnabled ? '' : 'opacity-40'}`}>
      {/* ── Enable / disable toggle ────────────────────────────────────── */}
      <EnableToggle
        enabled={isEnabled}
        onToggle={() => set('enabled', !isEnabled)}
      />
      {/* ── Indicator selector ─────────────────────────────────────────── */}
      <div className="relative flex items-center gap-1" ref={helpContainerRef}>
        <div className="relative" ref={dropdownRef}>
          <div
            className="select-sm flex items-center justify-between cursor-pointer min-w-[180px]"
            onClick={() => { setDropdownOpen(!dropdownOpen); setSearchQuery(''); }}
          >
            <span className="truncate pr-2">{selectedIndicator?.name ?? condition.indicatorId}</span>
            {selectedIndicator?.bias && (
              <span
                className={`text-[9px] font-mono font-medium px-1 py-px rounded flex-shrink-0 mr-1
                  ${selectedIndicator.bias === 'bullish' ? 'bg-up/15 text-up' : 'bg-down/15 text-down'}`}
              >
                {selectedIndicator.bias === 'bullish' ? '▲' : '▼'}
              </span>
            )}
            <span className="text-[10px] opacity-60">▼</span>
          </div>

          {dropdownOpen && (
            <div className="absolute top-full left-0 mt-1 w-64 bg-[#0a0e1a] border border-surface-border rounded-md shadow-[0_0_20px_rgba(0,0,0,1)] z-[100] flex flex-col max-h-[350px]">
              <div className="p-2 border-b border-surface-border">
                <input
                  type="text"
                  placeholder="Search indicators..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-surface-3 border border-surface-border rounded px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent"
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
              <div className="overflow-y-auto p-1">
                {(() => {
                  const query = searchQuery.toLowerCase();
                  const filteredIndicators = indicatorIds.filter(id => (INDICATORS[id]?.name ?? id).toLowerCase().includes(query));
                  const filteredPatterns = patternIds.filter(id => (INDICATORS[id]?.name ?? id).toLowerCase().includes(query));

                  if (filteredIndicators.length === 0 && filteredPatterns.length === 0) {
                    return <div className="p-3 text-center text-xs text-text-muted">No results found</div>;
                  }

                  return (
                    <>
                      {filteredIndicators.length > 0 && (
                        <div className="mb-2">
                          <div className="px-2 py-1 text-[10px] text-text-muted uppercase tracking-wider font-semibold">Indicators</div>
                          {filteredIndicators.map(id => (
                            <div
                              key={id}
                              className={clsx(
                                "px-2 py-1.5 text-xs rounded cursor-pointer truncate transition-colors",
                                condition.indicatorId === id ? "bg-accent/20 text-accent font-medium" : "text-text-primary hover:bg-surface-3"
                              )}
                              onClick={() => { handleIndicatorChange(id); setDropdownOpen(false); }}
                            >
                              {INDICATORS[id]?.name ?? id}
                            </div>
                          ))}
                        </div>
                      )}
                      {filteredPatterns.length > 0 && (
                        <div>
                          <div className="px-2 py-1 text-[10px] text-text-muted uppercase tracking-wider font-semibold">Candlestick Patterns</div>
                          {filteredPatterns.map(id => {
                            const ind = INDICATORS[id];
                            return (
                              <div
                                key={id}
                                className={clsx(
                                  "px-2 py-1.5 text-xs rounded cursor-pointer transition-colors flex items-center gap-1.5",
                                  condition.indicatorId === id ? "bg-accent/20 text-accent font-medium" : "text-text-primary hover:bg-surface-3"
                                )}
                                onClick={() => { handleIndicatorChange(id); setDropdownOpen(false); }}
                              >
                                <span className="flex-1 truncate">{ind?.name ?? id}</span>
                                {ind?.bias && (
                                  <span
                                    className={`text-[9px] font-mono font-medium px-1 py-px rounded flex-shrink-0
                                      ${ind.bias === 'bullish' ? 'bg-up/15 text-up' : 'bg-down/15 text-down'}`}
                                  >
                                    {ind.bias === 'bullish' ? '▲ Bull' : '▼ Bear'}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowHelp((prev) => !prev)}
          className="text-text-muted hover:text-text-primary flex items-center justify-center w-5 h-5 rounded-full bg-surface-2 hover:bg-surface-3 border border-surface-border transition-colors text-xs font-bold"
          title="How to use this condition"
        >
          ?
        </button>
        {showHelp && selectedIndicator?.description && (
          <div className="absolute z-[100] top-full left-0 mt-2 w-72 p-3 bg-[#0a0e1a] border border-surface-border rounded-md shadow-[0_0_20px_rgba(0,0,0,1)] text-xs text-text-primary leading-relaxed" style={{ backgroundColor: '#0a0e1a' }}>
            <div className="font-semibold mb-1 border-b border-surface-border pb-1 text-blue-400">{selectedIndicator.name} Guide</div>
            <div className="whitespace-pre-wrap">{selectedIndicator.description}</div>
          </div>
        )}
      </div>

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

      {/* ── Operator + Threshold — hidden for patterns (always gt/0) ─── */}
      {isPattern ? (
        <span className="text-xs font-mono text-text-muted bg-surface-2 border border-surface-border rounded px-2 py-0.5 select-none">
          detected
        </span>
      ) : (
        <>
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

          <input
            type="number"
            value={valueInput}
            step="any"
            onChange={(e) => {
              setValueInput(e.target.value);
              const num = parseFloat(e.target.value);
              if (!Number.isNaN(num)) set('value', num);
            }}
            onBlur={() => {
              const num = parseFloat(valueInput);
              setValueInput(Number.isNaN(num) ? String(condition.value) : String(num));
            }}
            className="input-xs w-24"
            placeholder="value"
          />
        </>
      )}

      {/* ── Alert check mode ──────────────────────────────────────────── */}
      <span className="text-xs text-text-muted opacity-50 select-none">|</span>
      <div className="relative flex items-center gap-1" ref={checkModeHelpRef}>
        <select
          value={condition.checkMode ?? 'confirmation'}
          onChange={(e) => set('checkMode', e.target.value as 'confirmation' | 'lookback')}
          className="select-sm text-text-muted"
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
        />
        <span className="text-xs text-text-muted pr-1">
          {(condition.checkMode ?? 'confirmation') === 'confirmation' ? 'c' : 'l'}
        </span>
        <button
          type="button"
          onClick={() => setShowCheckModeHelp((prev) => !prev)}
          className="text-text-muted hover:text-text-primary flex items-center justify-center w-5 h-5 rounded-full bg-surface-2 hover:bg-surface-3 border border-surface-border transition-colors text-xs font-bold"
          title="What are check modes?"
        >
          ?
        </button>
        {showCheckModeHelp && (
          <div className="absolute z-[100] bottom-full right-0 mb-2 w-72 p-3 bg-[#0a0e1a] border border-surface-border rounded-md shadow-[0_0_20px_rgba(0,0,0,1)] text-xs text-text-primary leading-relaxed" style={{ backgroundColor: '#0a0e1a' }}>
            <div className="font-semibold mb-2 border-b border-surface-border pb-1 text-blue-400">Check Modes</div>
            <div className="space-y-2">
              <p><span className="text-emerald-400 font-semibold">Confirm (c):</span> Condition must be true for <strong>N consecutive candles</strong> before firing. (Best to filter false breakouts)</p>
              <p><span className="text-emerald-400 font-semibold">Lookback (l):</span> Condition must have been true <strong>at least once</strong> within the last N candles. (Best for catching signals that happened slightly before another)</p>
            </div>
          </div>
        )}
      </div>

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
