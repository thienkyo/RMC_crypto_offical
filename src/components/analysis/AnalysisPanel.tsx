'use client';

/**
 * AnalysisPanel — Phase 3 right-rail component.
 *
 * Renders an "Analyze Chart" button.  On click:
 * 1. Captures the current chart canvas via the injected `getScreenshot` prop.
 * 2. POSTs to /api/ai/chart-analysis.
 * 3. Renders the returned ChartAnalysis JSON in a structured, readable layout.
 *
 * Design goals:
 * - Finance-terminal feel: dense but legible, dark-mode first.
 * - Never presents analysis as financial advice — disclaimer always visible.
 * - Shows a "from cache" badge when returning a cached result.
 */

import { useState, useCallback } from 'react';
import { useChartStore } from '@/store/chart';
import type {
  AnalyzeChartResponse,
  ChartAnalysis,
  TrendDirection,
  Bias,
} from '@/lib/ai/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TREND_COLORS: Record<TrendDirection, string> = {
  bullish:  'text-up   border-up/40   bg-up/10',
  bearish:  'text-down border-down/40 bg-down/10',
  sideways: 'text-text-secondary border-surface-border bg-surface-2',
};

const BIAS_COLORS: Record<Bias, string> = {
  long:    'text-up',
  short:   'text-down',
  neutral: 'text-text-secondary',
};

const STRENGTH_LABELS: Record<string, string> = {
  strong:   '●●●',
  moderate: '●●○',
  weak:     '●○○',
};

