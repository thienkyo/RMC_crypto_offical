/**
 * Starter (pre-defined) strategy templates.
 *
 * These are research-backed blueprints shipped with the app.  They are NOT
 * active strategies — they must be cloned before use.
 *
 * All three default to BTCUSDT / 4h so they can be backtested immediately
 * after cloning. Change symbol / timeframe on the clone as needed.
 *
 * Series index reference:
 *   rsi       [0] RSI value
 *   macd      [0] MACD line  [1] Signal  [2] Histogram  [3] Strategy Signal
 *   bbpct     [0] BB %B (0.0 = lower band, 1.0 = upper band, >1 = above upper)
 *   adx       [0] ADX  [1] +DI  [2] −DI
 *   stochrsi  [0] %K   [1] %D
 *   identical_three_crows  [0] pattern signal (0 or 1)
 */

import type { Strategy } from '@/types/strategy';

const BASE: Pick<Strategy, 'version' | 'createdAt' | 'updatedAt' | 'isTemplate' | 'isActive'> = {
  version:   1,
  createdAt: 0, // intentionally 0 — gets replaced on first load
  updatedAt: 0,
  isTemplate: true,
  isActive:   false,
};

// ─── Template 1: Trend-Reversal Powerhouse ────────────────────────────────────
//
// Logic: Identical Three Crows signals panic selling. RSI overbought confirms
// price was extended. MACD Strategy Signal < 0 confirms the trend has flipped
// and is now below the 200 EMA — the bubble has popped.
// Direction: enter_short

const trendReversal: Strategy = {
  ...BASE,
  id:          'starter_trend_reversal',
  name:        'Trend-Reversal Powerhouse',
  description:
    'Bearish reversal combo: Three Crows pattern + RSI overbought + MACD bearish signal.\n\n' +
    '• Three Crows (lookback 3): pattern must have fired on one of the last 3 bars.\n' +
    '• RSI(14) > 70: price was in overbought territory.\n' +
    '• MACD Strategy Signal < 0: bearish MACD crossover confirmed AND close is below the 200 EMA.\n\n' +
    'All three conditions must align before entering short. ' +
    'Adjust SL/TP to your risk tolerance after cloning.',
  symbol:    'BTCUSDT',
  timeframe: '4h',
  entryConditions: [
    {
      id:    'starter_tr_group_1',
      label: 'Reversal Setup',
      conditions: [
        {
          id:          'starter_tr_cond_pattern',
          indicatorId: 'identical_three_crows',
          params:      {},
          seriesIndex: 0,
          operator:    'gt',
          value:       0,
          checkMode:   'lookback',
          checkCandles: 3,
        },
        {
          id:          'starter_tr_cond_rsi',
          indicatorId: 'rsi',
          params:      { period: 14, emaPeriod: 0 },
          seriesIndex: 0,
          operator:    'gt',
          value:       70,
          checkMode:   'confirmation',
          checkCandles: 1,
        },
        {
          id:          'starter_tr_cond_macd',
          indicatorId: 'macd',
          params:      { fast: 12, slow: 26, signal: 9, trendEma: 200 },
          seriesIndex: 3, // Strategy Signal (−1 = bearish, 0 = none, 1 = bullish)
          operator:    'lt',
          value:       0,
          checkMode:   'confirmation',
          checkCandles: 1,
        },
      ],
    },
  ],
  exitConditions: [],
  action: { type: 'enter_short', positionSizePct: 10, maxPositions: 1 },
  risk:   { stopLossPct: 3, takeProfitPct: 6 },
};

// ─── Template 2: Golden Trio — Volatility + Momentum ─────────────────────────
//
// Logic: BB %B > 1 means price broke above the upper Bollinger Band (overextended).
// MACD Histogram crosses below 0 = momentum has turned bearish.
// RSI > 70 = overbought confirmation.
// Three independent lenses all pointing the same way = high conviction short.
// Direction: enter_short

