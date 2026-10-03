'use client';

/**
 * AnalysisPanel — Unified AI Copilot (Decision Evaluator & Chart Vision).
 *
 * Merges visual canvas screenshot analysis with quantitative technical indicators
 * (37+ indicators, RSI divergence, MACD, Volume Profile POC) and multi-channel
 * sentiment (Telegram, Google News, YouTube, X, Tech News) into a single,
 * cohesive trading decision workflow.
 *
 * Gatekeeper Verdicts: PASS 🟢 | CAVEAT 🟡 | REJECT 🔴
 *
 * Auto-Restore & History Behavior:
 * - Shows latest result automatically if it is within 3 days (72 hours).
 * - If older than 3 days, displays clean setup form by default.
 * - Clicking "📜 History" displays all historical evaluations for instant reference.
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useChartStore } from '@/store/chart';
import type {
  AnalyzeChartResponse,
  ChartAnalysis,
  TrendDirection,
  Bias,
  TradeSetupRecommendation,
} from '@/lib/ai/types';
import type {
  OrderEvaluationResult,
  EvaluatorProvider,
  EvaluationStatus,
} from '@/lib/ai/evaluator/types';
import type { AiHistoryItem } from '@/app/api/ai/history/route';

// ─── Theme & Styling Config ──────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  EvaluationStatus,
  { label: string; bg: string; text: string; border: string; icon: string }
> = {
  PASS: {
    label: 'PASS — HIGH CONFLUENCE',
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-400',
    border: 'border-emerald-500/30',
    icon: '✓',
  },
  CAVEAT: {
    label: 'CAVEAT — PROCEED WITH CAUTION',
    bg: 'bg-amber-500/10',
    text: 'text-amber-400',
    border: 'border-amber-500/30',
    icon: '⚠️',
  },
  REJECT: {
    label: 'REJECT — UNFAVORABLE SETUP',
    bg: 'bg-rose-500/10',
    text: 'text-rose-400',
    border: 'border-rose-500/30',
    icon: '✕',
  },
};

const TREND_COLORS: Record<TrendDirection, string> = {
  bullish:  'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
  bearish:  'text-rose-400 border-rose-500/30 bg-rose-500/10',
  sideways: 'text-text-secondary border-surface-border bg-surface-2',
};

const BIAS_COLORS: Record<Bias, string> = {
  long:    'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  short:   'text-rose-400 bg-rose-500/10 border-rose-500/30',
  neutral: 'text-text-secondary bg-surface-2 border-surface-border',
};

const STRENGTH_LABELS: Record<string, string> = {
  strong:   '●●● High',
  moderate: '●●○ Moderate',
  weak:     '●○○ Weak',
};

const CONF_COLORS: Record<string, string> = {
  high:   'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  medium: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
  low:    'text-text-muted bg-surface-2 border-surface-border',
};

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

function formatTimeAgo(dateString: string): string {
  const diffSec = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
  if (diffSec < 60) return `${Math.max(1, diffSec)}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}d ago`;
}

function isWithin3Days(dateString: string): boolean {
  return Date.now() - new Date(dateString).getTime() <= THREE_DAYS_MS;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function VisualTrendCard({ analysis }: { analysis: ChartAnalysis }) {
  const { direction, strength, summary } = analysis.trend;
  return (
    <div className="p-2.5 rounded-lg border border-surface-border bg-surface flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono uppercase font-bold text-text-muted tracking-wider">
          📈 Visual Chart Trend & Bias
        </span>
        <div className="flex items-center gap-1.5">
          <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase border ${BIAS_COLORS[analysis.bias]}`}>
            Bias: {analysis.bias}
          </span>
          <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase border ${TREND_COLORS[direction]}`}>
            {direction} ({STRENGTH_LABELS[strength] ?? strength})
          </span>
        </div>
      </div>
      <p className="text-[11px] text-text-secondary leading-relaxed">
        {summary}
      </p>
    </div>
  );
}

function KeyLevelsTable({ levels }: { levels: ChartAnalysis['key_levels'] }) {
  if (!levels || levels.length === 0) return null;
  return (
    <div className="p-2.5 rounded-lg border border-surface-border bg-surface flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono uppercase font-bold text-text-muted tracking-wider">
          🎯 Key Support & Resistance (Vision)
        </span>
        <span className="text-[9px] font-mono text-text-muted">
          {levels.length} levels detected
        </span>
      </div>
      <div className="flex flex-col gap-1 pt-1">
        {levels.map((lvl, i) => (
          <div
            key={i}
            className="flex items-start gap-2 text-[11px] font-mono py-1 px-1.5 rounded bg-surface-2/60 border border-surface-border/40"
          >
            <span
              className={`flex-shrink-0 rounded px-1.5 py-0.2 text-[9px] font-bold uppercase ${
                lvl.type === 'support'
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
              }`}
            >
              {lvl.type === 'support' ? 'SUP' : 'RES'}
            </span>
            <span className="text-text-price font-bold min-w-[70px]">
              ${lvl.price.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: lvl.price < 1 ? 6 : 2,
              })}
            </span>
            <span className="text-text-muted text-[10px] leading-tight flex-1">
              {lvl.notes}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DetectedPatterns({ patterns }: { patterns: ChartAnalysis['patterns'] }) {
  if (!patterns || patterns.length === 0) return null;
  return (
    <div className="p-2.5 rounded-lg border border-surface-border bg-surface flex flex-col gap-1.5">
      <span className="text-[10px] font-mono uppercase font-bold text-text-muted tracking-wider">
        🕯️ Chart & Candlestick Patterns
      </span>
      <div className="flex flex-col gap-1.5 pt-0.5">
        {patterns.map((p, i) => (
          <div key={i} className="text-[11px] p-2 rounded bg-surface-2/60 border border-surface-border/40">
            <div className="flex items-center justify-between mb-1">
              <span className="text-text-primary font-semibold font-mono text-[11px]">{p.name}</span>
              <span className={`font-mono text-[9px] px-1.5 py-0.2 rounded border uppercase font-bold ${CONF_COLORS[p.confidence]}`}>
                {p.confidence} Conf
              </span>
            </div>
            <p className="text-text-muted text-[10px] leading-relaxed">{p.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function AiTradePlanCard({
  plan,
  onApply,
}: {
  plan: TradeSetupRecommendation;
  onApply: () => void;
}) {
  const isLong = plan.action === 'long';
  const isShort = plan.action === 'short';

  const badgeColor = isLong
    ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
    : isShort
    ? 'bg-rose-500/20 text-rose-400 border-rose-500/40'
    : 'bg-amber-500/20 text-amber-400 border-amber-500/40';

  return (
    <div className="bg-surface p-3 rounded-lg border border-accent/30 shadow-sm flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-sm">🎯</span>
          <span className="text-[10px] font-mono uppercase font-bold text-text-primary tracking-wider">
            AI Structural Trade Plan
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase border ${badgeColor}`}>
            {isLong ? '🟢 LONG' : isShort ? '🔴 SHORT' : '⚪ WAIT'}
          </span>
          <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold bg-accent/15 text-accent border border-accent/30">
            R:R {plan.risk_reward_ratio}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="bg-surface-2/70 p-2 rounded border border-surface-border">
          <div className="text-[9px] font-mono text-text-muted uppercase">Suggested Entry</div>
          <div className="text-xs font-mono font-bold text-text-primary mt-0.5">
            ${plan.entry_price?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[9px] font-mono text-accent capitalize">{plan.entry_type}</div>
        </div>

        <div className="bg-surface-2/70 p-2 rounded border border-surface-border">
          <div className="text-[9px] font-mono text-text-muted uppercase">Stop Loss</div>
          <div className="text-xs font-mono font-bold text-rose-400 mt-0.5">
            ${plan.stop_loss?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[9px] font-mono text-rose-400/80">-{plan.stop_loss_pct?.toFixed(1)}%</div>
        </div>

        <div className="bg-surface-2/70 p-2 rounded border border-surface-border">
          <div className="text-[9px] font-mono text-text-muted uppercase">Take Profit</div>
          <div className="text-xs font-mono font-bold text-emerald-400 mt-0.5">
            ${plan.take_profit?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[9px] font-mono text-emerald-400/80">+{plan.take_profit_pct?.toFixed(1)}%</div>
        </div>
      </div>

      {(plan.entry_rationale || plan.stop_loss_rationale || plan.take_profit_rationale) && (
        <div className="text-[10px] font-mono space-y-1 bg-surface-2/50 p-2 rounded border border-surface-border/50 text-text-secondary leading-relaxed">
          {plan.entry_rationale && (
            <div>
              <span className="text-text-muted uppercase font-semibold">Entry:</span> {plan.entry_rationale}
            </div>
          )}
          {plan.stop_loss_rationale && (
            <div>
              <span className="text-rose-400/90 uppercase font-semibold">Invalidation (SL):</span> {plan.stop_loss_rationale}
            </div>
          )}
          {plan.take_profit_rationale && (
            <div>
              <span className="text-emerald-400/90 uppercase font-semibold">Target (TP):</span> {plan.take_profit_rationale}
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={onApply}
        className="w-full py-1.5 px-2 rounded border border-accent/40 bg-accent/10 hover:bg-accent/20 text-accent font-mono text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-colors"
      >
        <span>✏️</span>
        <span>Apply this Plan to Manual Setup to Edit/Tweak</span>
      </button>
    </div>
  );
}

// ─── Main Unified Component ──────────────────────────────────────────────────

interface Props {
  /** Returns a base64 PNG of the current chart canvas, or null if not ready. */
  getScreenshot: () => string | null;
}