const CONF_COLORS: Record<string, string> = {
  high:   'text-up',
  medium: 'text-yellow-400',
  low:    'text-text-muted',
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function TrendBadge({ analysis }: { analysis: ChartAnalysis }) {
  const { direction, strength, summary } = analysis.trend;
  return (
    <div className={`rounded border px-3 py-2 ${TREND_COLORS[direction]}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="font-mono font-bold text-xs uppercase tracking-wider">
          {direction}
        </span>
        <span className="font-mono text-xs opacity-70" title={strength}>
          {STRENGTH_LABELS[strength]}
        </span>
      </div>
      <p className="text-[11px] leading-relaxed opacity-80">{summary}</p>
    </div>
  );
}

function BiasRow({ bias }: { bias: Bias }) {
  return (
    <div className="flex items-center gap-2 px-1">
      <span className="text-[11px] text-text-muted font-mono uppercase tracking-wide">
        Bias
      </span>
      <span className={`font-mono font-bold text-xs uppercase ${BIAS_COLORS[bias]}`}>
        {bias}
      </span>
    </div>
  );
}

function KeyLevels({ levels }: { levels: ChartAnalysis['key_levels'] }) {
  if (levels.length === 0) return null;
  return (
    <div>
      <h4 className="text-[10px] font-mono uppercase tracking-widest text-text-muted mb-1.5">
        Key Levels
      </h4>
      <div className="flex flex-col gap-1">
        {levels.map((lvl, i) => (
          <div
            key={i}
            className="flex items-start gap-2 text-[11px] font-mono"
          >
            <span
              className={`mt-0.5 flex-shrink-0 rounded px-1 text-[10px] font-bold uppercase
                ${lvl.type === 'support'
                  ? 'bg-up/10 text-up'
                  : 'bg-down/10 text-down'}`}
            >
              {lvl.type === 'support' ? 'S' : 'R'}
            </span>
            <span className="text-text-price font-semibold min-w-[72px]">
              {lvl.price.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: lvl.price < 1 ? 6 : 2,
              })}
            </span>
            <span className="text-text-muted leading-relaxed">{lvl.notes}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Patterns({ patterns }: { patterns: ChartAnalysis['patterns'] }) {
  if (patterns.length === 0) return null;
  return (
    <div>
      <h4 className="text-[10px] font-mono uppercase tracking-widest text-text-muted mb-1.5">
        Patterns
      </h4>
      <div className="flex flex-col gap-2">
        {patterns.map((p, i) => (
          <div key={i} className="text-[11px]">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="text-text-primary font-semibold">{p.name}</span>
              <span className={`font-mono text-[10px] ${CONF_COLORS[p.confidence]}`}>
                {p.confidence}
              </span>
            </div>
            <p className="text-text-muted leading-relaxed">{p.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function RiskNotes({ notes }: { notes: string[] }) {
  if (notes.length === 0) return null;
  return (
    <div>
      <h4 className="text-[10px] font-mono uppercase tracking-widest text-text-muted mb-1.5">
        Risk Notes
      </h4>
      <ul className="flex flex-col gap-1">
        {notes.map((note, i) => (
          <li key={i} className="flex items-start gap-1.5 text-[11px] text-text-secondary">
            <span className="mt-0.5 text-yellow-500 flex-shrink-0">▲</span>
            {note}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  /** Returns a base64 PNG of the current chart, or null if not ready. */
  getScreenshot: () => string | null;
}

export function AnalysisPanel({ getScreenshot }: Props) {
  const { symbol, timeframe, candles } = useChartStore();

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result,      setResult]      = useState<AnalyzeChartResponse | null>(null);
  const [error,       setError]       = useState<string | null>(null);

  const handleAnalyze = useCallback(async () => {
    setIsAnalyzing(true);
    setError(null);

    const imageBase64 = getScreenshot();
    if (!imageBase64) {
      setError('Chart not ready — try again in a moment.');
      setIsAnalyzing(false);
      return;
    }

    const lastCandleTime = candles[candles.length - 1]?.openTime ?? Date.now();

    try {
      const res = await fetch('/api/ai/chart-analysis', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ imageBase64, symbol, timeframe, lastCandleTime }),
      });

      const data = await res.json() as AnalyzeChartResponse & { error?: string };

      if (!res.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed.');
    } finally {
      setIsAnalyzing(false);
    }
  }, [getScreenshot, symbol, timeframe, candles]);

  // ── Context line (shown above button) ──────────────────────────────────────
  const contextLabel = `${symbol} · ${timeframe.toUpperCase()}`;

  return (
    <div className="flex flex-col h-full bg-surface border-l border-surface-border overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between px-3 h-12 border-b border-surface-border flex-shrink-0">
        <span className="text-[11px] font-mono uppercase tracking-widest text-text-muted">
          AI Analysis
        </span>
        {result && (
          <span
            className={`text-[10px] font-mono px-1.5 py-0.5 rounded border
              ${result.fromCache
                ? 'text-text-muted border-surface-border bg-surface-2'
                : 'text-accent border-accent/30 bg-accent/5'}`}
            title={result.fromCache && result.cachedAt
              ? `Cached at ${new Date(result.cachedAt).toLocaleTimeString()}`
              : `Fresh · ${result.model}`}
          >
            {result.fromCache ? 'cached' : 'fresh'}
          </span>
        )}
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-4">

        {/* Analyze button */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-mono text-text-muted">{contextLabel}</span>
          <button
            onClick={handleAnalyze}
            disabled={isAnalyzing}
            className="w-full py-2 rounded border font-mono text-xs font-semibold
                       transition-colors
                       bg-accent/10 border-accent/40 text-accent
                       hover:bg-accent/20 hover:border-accent/60
                       disabled:opacity-40 disabled:cursor-not-allowed
                       active:scale-[0.98]"
          >
            {isAnalyzing ? (
              <span className="flex items-center justify-center gap-2">
                <span className="inline-block w-3 h-3 border-2 border-accent/40 border-t-accent rounded-full animate-spin" />
                Analyzing…
              </span>
            ) : (
              result ? '↺ Re-analyze' : '✦ Analyze Chart'
            )}
          </button>
        </div>

        {/* Error state */}
        {error && (
          <div className="rounded border border-down/30 bg-down/5 px-3 py-2 text-[11px] text-down">
            {error}
          </div>
        )}

        {/* Results */}
        {result && !isAnalyzing && (
          <>
            <TrendBadge analysis={result.analysis} />
            <BiasRow    bias={result.analysis.bias} />
            <div className="h-px bg-surface-border" />
            <KeyLevels  levels={result.analysis.key_levels} />
            <Patterns   patterns={result.analysis.patterns} />
            <RiskNotes  notes={result.analysis.risk_notes} />
            <div className="h-px bg-surface-border" />
            {/* Disclaimer — always visible, never removable */}
            <p className="text-[10px] text-text-muted leading-relaxed">
              {result.analysis.disclaimer}
            </p>
          </>
        )}

        {/* Empty state */}
        {!result && !isAnalyzing && !error && (
          <p className="text-[11px] text-text-muted text-center pt-4 leading-relaxed">
            Click "Analyze Chart" to get an AI read on the current candles, key levels, and patterns.
          </p>
        )}

      </div>
    </div>
  );
}
