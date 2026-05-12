'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useChartStore } from '@/store/chart';
import { INDICATORS } from '@/lib/indicators';
import { clsx } from 'clsx';

// ─── Param editor ─────────────────────────────────────────────────────────────

interface ParamEditorProps {
  indicatorId: string;
  params: Record<string, number>;
}

/**
 * Auto-generated form driven by Indicator.paramsMeta.
 * Buffers changes locally; commits on blur or Enter to avoid
 * recomputing indicators on every keystroke.
 */
function ParamEditor({ indicatorId, params }: ParamEditorProps) {
  const updateIndicatorParams = useChartStore((s) => s.updateIndicatorParams);
  const indicator = INDICATORS[indicatorId];
  if (!indicator) return null;

  // Local draft — string so inputs are freely editable mid-type
  const [draft, setDraft] = useState<Record<string, string>>(
    () => Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
  );

  // When store params change externally (e.g. reset), sync draft
  useEffect(() => {
    setDraft(Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])));
  }, [params]);

  const commit = useCallback(
    (key: string, raw: string, meta: { min: number; max: number; step: number }) => {
      const parsed = parseFloat(raw);
      if (isNaN(parsed)) return;
      const clamped = Math.min(meta.max, Math.max(meta.min, parsed));
      updateIndicatorParams(indicatorId, { [key]: clamped });
      setDraft((d) => ({ ...d, [key]: String(clamped) }));
    },
    [indicatorId, updateIndicatorParams],
  );

  return (
    <div className="px-3 pb-2 pt-1 border-t border-surface-border bg-surface-1">
      {Object.entries(indicator.paramsMeta).map(([key, meta]) => (
        <div key={key} className="flex items-center justify-between gap-2 py-0.5">
          <label className="text-[10px] text-text-muted font-mono whitespace-nowrap">
            {meta.label}
          </label>
          <input
            type="number"
            min={meta.min}
            max={meta.max}
            step={meta.step}
            value={draft[key] ?? ''}
            onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
            onBlur={(e) => commit(key, e.target.value, meta)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                commit(key, (e.target as HTMLInputElement).value, meta);
                (e.target as HTMLInputElement).blur();
              }
            }}
            className="w-16 bg-surface-3 border border-surface-border rounded px-1.5 py-0.5
                       text-[11px] font-mono text-text-primary text-right
                       focus:outline-none focus:border-accent
                       [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none
                       [&::-webkit-outer-spin-button]:appearance-none"
          />
        </div>
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * Dropdown menu listing all available indicators.
 * Active indicators show:
 *   • colored dot (visibility toggle on row click)
 *   • ⚙ gear icon (opens inline param editor)
 *   • ✕ remove button
 */
export function IndicatorSelector() {
  const [open, setOpen]           = useState(false);
  const [configOpen, setConfigOpen] = useState<string | null>(null);
  const ref                       = useRef<HTMLDivElement>(null);
  const activeIndicators          = useChartStore((s) => s.activeIndicators);
  const addIndicator              = useChartStore((s) => s.addIndicator);
  const toggleIndicator           = useChartStore((s) => s.toggleIndicator);
  const removeIndicator           = useChartStore((s) => s.removeIndicator);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setConfigOpen(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const activeIds = new Set(activeIndicators.map((i) => i.id));
  const visibleCount = activeIndicators.filter((i) => i.visible).length;

  return (
    <div ref={ref} className="relative">
      {/* Trigger button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-surface-2
                   text-text-secondary hover:text-text-primary text-[11px] font-mono
                   border border-surface-border transition-colors"
      >
        <span>Indicators</span>
        {visibleCount > 0 && (
          <span className="bg-accent text-white rounded-full px-1.5 text-[10px]">
            {visibleCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-1 w-56 bg-surface-2 border
                        border-surface-border rounded-lg shadow-xl z-50 overflow-hidden">

          {/* ── Active indicators (with config) ─────────────────────────── */}
          {activeIndicators.length > 0 && (
            <>
              <div className="px-3 py-1.5 text-[10px] text-text-muted uppercase tracking-wider">
                Active
              </div>
              {activeIndicators.map((ai) => {
                const indicator = INDICATORS[ai.id];
                if (!indicator) return null;
                const isConfigOpen = configOpen === ai.id;
                const hasParams = Object.keys(indicator.paramsMeta).length > 0;

                return (
                  <div key={ai.id}>
                    {/* Row */}
                    <div
                      className="flex items-center gap-2 px-3 py-1.5 hover:bg-surface-3
                                 cursor-pointer group"
                      onClick={() => toggleIndicator(ai.id)}
                    >
                      {/* Visibility dot */}
                      <span
                        className={clsx(
                          'w-2 h-2 rounded-full flex-shrink-0 transition-colors',
                          ai.visible ? 'bg-up' : 'bg-surface-3 border border-surface-border',
                        )}
                      />

                      {/* Name */}
                      <span className="text-xs text-text-primary flex-1 truncate">
                        {indicator.name}
                      </span>

                      {/* Bias tag — shown for pattern indicators */}
                      {indicator.bias && (
                        <span
                          className={`text-[9px] font-mono font-medium px-1 py-px rounded flex-shrink-0
                            ${indicator.bias === 'bullish'
                              ? 'bg-up/15 text-up'
                              : 'bg-down/15 text-down'
                            }`}
                        >
                          {indicator.bias === 'bullish' ? '▲ Bull' : '▼ Bear'}
                        </span>
                      )}

                      {/* Param summary (e.g. "14, 10") */}
                      <span className="text-[10px] text-text-muted font-mono">
                        {Object.values(ai.params).join(', ')}
                      </span>

                      {/* Gear icon — only if indicator has configurable params */}
                      {hasParams && (
                        <button
                          title="Configure"
                          className={clsx(
                            'text-[11px] transition-colors',
                            isConfigOpen
                              ? 'text-accent'
                              : 'text-text-muted hover:text-text-primary opacity-0 group-hover:opacity-100',
                          )}
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfigOpen(isConfigOpen ? null : ai.id);
                          }}
                        >
                          ⚙
                        </button>
                      )}

                      {/* Remove button */}
                      <button
                        title="Remove"
                        className="text-[10px] text-text-muted hover:text-down
                                   opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (configOpen === ai.id) setConfigOpen(null);
                          removeIndicator(ai.id);
                        }}
                      >
                        ✕
                      </button>
                    </div>

                    {/* Inline param editor */}
                    {isConfigOpen && (
                      <ParamEditor indicatorId={ai.id} params={ai.params} />
                    )}
                  </div>
                );
              })}

              <div className="border-t border-surface-border my-1" />
            </>
          )}

          {/* ── Available (not yet active) ───────────────────────────────── */}
          <div className="px-3 py-1.5 text-[10px] text-text-muted uppercase tracking-wider">
            Add
          </div>
          {Object.values(INDICATORS)
            .filter((ind) => !activeIds.has(ind.id))
            .map((indicator) => (
              <div
                key={indicator.id}
                className="flex items-center gap-2 px-3 py-2 hover:bg-surface-3
                           cursor-pointer"
                onClick={() => {
                  addIndicator({
                    id:      indicator.id,
                    params:  indicator.defaultParams,
                    visible: true,
                  });
                }}
              >
                <span className="w-2 h-2 rounded-full flex-shrink-0 bg-surface-3" />
                <span className="text-xs text-text-primary flex-1 truncate">{indicator.name}</span>
                {indicator.bias && (
                  <span
                    className={`text-[9px] font-mono font-medium px-1 py-px rounded flex-shrink-0
                      ${indicator.bias === 'bullish'
                        ? 'bg-up/15 text-up'
                        : 'bg-down/15 text-down'
                      }`}
                  >
                    {indicator.bias === 'bullish' ? '▲ Bull' : '▼ Bear'}
                  </span>
                )}
                <span className="text-[10px] text-text-muted">+</span>
              </div>
            ))}

          {Object.values(INDICATORS).every((ind) => activeIds.has(ind.id)) && (
            <div className="px-3 py-2 text-[10px] text-text-muted italic">
              All indicators active
            </div>
          )}
        </div>
      )}
    </div>
  );
}
