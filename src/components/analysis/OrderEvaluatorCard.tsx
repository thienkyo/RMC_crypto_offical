'use client';

/**
 * OrderEvaluatorCard — Interactive AI pre-trade decision engine.
 *
 * Evaluates prospective Long/Short orders using real-time candles,
 * 37+ technical indicators, and multi-channel sentiment (Newspapers,
 * Telegram, Tech News, X, YouTube).
 *
 * Verdicts: PASS 🟢 | CAVEAT 🟡 | REJECT 🔴
 */

import { useState, useCallback } from 'react';
import { useChartStore } from '@/store/chart';
import type {
  OrderEvaluationResult,
  EvaluatorProvider,
  EvaluationStatus,
} from '@/lib/ai/evaluator/types';

const STATUS_CONFIG: Record<
  EvaluationStatus,
  { label: string; bg: string; text: string; border: string; icon: string }
> = {
  PASS: {
    label: 'PASS',
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-400',
    border: 'border-emerald-500/30',
    icon: '✓',
  },
  CAVEAT: {
    label: 'CAVEAT (CAUTION)',
    bg: 'bg-amber-500/10',
    text: 'text-amber-400',
    border: 'border-amber-500/30',
    icon: '⚠️',
  },
  REJECT: {
    label: 'REJECT',
    bg: 'bg-rose-500/10',
    text: 'text-rose-400',
    border: 'border-rose-500/30',
    icon: '✕',
  },
};