const goldenTrio: Strategy = {
  ...BASE,
  id:          'starter_golden_trio',
  name:        'Golden Trio — Volatility + Momentum',
  description:
    'Bearish overbought reversal: BB %B + MACD bearish crossover + RSI overbought.\n\n' +
    '• BB %B > 1.0: price has broken above the upper Bollinger Band — statistically overextended.\n' +
    '• MACD Histogram crosses below 0: momentum has just flipped bearish.\n' +
    '• RSI(14) > 70: confirms overbought exhaustion.\n\n' +
    'Research note: ensemble models (XGBoost) consistently identify these three as the top features ' +
    'for bearish reversals. Pairs well with a Sharpe-optimised position size. ' +
    'Adjust SL/TP after cloning.',
  symbol:    'BTCUSDT',
  timeframe: '4h',
  entryConditions: [
    {
      id:    'starter_gt_group_1',
      label: 'Overbought Reversal',
      conditions: [
        {
          id:          'starter_gt_cond_bbpct',
          indicatorId: 'bbpct',
          params:      { period: 20, stdDevMult: 2 },
          seriesIndex: 0,   // BB %B — >1.0 means above upper band
          operator:    'gt',
          value:       1.0,
          checkMode:   'confirmation',
          checkCandles: 1,
        },
        {
          id:          'starter_gt_cond_macd_hist',
          indicatorId: 'macd',
          params:      { fast: 12, slow: 26, signal: 9, trendEma: 200 },
          seriesIndex: 2,   // Histogram — crossing below 0 = bearish crossover
          operator:    'crosses_below',
          value:       0,
          checkMode:   'confirmation',
          checkCandles: 1,
        },
        {
          id:          'starter_gt_cond_rsi',
          indicatorId: 'rsi',
          params:      { period: 14, emaPeriod: 0 },
          seriesIndex: 0,
          operator:    'gt',
          value:       70,
          checkMode:   'confirmation',
          checkCandles: 1,
        },
      ],
    },
  ],
  exitConditions: [],
  action: { type: 'enter_short', positionSizePct: 10, maxPositions: 1 },
  risk:   { stopLossPct: 2.5, takeProfitPct: 5 },
};

// ─── Template 3: ADX Trend-Following ─────────────────────────────────────────
//
// Logic: ADX > 25 confirms a strong trend is present (direction-neutral).
// StochRSI %K > 80 times the entry when momentum is at its peak — a
// "selling-the-rip" approach in a downtrend, or exit-overbought in an uptrend.
//
// This template is configured as enter_short (StochRSI overbought in a
// strong trend = exhaustion short). To flip to LONG: clone, change action
// to enter_long, and change StochRSI %K threshold to < 20 (oversold).
//
// Multi-timeframe note: research shows best results when the trend direction
// on the 1D agrees with the 4h signal. Use this template on 4h and manually
// verify the 1D chart before acting on a clone.

const adxTrend: Strategy = {
  ...BASE,
  id:          'starter_adx_trend',
  name:        'ADX Trend-Following',
  description:
    'High-conviction trend entry: ADX(14) > 25 (strong trend) + StochRSI %K > 80 (overbought momentum).\n\n' +
    '• ADX(14) > 25: confirms the market is trending — filters out choppy, ranging conditions.\n' +
    '• StochRSI %K > 80: momentum is overbought — times a "sell the rip" entry in a downtrend.\n\n' +
    'Direction note: ADX measures strength, not direction. This template enters SHORT. ' +
    'To flip LONG, clone and change: action → enter_long and StochRSI threshold → < 20 (oversold).\n\n' +
    'Multi-timeframe tip: for best results (per ML research, ROC-AUC ~0.61) check that the 1D ' +
    'chart agrees with the 4h direction before trading a clone of this template.',
  symbol:    'BTCUSDT',
  timeframe: '4h',
  entryConditions: [
    {
      id:    'starter_adx_group_1',
      label: 'Strong Trend + Overbought',
      conditions: [
        {
          id:          'starter_adx_cond_adx',
          indicatorId: 'adx',
          params:      { period: 14 },
          seriesIndex: 0,   // ADX value (0-100)
          operator:    'gt',
          value:       25,
          checkMode:   'confirmation',
          checkCandles: 1,
        },
        {
          id:          'starter_adx_cond_stochrsi',
          indicatorId: 'stochrsi',
          params:      { rsiPeriod: 14, stochPeriod: 14, kSmooth: 3, dSmooth: 3 },
          seriesIndex: 0,   // %K (fast line)
          operator:    'gt',
          value:       80,
          checkMode:   'confirmation',
          checkCandles: 1,
        },
      ],
    },
  ],
  exitConditions: [],
  action: { type: 'enter_short', positionSizePct: 10, maxPositions: 1 },
  risk:   { stopLossPct: 2, takeProfitPct: 4 },
};

// ─── Exported list ────────────────────────────────────────────────────────────

export const STARTER_TEMPLATES: Strategy[] = [trendReversal, goldenTrio, adxTrend];