export function AnalysisPanel({ getScreenshot }: Props) {
  const symbol = useChartStore((s) => s.symbol);
  const timeframe = useChartStore((s) => s.timeframe);
  const candles = useChartStore((s) => s.candles);

  const latestCandle = candles[candles.length - 1];
  const currentPrice = latestCandle?.close ?? 0;

  // Form states
  const [setupMode, setSetupMode] = useState<'auto' | 'manual'>('auto');
  const [direction, setDirection] = useState<'long' | 'short'>('long');
  const [provider, setProvider] = useState<EvaluatorProvider>('gemini');
  const [entryPrice, setEntryPrice] = useState<string>('');
  const [stopLossPct, setStopLossPct] = useState<string>('3.0');
  const [takeProfitPct, setTakeProfitPct] = useState<string>('6.0');
  const [customNotes, setCustomNotes] = useState<string>('');
  const [isSetupOpen, setIsSetupOpen] = useState(true);

  // Result states
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [evalResult, setEvalResult] = useState<OrderEvaluationResult | null>(null);
  const [visionResult, setVisionResult] = useState<AnalyzeChartResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [partialWarning, setPartialWarning] = useState<string | null>(null);

  // History states
  const [historyList, setHistoryList] = useState<AiHistoryItem[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [activeHistoryItem, setActiveHistoryItem] = useState<AiHistoryItem | null>(null);
  const [historyScope, setHistoryScope] = useState<'current' | 'all'>('current');

  // Telegram dispatch state
  const [isSendingTelegram, setIsSendingTelegram] = useState(false);
  const [telegramStatus, setTelegramStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [telegramError, setTelegramError] = useState<string | null>(null);
  const [telegramDestination, setTelegramDestination] = useState<'topic' | 'general'>('topic');
  const [customTopicName, setCustomTopicName] = useState<string>('');

  const activeEntryPrice = entryPrice ? parseFloat(entryPrice) : currentPrice;

  // Live Risk:Reward ratio calculation
  const rrRatio = useMemo(() => {
    const sl = parseFloat(stopLossPct);
    const tp = parseFloat(takeProfitPct);
    if (!sl || !tp || isNaN(sl) || isNaN(tp) || sl <= 0) return null;
    return (tp / sl).toFixed(2);
  }, [stopLossPct, takeProfitPct]);

  // ── Fetch Evaluation History ───────────────────────────────────────────────
  const fetchHistory = useCallback(async (scope: 'current' | 'all' = historyScope) => {
    setIsLoadingHistory(true);
    setHistoryError(null);
    try {
      const url = scope === 'current'
        ? `/api/ai/history?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&limit=30`
        : `/api/ai/history?limit=30`;

      const res = await fetch(url);
      if (!res.ok) {
        setHistoryError('Database unreachable — check if Docker / PostgreSQL is running.');
        return;
      }

      const data = await res.json();
      if (data.success && Array.isArray(data.history)) {
        setHistoryList(data.history);

        // Auto-restore logic:
        // If viewing current symbol and history has an item created <= 3 days ago, show it!
        // If older than 3 days, do not auto-show.
        if (scope === 'current' && data.history.length > 0) {
          const latest = data.history[0] as AiHistoryItem;
          if (isWithin3Days(latest.createdAt)) {
            setActiveHistoryItem(latest);
            setEvalResult(latest.evaluation);
            if (latest.vision?.analysis) {
              setVisionResult({
                analysis: latest.vision.analysis,
                fromCache: true,
                model: latest.vision.model,
              });
            }
          }
        }
      }
    } catch (err) {
      console.error('[AnalysisPanel] Failed to fetch history:', err);
    } finally {
      setIsLoadingHistory(false);
    }
  }, [symbol, timeframe, historyScope]);

  // Load history on mount or when symbol / timeframe change
  useEffect(() => {
    // Reset active historical view when changing symbol
    setActiveHistoryItem(null);
    setEvalResult(null);
    setVisionResult(null);
    setError(null);
    setPartialWarning(null);
    fetchHistory('current');
  }, [symbol, timeframe, fetchHistory]);

  // Unified Analysis Execution (Auto-Plan vs Manual)
  const handleAnalyze = useCallback(async () => {
    if (!latestCandle) {
      setError('Market candles are still loading.');
      return;
    }

    setIsAnalyzing(true);
    setError(null);
    setPartialWarning(null);
    setTelegramStatus('idle');
    setTelegramError(null);
    setActiveHistoryItem(null); // Clear historical label for a live run

    const imageBase64 = getScreenshot();

    try {
      let hadSuccess = false;
      const errors: string[] = [];

      let activeDirection: 'long' | 'short' = direction;
      let activeEntry: number = activeEntryPrice;
      let activeSl: number | undefined = stopLossPct ? parseFloat(stopLossPct) : undefined;
      let activeTp: number | undefined = takeProfitPct ? parseFloat(takeProfitPct) : undefined;

      // ── Step 1: Chart Vision ───────────────────────────────────────────────
      // In Auto mode, Vision runs first to identify the high-probability direction,
      // structural entry price, invalidation stop loss, and target take profit.
      if (imageBase64) {
        try {
          const visionRes = await fetch('/api/ai/chart-analysis', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              imageBase64,
              symbol,
              timeframe,
              lastCandleTime: latestCandle.openTime,
              forceRefresh: true,
            }),
          });
          const vData = (await visionRes.json()) as AnalyzeChartResponse & { error?: string };
          if (visionRes.ok && vData.analysis) {
            setVisionResult(vData);
            hadSuccess = true;

            // In Auto-Plan mode, apply the AI's educated parameters
            if (setupMode === 'auto' && vData.analysis.trade_setup) {
              const ts = vData.analysis.trade_setup;
              if (ts.action === 'long' || ts.action === 'short') {
                activeDirection = ts.action;
                setDirection(ts.action);
              } else if (vData.analysis.bias === 'long' || vData.analysis.bias === 'short') {
                activeDirection = vData.analysis.bias;
                setDirection(vData.analysis.bias);
              }

              if (ts.entry_price > 0) {
                activeEntry = ts.entry_price;
                setEntryPrice(ts.entry_price.toString());
              }
              if (ts.stop_loss_pct > 0) {
                activeSl = ts.stop_loss_pct;
                setStopLossPct(ts.stop_loss_pct.toString());
              }
              if (ts.take_profit_pct > 0) {
                activeTp = ts.take_profit_pct;
                setTakeProfitPct(ts.take_profit_pct.toString());
              }
            }
          } else {
            errors.push(`Chart Vision: ${vData.error || `HTTP ${visionRes.status}`}`);
          }
        } catch (vErr) {
          errors.push(`Chart Vision: ${vErr instanceof Error ? vErr.message : 'Request failed'}`);
        }
      } else {
        errors.push('Chart Vision: Chart canvas was not ready to capture.');
      }

      // ── Step 2: Order Decision Evaluator ───────────────────────────────────
      try {
        const evalRes = await fetch('/api/ai/evaluate-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbol,
            timeframe,
            direction: activeDirection,
            entryPrice: activeEntry,
            stopLossPct: activeSl,
            takeProfitPct: activeTp,
            candleTime: latestCandle.openTime,
            provider,
            customNotes: customNotes.trim() || undefined,
          }),
        });

        const eData = await evalRes.json();
        if (evalRes.ok && eData.success) {
          setEvalResult(eData.evaluation);
          hadSuccess = true;
        } else {
          errors.push(`Order Evaluator: ${eData.error || `HTTP ${evalRes.status}`}`);
        }
      } catch (eErr) {
        errors.push(`Order Evaluator: ${eErr instanceof Error ? eErr.message : 'Request failed'}`);
      }

      if (!hadSuccess && errors.length > 0) {
        setError(errors.join(' | '));
      } else if (errors.length > 0) {
        setPartialWarning(errors.join(' | '));
      }

      // Refetch history so new evaluation appears immediately
      fetchHistory(historyScope);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed.');
    } finally {
      setIsAnalyzing(false);
    }
  }, [
    latestCandle,
    getScreenshot,
    symbol,
    timeframe,
    direction,
    activeEntryPrice,
    stopLossPct,
    takeProfitPct,
    provider,
    customNotes,
    setupMode,
    fetchHistory,
    historyScope,
  ]);

  // Load an item from history for inspection
  const loadHistoricalItem = (item: AiHistoryItem) => {
    setActiveHistoryItem(item);
    setEvalResult(item.evaluation);
    setTelegramStatus('idle');
    setTelegramError(null);
    if (item.vision?.analysis) {
      setVisionResult({
        analysis: item.vision.analysis,
        fromCache: true,
        model: item.vision.model,
      });
    } else {
      setVisionResult(null);
    }
    setIsHistoryOpen(false);
  };

  // Dispatch AI evaluation report to Telegram group
  const handleSendTelegram = useCallback(async () => {
    if (!evalResult) return;

    setIsSendingTelegram(true);
    setTelegramStatus('idle');
    setTelegramError(null);

    try {
      const imageBase64 = getScreenshot();

      const payload = {
        symbol,
        timeframe,
        direction: activeHistoryItem?.direction ?? direction,
        entryPrice: activeEntryPrice,
        stopLossPct: stopLossPct ? parseFloat(stopLossPct) : undefined,
        takeProfitPct: takeProfitPct ? parseFloat(takeProfitPct) : undefined,
        evaluation: evalResult,
        vision: visionResult?.analysis,
        imageBase64,
        channel: 'signal', // routes to telegram_group_chat_id
        topic: {
          enabled: telegramDestination === 'topic',
          name: customTopicName.trim() || symbol,
        },
      };

      const res = await fetch('/api/ai/send-telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      setTelegramStatus('success');
      setTimeout(() => {
        setTelegramStatus('idle');
      }, 4000);
    } catch (err) {
      setTelegramStatus('error');
      setTelegramError(err instanceof Error ? err.message : 'Failed to send to Telegram group');
    } finally {
      setIsSendingTelegram(false);
    }
  }, [
    evalResult,
    visionResult,
    getScreenshot,
    symbol,
    timeframe,
    direction,
    activeHistoryItem,
    activeEntryPrice,
    stopLossPct,
    takeProfitPct,
    telegramDestination,
    customTopicName,
  ]);

  const hasResults = Boolean(evalResult || visionResult);

  return (
    <div className="flex flex-col h-full bg-surface border-l border-surface-border text-xs overflow-hidden">
      {/* ── Top Bar ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-surface-border bg-surface-2/60 flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="font-mono font-bold text-accent text-[11px] tracking-wider uppercase">
            AI Trading Copilot
          </span>
          <span className="text-[10px] font-mono text-text-muted">
            {symbol} · {timeframe.toUpperCase()}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* History Button */}
          <button
            type="button"
            onClick={() => setIsHistoryOpen((prev) => !prev)}
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded font-mono text-[10px] transition-colors border ${
              isHistoryOpen
                ? 'bg-accent text-white border-accent'
                : 'bg-surface hover:bg-surface-3 text-text-muted hover:text-text-primary border-surface-border'
            }`}
            title="Browse past evaluations stored in database"
          >
            <span>📜</span>
            <span>History</span>
            {historyList.length > 0 && (
              <span className="bg-surface-3 text-text-primary px-1 py-0.2 rounded text-[9px] font-bold">
                {historyList.length}
              </span>
            )}
          </button>

          {currentPrice > 0 && (
            <span className="font-mono text-[11px] font-semibold text-text-price bg-surface px-1.5 py-0.5 rounded border border-surface-border">
              ${currentPrice.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: currentPrice < 1 ? 6 : 2,
              })}
            </span>
          )}
        </div>
      </div>

      {/* ── Scrollable Body ──────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-3 scrollbar-thin">
        {/* ── HISTORY DRAWER / VIEW ────────────────────────────────────────── */}
        {isHistoryOpen && (
          <div className="p-3 rounded-lg border border-surface-border bg-surface-2 flex flex-col gap-2.5">
            <div className="flex items-center justify-between border-b border-surface-border/60 pb-2">
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold text-xs text-text-primary uppercase">
                  📜 Stored Evaluations History
                </span>
                <span className="text-[10px] font-mono text-text-muted">
                  ({historyList.length} runs)
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsHistoryOpen(false)}
                className="text-[11px] font-mono text-text-muted hover:text-text-primary"
              >
                ✕ Close
              </button>
            </div>

            {/* Scope Filter: Current vs All */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setHistoryScope('current');
                  fetchHistory('current');
                }}
                className={`flex-1 py-1 text-[10px] font-mono rounded transition-colors border ${
                  historyScope === 'current'
                    ? 'bg-accent/20 text-accent border-accent/40 font-bold'
                    : 'bg-surface text-text-muted border-surface-border hover:text-text-primary'
                }`}
              >
                {symbol} ({timeframe})
              </button>
              <button
                type="button"
                onClick={() => {
                  setHistoryScope('all');
                  fetchHistory('all');
                }}
                className={`flex-1 py-1 text-[10px] font-mono rounded transition-colors border ${
                  historyScope === 'all'
                    ? 'bg-accent/20 text-accent border-accent/40 font-bold'
                    : 'bg-surface text-text-muted border-surface-border hover:text-text-primary'
                }`}
              >
                All Cryptos & Pairs
              </button>
            </div>

            {/* History List */}
            {isLoadingHistory ? (
              <div className="py-6 text-center text-text-muted font-mono text-[11px]">
                Loading evaluation history…
              </div>
            ) : historyError ? (
              <div className="py-4 px-3 rounded bg-rose-500/10 border border-rose-500/30 text-rose-400 font-mono text-[11px] leading-relaxed text-center flex flex-col items-center gap-1.5">
                <span className="font-bold">⚠️ {historyError}</span>
                <span className="text-[10px] text-text-muted">Start Docker / PostgreSQL to access past evaluations.</span>
                <button
                  type="button"
                  onClick={() => fetchHistory()}
                  className="mt-1 px-2.5 py-1 text-[10px] bg-surface-2 border border-surface-border rounded hover:border-accent text-text-primary transition-colors"
                >
                  ↻ Retry Connection
                </button>
              </div>
            ) : historyList.length === 0 ? (
              <div className="py-6 text-center text-text-muted font-mono text-[11px] leading-relaxed">
                No past evaluations recorded for this pair yet.
                <br />
                Run an analysis below to store it for future reference.
              </div>
            ) : (
              <div className="flex flex-col gap-2 max-h-[360px] overflow-y-auto scrollbar-thin pr-1">
                {historyList.map((item) => {
                  const within3d = isWithin3Days(item.createdAt);
                  const isCurrentActive = activeHistoryItem?.id === item.id;
                  const statusConf = STATUS_CONFIG[item.status];

                  return (
                    <div
                      key={item.id}
                      onClick={() => loadHistoricalItem(item)}
                      className={`p-2.5 rounded border cursor-pointer transition-all flex flex-col gap-1.5 ${
                        isCurrentActive
                          ? 'border-accent bg-accent/10 shadow-sm'
                          : 'border-surface-border bg-surface hover:border-accent/50 hover:bg-surface-3'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`px-1.5 py-0.2 rounded text-[9px] font-mono font-bold uppercase border ${statusConf.bg} ${statusConf.text} ${statusConf.border}`}
                          >
                            {statusConf.icon} {item.status}
                          </span>
                          <span className="font-mono font-bold text-[10px] uppercase text-text-primary">
                            {item.direction === 'long' ? '🟢 LONG' : '🔴 SHORT'}
                          </span>
                          <span className="text-[10px] font-mono text-text-muted">
                            {item.symbol} · {item.timeframe}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5">
                          {within3d ? (
                            <span className="text-[9px] font-mono text-emerald-400 bg-emerald-500/10 px-1 py-0.2 rounded border border-emerald-500/20">
                              {formatTimeAgo(item.createdAt)}
                            </span>
                          ) : (
                            <span className="text-[9px] font-mono text-text-muted bg-surface-2 px-1 py-0.2 rounded border border-surface-border">
                              {formatTimeAgo(item.createdAt)} (&gt;3d)
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Summary preview */}
                      <p className="text-[10px] text-text-secondary leading-snug line-clamp-2">
                        {item.evaluation.summary}
                      </p>

                      <div className="flex items-center justify-between pt-1 border-t border-surface-border/40 text-[9px] font-mono text-text-muted">
                        <span>Model: {item.modelProvider}</span>
                        <span>Tech: {item.evaluation.metrics?.technicalScore ?? '—'}/100</span>
                        <span>Vision: {item.vision ? '✓ Saved' : '—'}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Active Historical Notice Banner ──────────────────────────────── */}
        {activeHistoryItem && hasResults && (
          <div className="flex items-center justify-between p-2 rounded-lg bg-surface-2 border border-accent/40 text-[10px] font-mono">
            <div className="flex items-center gap-1.5 text-accent">
              <span>📜</span>
              <span>
                Viewing {isWithin3Days(activeHistoryItem.createdAt) ? 'Latest' : 'Archived (>3d)'} Analysis ({formatTimeAgo(activeHistoryItem.createdAt)})
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setActiveHistoryItem(null);
                setEvalResult(null);
                setVisionResult(null);
                setIsSetupOpen(true);
              }}
              className="text-[10px] text-accent hover:underline font-bold"
            >
              + New Live Setup
            </button>
          </div>
        )}

        {/* Setup Configuration Form */}
        <div className="flex flex-col gap-2.5 p-3 rounded-lg border border-surface-border bg-surface-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase tracking-wider text-text-muted font-bold">
              Trade Setup & Execution Parameters
            </span>
            {hasResults && (
              <button
                type="button"
                onClick={() => setIsSetupOpen((prev) => !prev)}
                className="text-[10px] font-mono text-accent hover:underline"
              >
                {isSetupOpen ? '▲ Collapse Setup' : '▼ Edit Setup'}
              </button>
            )}
          </div>

          {isSetupOpen && (
            <>
              {/* Mode Toggle: Auto-Plan vs Manual */}
              <div className="flex items-center bg-surface border border-surface-border rounded-md p-0.5">
                <button
                  type="button"
                  onClick={() => setSetupMode('auto')}
                  className={`flex-1 py-1.5 px-3 rounded text-[11px] font-mono font-bold flex items-center justify-center gap-1.5 transition-all ${
                    setupMode === 'auto'
                      ? 'bg-accent text-white shadow-sm'
                      : 'text-text-muted hover:text-text-primary'
                  }`}
                >
                  <span>⚡</span>
                  <span>AI AUTO-PLAN</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSetupMode('manual')}
                  className={`flex-1 py-1.5 px-3 rounded text-[11px] font-mono font-bold flex items-center justify-center gap-1.5 transition-all ${
                    setupMode === 'manual'
                      ? 'bg-accent text-white shadow-sm'
                      : 'text-text-muted hover:text-text-primary'
                  }`}
                >
                  <span>✏️</span>
                  <span>MANUAL SETUP</span>
                </button>
              </div>

              {setupMode === 'auto' ? (
                <div className="bg-accent/10 border border-accent/25 rounded-md p-2.5 text-[11px] font-mono text-text-secondary flex items-start gap-2">
                  <span className="text-accent text-sm">💡</span>
                  <div className="leading-relaxed">
                    <span className="font-semibold text-text-primary">Auto-Engineered Setup:</span> AI will inspect chart structure, select the high-probability direction (<b className="text-emerald-400">Long</b>, <b className="text-rose-400">Short</b>, or <b className="text-amber-400">Wait</b>), and calculate optimal Entry, Invalidation Stop Loss, and Take Profit targets based on key levels and volatility.
                  </div>
                </div>
              ) : (
                <>
                  {/* Direction Selector */}
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setDirection('long')}
                      className={`py-1.5 font-mono font-bold text-xs rounded transition-all flex items-center justify-center gap-1.5 ${
                        direction === 'long'
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50 shadow-sm'
                          : 'bg-surface border border-surface-border text-text-muted hover:text-text-primary'
                      }`}
                    >
                      <span>🟢</span>
                      <span>LONG SETUP</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDirection('short')}
                      className={`py-1.5 font-mono font-bold text-xs rounded transition-all flex items-center justify-center gap-1.5 ${
                        direction === 'short'
                          ? 'bg-rose-500/20 text-rose-400 border border-rose-500/50 shadow-sm'
                          : 'bg-surface border border-surface-border text-text-muted hover:text-text-primary'
                      }`}
                    >
                      <span>🔴</span>
                      <span>SHORT SETUP</span>
                    </button>
                  </div>

                  {visionResult?.analysis.trade_setup && (
                    <button
                      type="button"
                      onClick={() => {
                        const ts = visionResult.analysis.trade_setup!;
                        if (ts.action === 'long' || ts.action === 'short') setDirection(ts.action);
                        if (ts.entry_price > 0) setEntryPrice(ts.entry_price.toString());
                        if (ts.stop_loss_pct > 0) setStopLossPct(ts.stop_loss_pct.toString());
                        if (ts.take_profit_pct > 0) setTakeProfitPct(ts.take_profit_pct.toString());
                      }}
                      className="w-full py-1.5 px-2 rounded border border-accent/40 bg-accent/10 hover:bg-accent/20 text-accent font-mono text-[10px] flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <span>🪄</span>
                      <span>Load AI Numbers (Entry: ${visionResult.analysis.trade_setup.entry_price}, SL: {visionResult.analysis.trade_setup.stop_loss_pct}%, TP: {visionResult.analysis.trade_setup.take_profit_pct}%)</span>
                    </button>
                  )}

                  {/* Numeric Inputs: Entry, SL, TP */}
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="text-[9px] font-mono text-text-muted uppercase block mb-0.5">
                        Entry ($)
                      </label>
                      <input
                        type="number"
                        step="any"
                        placeholder={currentPrice > 0 ? currentPrice.toString() : 'Current'}
                        value={entryPrice}
                        onChange={(e) => setEntryPrice(e.target.value)}
                        className="w-full bg-surface border border-surface-border rounded px-2 py-1 text-[11px] font-mono text-text-primary focus:outline-none focus:border-accent"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] font-mono text-text-muted uppercase block mb-0.5">
                        Stop Loss %
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        value={stopLossPct}
                        onChange={(e) => setStopLossPct(e.target.value)}
                        className="w-full bg-surface border border-surface-border rounded px-2 py-1 text-[11px] font-mono text-text-primary focus:outline-none focus:border-accent"
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-0.5">
                        <label className="text-[9px] font-mono text-text-muted uppercase block">
                          Take Profit %
                        </label>
                        {rrRatio && (
                          <span className="text-[8px] font-mono text-accent">
                            1:{rrRatio}
                          </span>
                        )}
                      </div>
                      <input
                        type="number"
                        step="0.1"
                        value={takeProfitPct}
                        onChange={(e) => setTakeProfitPct(e.target.value)}
                        className="w-full bg-surface border border-surface-border rounded px-2 py-1 text-[11px] font-mono text-text-primary focus:outline-none focus:border-accent"
                      />
                    </div>
                  </div>

                  {/* Optional Custom Notes */}
                  <input
                    type="text"
                    placeholder="Optional setup notes / macro context (e.g. 4h bounce, CPI print)..."
                    value={customNotes}
                    onChange={(e) => setCustomNotes(e.target.value)}
                    className="w-full bg-surface border border-surface-border rounded px-2 py-1 text-[11px] text-text-primary focus:outline-none focus:border-accent"
                  />
                </>
              )}

              {/* AI Engine Model Picker */}
              <div className="flex items-center justify-between gap-2">
                <label className="text-[10px] font-mono text-text-muted uppercase flex-shrink-0">
                  AI Engine:
                </label>
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value as EvaluatorProvider)}
                  className="flex-1 bg-surface border border-surface-border rounded px-2 py-1 text-[11px] font-mono text-text-primary focus:outline-none focus:border-accent"
                >
                  <option value="gemini">Google Gemini (3.8 Flash / 2.5)</option>
                  <option value="claude">Anthropic Claude (Opus 5.1 / 3.7)</option>
                  <option value="chatgpt">ChatGPT (GPT 5.1 / 6 / 4o)</option>
                  <option value="ensemble">Ensemble Consensus (All Configured)</option>
                </select>
              </div>
            </>
          )}

          {/* Unified Primary Action CTA */}
          <button
            type="button"
            disabled={isAnalyzing}
            onClick={handleAnalyze}
            className="w-full py-2.5 bg-accent hover:bg-accent/90 disabled:opacity-50 text-white font-mono font-bold text-xs uppercase tracking-wider rounded transition-all flex items-center justify-center gap-2 shadow-md active:scale-[0.99]"
          >
            {isAnalyzing ? (
              <>
                <span className="inline-block w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                <span>
                  {setupMode === 'auto' ? 'Generating AI Trade Plan & Evaluating…' : 'Evaluating Order & Chart Vision…'}
                </span>
              </>
            ) : setupMode === 'auto' ? (
              <>
                <span>⚡</span>
                <span>{hasResults ? 'Re-Generate AI Trade Plan & Evaluate' : 'Generate AI Trade Plan & Evaluate'}</span>
              </>
            ) : hasResults ? (
              <>
                <span>↺</span>
                <span>Re-Analyze Manual Setup & Chart Vision</span>
              </>
            ) : (
              <>
                <span>⚡</span>
                <span>Run Manual Evaluation & Chart Vision</span>
              </>
            )}
          </button>
        </div>

        {/* Error Banner */}
        {error && (
          <div className="p-2.5 bg-rose-500/10 border border-rose-500/30 rounded-lg text-[11px] text-rose-400 font-mono">
            {error}
          </div>
        )}

        {/* Partial Warning Banner */}
        {partialWarning && (
          <div className="p-2 bg-amber-500/10 border border-amber-500/30 rounded-lg text-[10px] text-amber-400 font-mono">
            {partialWarning}
          </div>
        )}

        {/* ── Cohesive Results Section ───────────────────────────────────── */}
        {hasResults && !isAnalyzing && (
          <div className="flex flex-col gap-2.5">
            {/* 1. Gatekeeper Verdict Banner */}
            {evalResult && (
              <div
                className={`p-3 rounded-lg border flex flex-col gap-2 ${
                  STATUS_CONFIG[evalResult.status].bg
                } ${STATUS_CONFIG[evalResult.status].border}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">
                      {STATUS_CONFIG[evalResult.status].icon}
                    </span>
                    <div>
                      <span
                        className={`font-mono font-black text-sm tracking-wide ${
                          STATUS_CONFIG[evalResult.status].text
                        }`}
                      >
                        {STATUS_CONFIG[evalResult.status].label}
                      </span>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] font-mono text-text-muted">
                          Confidence: <b className="text-text-primary uppercase">{evalResult.confidence}</b>
                        </span>
                        <span className="text-text-muted/40">·</span>
                        <span className="text-[10px] font-mono text-text-muted">
                          Setup: <b className="uppercase">{direction}</b> @ ${activeEntryPrice.toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="text-[9px] font-mono text-text-muted block">
                      {evalResult.model.modelName}
                    </span>
                    {activeHistoryItem ? (
                      <span className="text-[9px] font-mono uppercase bg-surface px-1.5 py-0.5 rounded text-accent border border-accent/20">
                        {formatTimeAgo(activeHistoryItem.createdAt)}
                      </span>
                    ) : evalResult.fromCache ? (
                      <span className="text-[9px] font-mono uppercase bg-surface px-1.5 py-0.5 rounded text-accent border border-accent/20">
                        Cached
                      </span>
                    ) : null}
                  </div>
                </div>

                {/* Core Executive Summary */}
                <div className="p-2 bg-surface/80 rounded border border-surface-border text-[11px] leading-relaxed text-text-primary">
                  {evalResult.summary}
                </div>

                {/* Send to Telegram Group CTA */}
                <div className="flex flex-col gap-1.5 pt-0.5">
                  {/* Destination / Topic Selector */}
                  <div className="flex items-center justify-between text-[10px] font-mono text-text-muted px-0.5">
                    <span className="flex items-center gap-1">
                      <span>Target:</span>
                      <span className="text-text-secondary font-semibold">
                        {telegramDestination === 'topic' ? `#${customTopicName.trim() || symbol}` : 'General Chat'}
                      </span>
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setTelegramDestination('topic')}
                        className={`px-1.5 py-0.5 rounded text-[9px] transition-colors border ${
                          telegramDestination === 'topic'
                            ? 'bg-accent/20 border-accent/40 text-accent font-semibold'
                            : 'bg-surface border-surface-border text-text-muted hover:text-text-primary'
                        }`}
                        title={`Send to topic #${customTopicName.trim() || symbol}`}
                      >
                        #{symbol}
                      </button>
                      <button
                        type="button"
                        onClick={() => setTelegramDestination('general')}
                        className={`px-1.5 py-0.5 rounded text-[9px] transition-colors border ${
                          telegramDestination === 'general'
                            ? 'bg-accent/20 border-accent/40 text-accent font-semibold'
                            : 'bg-surface border-surface-border text-text-muted hover:text-text-primary'
                        }`}
                        title="Send directly to main General chat without topic thread"
                      >
                        General
                      </button>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={isSendingTelegram}
                    onClick={handleSendTelegram}
                    className={`w-full py-2 px-3 rounded-md font-mono font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-sm ${
                      telegramStatus === 'success'
                        ? 'bg-emerald-500/20 border border-emerald-500/50 text-emerald-300'
                        : telegramStatus === 'error'
                        ? 'bg-rose-500/15 border border-rose-500/40 text-rose-300'
                        : 'bg-[#229ED9]/15 hover:bg-[#229ED9]/25 border border-[#229ED9]/40 text-[#229ED9] hover:text-white active:scale-[0.99]'
                    }`}
                    title="Send this evaluation and chart analysis to the Telegram group"
                  >
                    <svg className="w-4 h-4 fill-current flex-shrink-0" viewBox="0 0 24 24">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/>
                    </svg>
                    <span>
                      {isSendingTelegram
                        ? 'Sending to Telegram Group…'
                        : telegramStatus === 'success'
                        ? '✓ Sent to Telegram Group!'
                        : 'Send AI Evaluation to Telegram Group'}
                    </span>
                  </button>
                  {telegramError && (
                    <div className="p-2 bg-rose-500/10 border border-rose-500/30 rounded text-[10px] font-mono text-rose-300">
                      {telegramError}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 2. Visual Chart Analysis & Levels (Vision) */}
            {visionResult && (
              <>
                {visionResult.analysis.trade_setup && (
                  <AiTradePlanCard
                    plan={visionResult.analysis.trade_setup}
                    onApply={() => {
                      const ts = visionResult.analysis.trade_setup!;
                      if (ts.action === 'long' || ts.action === 'short') setDirection(ts.action);
                      if (ts.entry_price > 0) setEntryPrice(ts.entry_price.toString());
                      if (ts.stop_loss_pct > 0) setStopLossPct(ts.stop_loss_pct.toString());
                      if (ts.take_profit_pct > 0) setTakeProfitPct(ts.take_profit_pct.toString());
                      setSetupMode('manual');
                      setIsSetupOpen(true);
                    }}
                  />
                )}
                <VisualTrendCard analysis={visionResult.analysis} />
                <KeyLevelsTable levels={visionResult.analysis.key_levels} />
                <DetectedPatterns patterns={visionResult.analysis.patterns} />
              </>
            )}

            {/* 3. Confluence Breakdown: Technical & Sentiment (Evaluator) */}
            {evalResult && (
              <div className="flex flex-col gap-2">
                {/* Technical Alignment */}
                <div className="p-2.5 bg-surface rounded-lg border border-surface-border">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-mono uppercase font-bold text-text-muted">
                      📊 Technical Indicators Alignment
                    </span>
                    <span className="text-[10px] font-mono font-bold text-accent bg-accent/10 px-1.5 py-0.5 rounded border border-accent/20">
                      Score: {evalResult.metrics.technicalScore}/100
                    </span>
                  </div>
                  <p className="text-[11px] text-text-secondary leading-relaxed">
                    {evalResult.reasons.technical}
                  </p>
                </div>

                {/* News & Social Sentiment */}
                <div className="p-2.5 bg-surface rounded-lg border border-surface-border">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-mono uppercase font-bold text-text-muted">
                      📰 Multi-Channel Catalyst & News
                    </span>
                    <span
                      className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${
                        evalResult.metrics.sentimentScore > 0
                          ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
                          : evalResult.metrics.sentimentScore < 0
                          ? 'text-rose-400 bg-rose-500/10 border-rose-500/30'
                          : 'text-text-muted bg-surface-2 border-surface-border'
                      }`}
                    >
                      Sentiment: {evalResult.metrics.sentimentScore > 0 ? '+' : ''}
                      {evalResult.metrics.sentimentScore}
                    </span>
                  </div>
                  <p className="text-[11px] text-text-secondary leading-relaxed">
                    {evalResult.reasons.sentiment}
                  </p>
                </div>

                {/* Primary Risk & Invalidation */}
                <div className="p-2.5 bg-amber-500/5 rounded-lg border border-amber-500/20">
                  <span className="text-[10px] font-mono uppercase font-bold text-amber-400 block mb-1">
                    ⚠️ Primary Invalidation & Risk Factors
                  </span>
                  <p className="text-[11px] text-text-secondary leading-relaxed">
                    {evalResult.reasons.primaryRisk}
                  </p>

                  {/* Append Vision risk notes if present */}
                  {visionResult?.analysis.risk_notes && visionResult.analysis.risk_notes.length > 0 && (
                    <ul className="mt-2 pt-2 border-t border-amber-500/15 flex flex-col gap-1">
                      {visionResult.analysis.risk_notes.map((note, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-[10px] text-text-secondary">
                          <span className="text-amber-500 flex-shrink-0">▲</span>
                          <span>{note}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Ensemble Model Breakdown (if applicable) */}
                {evalResult.model.ensembleVotes &&
                  Object.keys(evalResult.model.ensembleVotes).length > 0 && (
                    <div className="p-2.5 bg-surface rounded-lg border border-surface-border flex flex-col gap-1.5">
                      <span className="text-[10px] font-mono uppercase text-text-muted font-bold">
                        Ensemble Consensus Votes:
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(evalResult.model.ensembleVotes).map(([modelKey, vote]) => (
                          <span
                            key={modelKey}
                            className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase border ${
                              vote.status === 'PASS'
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                : vote.status === 'CAVEAT'
                                ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                                : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                            }`}
                          >
                            {modelKey}: {vote.status}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
              </div>
            )}

            {/* Disclaimer */}
            <div className="p-2 rounded bg-surface border border-surface-border text-[9px] text-text-muted leading-relaxed">
              {visionResult?.analysis.disclaimer ??
                'This automated AI analysis is for educational and decision-support purposes only and does not constitute financial advice. Always exercise proper risk management.'}
            </div>
          </div>
        )}

        {/* Empty State */}
        {!hasResults && !isAnalyzing && !error && !isHistoryOpen && (
          <div className="flex flex-col items-center justify-center p-6 text-center rounded-lg border border-dashed border-surface-border bg-surface-2/30 my-auto">
            <span className="text-2xl mb-2">⚡</span>
            <h4 className="font-mono text-xs font-bold text-text-primary mb-1">
              Dual-Engine AI Copilot
            </h4>
            <p className="text-[11px] text-text-muted leading-relaxed max-w-[260px]">
              Combines live canvas Chart Vision (patterns, S/R levels) with 37+ indicators & news sentiment to give an actionable PASS/CAVEAT/REJECT verdict.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