export function OrderEvaluatorCard() {
  const symbol = useChartStore((s) => s.symbol);
  const timeframe = useChartStore((s) => s.timeframe);
  const candles = useChartStore((s) => s.candles);

  const latestCandle = candles[candles.length - 1];
  const currentPrice = latestCandle?.close ?? 0;

  const [direction, setDirection] = useState<'long' | 'short'>('long');
  const [provider, setProvider] = useState<EvaluatorProvider>('gemini');
  const [entryPrice, setEntryPrice] = useState<string>('');
  const [stopLossPct, setStopLossPct] = useState<string>('3.0');
  const [takeProfitPct, setTakeProfitPct] = useState<string>('6.0');
  const [customNotes, setCustomNotes] = useState<string>('');

  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<OrderEvaluationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeEntryPrice = entryPrice ? parseFloat(entryPrice) : currentPrice;

  const handleEvaluate = useCallback(async () => {
    if (!latestCandle) {
      setError('Market candles are still loading.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/ai/evaluate-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          timeframe,
          direction,
          entryPrice: activeEntryPrice,
          stopLossPct: stopLossPct ? parseFloat(stopLossPct) : undefined,
          takeProfitPct: takeProfitPct ? parseFloat(takeProfitPct) : undefined,
          candleTime: latestCandle.openTime,
          provider,
          customNotes: customNotes.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      setResult(data.evaluation);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Evaluation failed.');
    } finally {
      setIsLoading(false);
    }
  }, [symbol, timeframe, direction, activeEntryPrice, stopLossPct, takeProfitPct, latestCandle, provider, customNotes]);

  return (
    <div className="flex flex-col gap-3 p-3 bg-surface-2 rounded-lg border border-surface-border text-xs">
      {/* Title */}
      <div className="flex items-center justify-between border-b border-surface-border/60 pb-2">
        <div className="flex items-center gap-1.5 font-mono">
          <span className="text-accent font-bold">AI ORDER EVALUATOR</span>
          <span className="text-[10px] text-text-muted">({symbol} · {timeframe})</span>
        </div>
        <span className="text-[10px] font-mono text-text-muted">3-State Gatekeeper</span>
      </div>

      {/* Setup Form */}
      <div className="flex flex-col gap-2.5">
        {/* Direction Selector */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setDirection('long')}
            className={`flex-1 py-1.5 font-mono font-bold text-xs rounded transition-colors ${
              direction === 'long'
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                : 'bg-surface border border-surface-border text-text-muted hover:text-text-primary'
            }`}
          >
            🟢 LONG SETUP
          </button>
          <button
            type="button"
            onClick={() => setDirection('short')}
            className={`flex-1 py-1.5 font-mono font-bold text-xs rounded transition-colors ${
              direction === 'short'
                ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                : 'bg-surface border border-surface-border text-text-muted hover:text-text-primary'
            }`}
          >
            🔴 SHORT SETUP
          </button>
        </div>

        {/* Model Provider Picker */}
        <div className="flex items-center justify-between gap-2">
          <label className="text-[11px] font-mono text-text-muted">AI Engine:</label>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as EvaluatorProvider)}
            className="flex-1 bg-surface border border-surface-border rounded px-2 py-1 text-[11px] font-mono text-text-primary focus:outline-none focus:border-accent"
          >
            <option value="gemini">Google Gemini (3.8 Flash / 2.5)</option>
            <option value="claude">Anthropic Claude (Opus 5.1 / 3.7)</option>
            <option value="chatgpt">ChatGPT (GPT 5.1 / GPT-6 / 4o)</option>
            <option value="ensemble">Ensemble Consensus (All Configured)</option>
          </select>
        </div>

        {/* Numeric inputs */}
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="text-[10px] font-mono text-text-muted block mb-0.5">Entry ($)</label>
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
            <label className="text-[10px] font-mono text-text-muted block mb-0.5">Stop Loss %</label>
            <input
              type="number"
              step="0.1"
              value={stopLossPct}
              onChange={(e) => setStopLossPct(e.target.value)}
              className="w-full bg-surface border border-surface-border rounded px-2 py-1 text-[11px] font-mono text-text-primary focus:outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="text-[10px] font-mono text-text-muted block mb-0.5">Take Profit %</label>
            <input
              type="number"
              step="0.1"
              value={takeProfitPct}
              onChange={(e) => setTakeProfitPct(e.target.value)}
              className="w-full bg-surface border border-surface-border rounded px-2 py-1 text-[11px] font-mono text-text-primary focus:outline-none focus:border-accent"
            />
          </div>
        </div>

        {/* Custom notes */}
        <input
          type="text"
          placeholder="Optional notes / setup context (e.g. 4h bounce, breaking news)..."
          value={customNotes}
          onChange={(e) => setCustomNotes(e.target.value)}
          className="w-full bg-surface border border-surface-border rounded px-2 py-1 text-[11px] text-text-primary focus:outline-none focus:border-accent"
        />

        {/* Action button */}
        <button
          type="button"
          disabled={isLoading}
          onClick={handleEvaluate}
          className="w-full py-2 bg-accent hover:bg-accent/90 disabled:opacity-50 text-surface font-mono font-bold text-xs uppercase tracking-wider rounded transition-colors flex items-center justify-center gap-1.5 shadow"
        >
          {isLoading ? (
            <>
              <span className="inline-block w-3 h-3 border-2 border-surface border-t-transparent rounded-full animate-spin" />
              Evaluating Setup…
            </>
          ) : (
            'Evaluate Order Setup'
          )}
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div className="p-2 bg-rose-500/10 border border-rose-500/30 rounded text-[11px] text-rose-400 font-mono">
          {error}
        </div>
      )}

      {/* Results Display */}
      {result && (
        <div className="flex flex-col gap-2.5 mt-1 pt-2 border-t border-surface-border/60">
          {/* Verdict Banner */}
          <div
            className={`flex items-center justify-between p-2.5 rounded border ${
              STATUS_CONFIG[result.status].bg
            } ${STATUS_CONFIG[result.status].border}`}
          >
            <div className="flex items-center gap-2">
              <span className="text-base">{STATUS_CONFIG[result.status].icon}</span>
              <div>
                <span
                  className={`font-mono font-black text-sm tracking-wider ${
                    STATUS_CONFIG[result.status].text
                  }`}
                >
                  {STATUS_CONFIG[result.status].label}
                </span>
                <span className="text-[10px] text-text-muted block font-mono">
                  Confidence: {result.confidence.toUpperCase()}
                </span>
              </div>
            </div>

            <div className="text-right">
              <span className="text-[10px] font-mono text-text-muted block">
                {result.model.modelName}
              </span>
              {result.fromCache && (
                <span className="text-[9px] font-mono uppercase bg-surface px-1 py-0.5 rounded text-accent border border-accent/20">
                  Cached
                </span>
              )}
            </div>
          </div>

          {/* Core Summary */}
          <div className="p-2 bg-surface rounded border border-surface-border text-[11px] leading-relaxed text-text-primary">
            {result.summary}
          </div>

          {/* 3-Point Concise Breakdown */}
          <div className="flex flex-col gap-1.5">
            {/* Technical */}
            <div className="p-2 bg-surface rounded border border-surface-border">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-mono uppercase font-bold text-text-muted">
                  📊 Technical Indicators & Candles
                </span>
                <span className="text-[10px] font-mono text-accent">
                  Score: {result.metrics.technicalScore}/100
                </span>
              </div>
              <p className="text-[11px] text-text-secondary leading-relaxed">
                {result.reasons.technical}
              </p>
            </div>

            {/* Sentiment */}
            <div className="p-2 bg-surface rounded border border-surface-border">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-mono uppercase font-bold text-text-muted">
                  📰 News & Social Media Catalyst
                </span>
                <span
                  className={`text-[10px] font-mono ${
                    result.metrics.sentimentScore > 0
                      ? 'text-emerald-400'
                      : result.metrics.sentimentScore < 0
                      ? 'text-rose-400'
                      : 'text-text-muted'
                  }`}
                >
                  Sentiment: {result.metrics.sentimentScore > 0 ? '+' : ''}
                  {result.metrics.sentimentScore}
                </span>
              </div>
              <p className="text-[11px] text-text-secondary leading-relaxed">
                {result.reasons.sentiment}
              </p>
            </div>

            {/* Primary Risk */}
            <div className="p-2 bg-surface rounded border border-amber-500/20 bg-amber-500/5">
              <span className="text-[10px] font-mono uppercase font-bold text-amber-400 block mb-1">
                ⚠️ Primary Invalidation Risk
              </span>
              <p className="text-[11px] text-text-secondary leading-relaxed">
                {result.reasons.primaryRisk}
              </p>
            </div>
          </div>

          {/* Ensemble Breakdown if applicable */}
          {result.model.ensembleVotes && Object.keys(result.model.ensembleVotes).length > 0 && (
            <div className="p-2 bg-surface rounded border border-surface-border flex flex-col gap-1">
              <span className="text-[10px] font-mono uppercase text-text-muted font-bold">
                Model Voting Breakdown:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(result.model.ensembleVotes).map(([modelKey, vote]) => (
                  <span
                    key={modelKey}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono uppercase border ${
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
    </div>
  );
}
