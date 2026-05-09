/**
 * useBacktest — fetches historical candles and runs the backtester.
 *
 * Fetches from the existing /api/candles endpoint (same one the chart uses),
 * requesting a large window (1000 bars) so there's enough history.
 *
 * The backtest runs synchronously inside a Web Worker-free setTimeout
 * to keep it off the main thread's hot path.  For > 5k candles consider
 * moving to a Web Worker in a future iteration.
 */

import { useCallback } from 'react';
import { useStrategyStore } from '@/store/strategy';
import { runBacktest } from '@/lib/strategy/backtester';
import { INDICATORS } from '@/lib/indicators';
import type { Strategy } from '@/types/strategy';
import type { Candle } from '@/types/market';

interface RawCandle {
  openTime:  number;
  open:      number;
  high:      number;
  low:       number;
  close:     number;
  volume:    number;
  closeTime: number;
}

export function useBacktest() {
  const setBacktestResult  = useStrategyStore((s) => s.setBacktestResult);
  const setBacktesting     = useStrategyStore((s) => s.setBacktesting);
  const saveBacktestResult = useStrategyStore((s) => s.saveBacktestResult);

  const runBacktestForStrategy = useCallback(
    async (strategy: Strategy) => {
      setBacktesting(true);
      setBacktestResult(null);

      try {
        // Fetch the maximum 1000-bar window for this symbol / timeframe.
        // The API envelope is { symbol, interval, data: RawCandle[] }.
        const url = `/api/candles?symbol=${encodeURIComponent(strategy.symbol)}&interval=${strategy.timeframe}&limit=1000`;
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`Failed to fetch candles: ${res.statusText}`);
        }
        const { data: raw } = await res.json() as { data: RawCandle[] };

        // Normalise to internal Candle type (API may return strings from Postgres)
        const candles: Candle[] = raw.map((r) => ({
          openTime:  Number(r.openTime),
          open:      Number(r.open),
          high:      Number(r.high),
          low:       Number(r.low),
          close:     Number(r.close),
          volume:    Number(r.volume),
          closeTime: Number(r.closeTime),
        }));

        // Run sync but yield to the event loop first so the UI can update the
        // "Running…" spinner before the CPU-bound work starts
        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        const result = runBacktest(strategy, candles);

        // ── Diagnostic helper: log all entry/exit condition hit-rates ────────
        function logConditionHitRates(label: string, groups: typeof strategy.entryConditions) {
          for (const group of groups) {
            for (const cond of group.conditions) {
              const indicator = INDICATORS[cond.indicatorId];
              if (!indicator) { console.warn(`  ${label}: unknown indicator "${cond.indicatorId}"`); continue; }

              const computed = indicator.compute(candles, cond.params);
              const series   = computed[cond.seriesIndex] ?? computed[0];
              if (!series) { console.warn(`  ${label}: no series at index ${cond.seriesIndex}`); continue; }

              const vals = series.data.map((p) => p.value).filter((v) => !Number.isNaN(v));
              if (vals.length === 0) { console.warn(`  ${label}: indicator returned no data`); continue; }

              const min  = Math.min(...vals);
              const max  = Math.max(...vals);
              const hits = vals.filter((v) => {
                switch (cond.operator) {
                  case 'gt':  return v >  cond.value;
                  case 'lt':  return v <  cond.value;
                  case 'gte': return v >= cond.value;
                  case 'lte': return v <= cond.value;
                  default:    return false;
                }
              }).length;

              const pct = ((hits / vals.length) * 100).toFixed(1);
              console.log(
                `  ${label}: ${cond.indicatorId}[${cond.seriesIndex}] "${series.name}" ${cond.operator} ${cond.value}` +
                ` → ${hits}/${vals.length} bars match (${pct}%)` +
                `  |  range: ${min.toFixed(2)} – ${max.toFixed(2)}`,
              );

              if (hits === 0) {
                if (cond.value < min) console.warn(`    ↳ Threshold ${cond.value} is BELOW the min (${min.toFixed(2)}) — never fires. Try ≤ ${Math.round(min * 0.95)}`);
                if (cond.value > max) console.warn(`    ↳ Threshold ${cond.value} is ABOVE the max (${max.toFixed(2)}) — never fires. Try ≥ ${Math.round(max * 1.05)}`);
              }
            }
          }
        }

        // ── Diagnostic: always log a summary; full detail for ≤ 10 trades ─────
        const tradeCount = result.trades.length;
        console.group(`[Backtest] ${tradeCount} trade(s) over ${candles.length} candles (${strategy.symbol} ${strategy.timeframe})`);

        if (tradeCount > 0) {
          const durations = result.trades.map((t) => t.exitTime - t.entryTime);
          const avgDurMs  = durations.reduce((s, d) => s + d, 0) / durations.length;
          const avgDurBars = Math.round(avgDurMs / /* 1h ms */ (
            strategy.timeframe === '1m' ? 60_000 :
            strategy.timeframe === '5m' ? 300_000 :
            strategy.timeframe === '15m' ? 900_000 :
            strategy.timeframe === '30m' ? 1_800_000 :
            strategy.timeframe === '1h' ? 3_600_000 :
            strategy.timeframe === '4h' ? 14_400_000 :
            strategy.timeframe === '1d' ? 86_400_000 : 3_600_000
          ));
          const wins    = result.trades.filter((t) => t.pnlAbs > 0).length;
          const exitMap = result.trades.reduce<Record<string, number>>((acc, t) => {
            acc[t.exitReason] = (acc[t.exitReason] ?? 0) + 1; return acc;
          }, {});
          console.log(`  Avg trade duration: ~${avgDurBars} bars | Win rate: ${((wins / tradeCount) * 100).toFixed(0)}% | Exits: ${JSON.stringify(exitMap)}`);

          if (tradeCount < 10) {
            console.warn(
              `  ⚠ Only ${tradeCount} trade(s) fired. This is common when:\n` +
              `    • SL/TP thresholds are wide (current: SL=${strategy.risk.stopLossPct}%, TP=${strategy.risk.takeProfitPct}%) — larger thresholds mean positions stay open longer\n` +
              `    • Entry condition fires on almost every bar (e.g. RSI < 90), but the strategy is ONE POSITION AT A TIME\n` +
              `    • RSI < 90 being true on 980/1000 bars ≠ 980 trades. It just means you re-enter quickly after each close.\n` +
              `    To get more trades: tighten SL/TP, shorten the timeframe, or add an exit signal condition.`
            );
          }
        }

        if (tradeCount === 0) {
          console.warn('  ↳ 0 trades: entry condition never fired (or no entry groups defined).');
        }

        // Show condition hit-rates whenever trade count is low (or zero)
        if (tradeCount < 10) {
          console.log('  --- Entry condition hit-rates (fires on N bars out of M warm bars) ---');
          logConditionHitRates('ENTRY', strategy.entryConditions);
          if (strategy.exitConditions.length > 0) {
            console.log('  --- Exit condition hit-rates ---');
            logConditionHitRates('EXIT', strategy.exitConditions);
          }
        }

        console.groupEnd();

        setBacktestResult(result);
        saveBacktestResult(result); // persist to history
      } catch (err) {
        console.error('[useBacktest]', err);
        // Surface error to caller; store result stays null
        throw err;
      } finally {
        setBacktesting(false);
      }
    },
    [setBacktesting, setBacktestResult, saveBacktestResult],
  );

  return { runBacktestForStrategy };
}
