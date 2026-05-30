/**
 * Starter (pre-defined) strategy templates.
 *
 * These are research-backed blueprints shipped with the app.  They are NOT
 * active strategies — they must be cloned before use.
 *
 * All templates default to BTCUSDT / 4h (Mean Reversion uses 1d) so they
 * can be backtested immediately after cloning.
 *
 * Templates are grouped by direction: LONG (📈) then SHORT (📉).
 *
 * Series index reference:
 *   rsi              [0] RSI value
 *   macd             [0] MACD line  [1] Signal  [2] Histogram  [3] Strategy Signal
 *   bbpct            [0] BB %B  (0=lower band, 1=upper band, >1=above upper)
 *   bb_width         [0] Bandwidth % (low = squeeze)
 *   adx              [0] ADX  [1] +DI  [2] −DI
 *   stochrsi         [0] %K   [1] %D
 *   stochastic       [0] %K   [1] %D
 *   volume_ratio     [0] volume / SMA(volume)
 *   ema_dev          [0] (close − EMA) / EMA × 100
 *   Pattern signals  [0] 0 or 1 (fired on that bar)
 */

import type { Strategy } from '@/types/strategy';

const BASE: Pick<Strategy, 'version' | 'createdAt' | 'updatedAt' | 'isTemplate' | 'isActive'> = {
  version:    1,
  createdAt:  0, // intentionally 0 — gets replaced on first load
  updatedAt:  0,
  isTemplate: true,
  isActive:   false,
};

// ═══════════════════════════════════════════════════════════════════════════════
// ── LONG TEMPLATES (📈) ────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

// ─── L1: Trend-Reversal Powerhouse — LONG ─────────────────────────────────────
//
// Logic: Three White Soldiers signals strong bullish buying pressure. RSI oversold
// confirms the prior move was exhausted. MACD Strategy Signal > 0 confirms the
// trend has flipped bullish (crossover while above the 200 EMA).
// Mirror of the original Trend-Reversal SHORT template.

const trendReversalLong: Strategy = {
  ...BASE,
  id:          'starter_trend_reversal_long',
  name:        'Trend-Reversal Powerhouse',
  longName:    '📈 LONG — Three White Soldiers + RSI oversold + MACD bullish signal',
  description:
    'Bullish reversal combo: Three White Soldiers + RSI oversold + MACD bullish signal.\n\n' +
    '• Three White Soldiers (lookback 3): pattern must have fired on one of the last 3 bars.\n' +
    '• RSI(14) < 30: price was in oversold territory — prior sell-off was exhausted.\n' +
    '• MACD Strategy Signal > 0: bullish MACD crossover confirmed AND close is above the 200 EMA.\n\n' +
    'All three conditions must align before entering long. ' +
    'Mirror of the SHORT "Trend-Reversal Powerhouse" template. ' +
    'Adjust SL/TP to your risk tolerance after cloning.',
  symbol:    'BTCUSDT',
  timeframe: '4h',
  entryConditions: [
    {
      id:    'starter_trl_group_1',
      label: 'Bullish Reversal Setup',
      conditions: [
        {
          id:           'starter_trl_cond_pattern',
          indicatorId:  'three_white_soldiers',
          params:       {},
          seriesIndex:  0,
          operator:     'gt',
          value:        0,
          checkMode:    'lookback',
          checkCandles: 3,
        },
        {
          id:           'starter_trl_cond_rsi',
          indicatorId:  'rsi',
          params:       { period: 14, emaPeriod: 0 },
          seriesIndex:  0,
          operator:     'lt',
          value:        30,
          checkMode:    'confirmation',
          checkCandles: 1,
        },
        {
          id:           'starter_trl_cond_macd',
          indicatorId:  'macd',
          params:       { fast: 12, slow: 26, signal: 9, trendEma: 200 },
          seriesIndex:  3, // Strategy Signal (−1 = bearish, 0 = none, 1 = bullish)
          operator:     'gt',
          value:        0,
          checkMode:    'confirmation',
          checkCandles: 1,
        },
      ],
    },
  ],
  exitConditions: [],
  action: { type: 'enter_long', positionSizePct: 10, maxPositions: 1, entryPriceOffset: { mode: 'pct', value: 2 } },
  risk:   { stopLossPct: 3, takeProfitPct: 6 },
};

// ─── L2: Golden Trio — Volatility + Momentum — LONG ──────────────────────────
//
// Logic: BB %B < 0 means price broke BELOW the lower Bollinger Band (oversold).
// MACD Histogram crosses above 0 = momentum has turned bullish.
// RSI < 30 = oversold confirmation.
// Mirror of the original Golden Trio SHORT template.

const goldenTrioLong: Strategy = {
  ...BASE,
  id:          'starter_golden_trio_long',
  name:        'Golden Trio — Volatility + Momentum',
  longName:    '📈 LONG — BB %B below lower band + MACD bullish crossover + RSI oversold',
  description:
    'Bullish oversold reversal: BB %B + MACD bullish crossover + RSI oversold.\n\n' +
    '• BB %B < 0.0: price has broken below the lower Bollinger Band — statistically overextended to the downside.\n' +
    '• MACD Histogram crosses above 0: momentum has just flipped bullish.\n' +
    '• RSI(14) < 30: confirms oversold exhaustion.\n\n' +
    'Three independent lenses all pointing the same way = high conviction long. ' +
    'Mirror of the SHORT "Golden Trio" template. Adjust SL/TP after cloning.',
  symbol:    'BTCUSDT',
  timeframe: '4h',
  entryConditions: [
    {
      id:    'starter_gtl_group_1',
      label: 'Oversold Reversal',
      conditions: [
        {
          id:           'starter_gtl_cond_bbpct',
          indicatorId:  'bbpct',
          params:       { period: 20, stdDevMult: 2 },
          seriesIndex:  0,   // BB %B — <0.0 means below lower band
          operator:     'lt',
          value:        0.0,
          checkMode:    'confirmation',
          checkCandles: 1,
        },
        {
          id:           'starter_gtl_cond_macd_hist',
          indicatorId:  'macd',
          params:       { fast: 12, slow: 26, signal: 9, trendEma: 200 },
          seriesIndex:  2,   // Histogram — crossing above 0 = bullish crossover
          operator:     'crosses_above',
          value:        0,
          checkMode:    'confirmation',
          checkCandles: 1,
        },
        {
          id:           'starter_gtl_cond_rsi',
          indicatorId:  'rsi',
          params:       { period: 14, emaPeriod: 0 },
          seriesIndex:  0,
          operator:     'lt',
          value:        30,
          checkMode:    'confirmation',
          checkCandles: 1,
        },
      ],
    },
  ],
  exitConditions: [],
  action: { type: 'enter_long', positionSizePct: 10, maxPositions: 1, entryPriceOffset: { mode: 'pct', value: 2 } },
  risk:   { stopLossPct: 2.5, takeProfitPct: 5 },
};

// ─── L3: ADX Trend-Following — LONG ──────────────────────────────────────────
//
// Logic: ADX > 25 confirms a strong trend. StochRSI %K < 20 times the entry
// when momentum has pulled back to oversold inside the trend — a "buy the dip"
// in a strong uptrend. Mirror of the ADX Trend-Following SHORT template.

const adxTrendLong: Strategy = {
  ...BASE,
  id:          'starter_adx_trend_long',
  name:        'ADX Trend-Following',
  longName:    '📈 LONG — ADX strong trend + StochRSI oversold dip',
  description:
    'High-conviction trend entry: ADX(14) > 25 (strong trend) + StochRSI %K < 20 (oversold pullback).\n\n' +
    '• ADX(14) > 25: confirms the market is trending — filters out choppy, ranging conditions.\n' +
    '• StochRSI %K < 20: momentum has pulled back to oversold — times a "buy the dip" entry in an uptrend.\n\n' +
    'Direction note: ADX measures strength, not direction. This template enters LONG. ' +
    'To flip SHORT, clone and change: action → enter_short and StochRSI threshold → > 80 (overbought).\n\n' +
    'Mirror of the SHORT "ADX Trend-Following" template.',
  symbol:    'BTCUSDT',
  timeframe: '4h',
  entryConditions: [
    {
      id:    'starter_adxl_group_1',
      label: 'Strong Trend + Oversold',
      conditions: [
        {
          id:           'starter_adxl_cond_adx',
          indicatorId:  'adx',
          params:       { period: 14 },
          seriesIndex:  0,
          operator:     'gt',
          value:        25,
          checkMode:    'confirmation',
          checkCandles: 1,
        },
        {
          id:           'starter_adxl_cond_stochrsi',
          indicatorId:  'stochrsi',
          params:       { rsiPeriod: 14, stochPeriod: 14, kSmooth: 3, dSmooth: 3 },
          seriesIndex:  0,   // %K (fast line)
          operator:     'lt',
          value:        20,
          checkMode:    'confirmation',
          checkCandles: 1,
        },
      ],
    },
  ],
  exitConditions: [],
  action: { type: 'enter_long', positionSizePct: 10, maxPositions: 1, entryPriceOffset: { mode: 'pct', value: 2 } },
  risk:   { stopLossPct: 2, takeProfitPct: 4 },
};

// ─── L4: Volatility Squeeze — LONG ───────────────────────────────────────────
//
// Logic: detect a Bollinger Bands squeeze (bands very narrow = coiling market).
// Wait for RSI to cross above 50 (bulls taking control) while the squeeze is
// still fresh (lookback 5 bars). Confirm breakout with BB %B > 0.9 (price at
// upper band) AND a volume spike (volume_ratio > 1.5).

const volatilitySqueezeL: Strategy = {
  ...BASE,
  id:          'starter_volatility_squeeze_long',
  name:        'Volatility Squeeze',
  longName:    '📈 LONG — BB squeeze breakout + RSI momentum + volume confirmation',
  description:
    'Predicts high-momentum bullish breakouts from low-volatility squeezes.\n\n' +
    '• BB Width(20,2) < 4.0 (lookback 5 bars): bands were in a squeeze recently — market was coiling.\n' +
    '• RSI(14) crosses above 50: momentum shifts to bullish mid-squeeze.\n' +
    '• BB %B(20,2) ≥ 0.9: price is at or breaking above the upper band.\n' +
    '• Volume Ratio(20) > 1.5: volume spiked — breakout has real participation.\n\n' +
    'All four conditions align to confirm: the spring has released upward. ' +
    'Adjust BB Width threshold after backtesting on your symbol/timeframe.',
  symbol:    'BTCUSDT',
  timeframe: '4h',
  entryConditions: [
    {
      id:    'starter_vsql_group_1',
      label: 'Squeeze Breakout Setup',
      conditions: [
        {
          id:           'starter_vsql_cond_bbw',
          indicatorId:  'bb_width',
          params:       { period: 20, stdDevMult: 2 },
          seriesIndex:  0,
          operator:     'lt',
          value:        4.0,
          checkMode:    'lookback',
          checkCandles: 5,
        },
        {
          id:           'starter_vsql_cond_rsi',
          indicatorId:  'rsi',
          params:       { period: 14, emaPeriod: 0 },
          seriesIndex:  0,
          operator:     'crosses_above',
          value:        50,
          checkMode:    'confirmation',
          checkCandles: 1,
        },
        {
          id:           'starter_vsql_cond_bbpct',
          indicatorId:  'bbpct',
          params:       { period: 20, stdDevMult: 2 },
          seriesIndex:  0,
          operator:     'gte',
          value:        0.9,
          checkMode:    'confirmation',
          checkCandles: 1,
        },
        {
          id:           'starter_vsql_cond_vol',
          indicatorId:  'volume_ratio',
          params:       { period: 20 },
          seriesIndex:  0,
          operator:     'gt',
          value:        1.5,
          checkMode:    'confirmation',
          checkCandles: 1,
        },
      ],
    },
  ],
  exitConditions: [],
  action: { type: 'enter_long', positionSizePct: 10, maxPositions: 1, entryPriceOffset: { mode: 'pct', value: 2 } },
  risk:   { stopLossPct: 2.5, takeProfitPct: 5 },
};

// ─── L5: Trend-Strength Sniper — LONG ────────────────────────────────────────
//
// Logic: ADX > 25 confirms a real trend (not choppy sideways noise).
// MACD Histogram crosses above 0 = momentum just flipped bullish.
// Bullish Engulfing (lookback 2) provides the exact price-action anchor candle.

const trendSniperL: Strategy = {
  ...BASE,
  id:          'starter_trend_sniper_long',
  name:        'Trend-Strength Sniper',
  longName:    '📈 LONG — ADX trend power + MACD momentum + Bullish Engulfing anchor',
  description:
    'Ensures you\'re not buying into a ranging market by combining trend strength, ' +
    'momentum direction, and a price-action anchor.\n\n' +
    '• ADX(14) > 25: trend is real — filters out sideways chop (below 20 = do not trade).\n' +
    '• MACD Histogram crosses above 0: bullish momentum crossover — direction confirmed.\n' +
    '• Bullish Engulfing (lookback 2): a large green candle swallowed the previous red candle ' +
    'in the last 2 bars — provides the exact entry anchor.\n\n' +
    'ADX = "is the move real?", MACD = "what direction?", Engulfing = "exact entry bar."',
  symbol:    'BTCUSDT',
  timeframe: '4h',
  entryConditions: [
    {
      id:    'starter_tsl_group_1',
      label: 'Trend + Momentum + Pattern',
      conditions: [
        {
          id:           'starter_tsl_cond_adx',
          indicatorId:  'adx',
          params:       { period: 14 },
          seriesIndex:  0,
          operator:     'gt',
          value:        25,
          checkMode:    'confirmation',
          checkCandles: 1,
        },
        {
          id:           'starter_tsl_cond_macd',
          indicatorId:  'macd',
          params:       { fast: 12, slow: 26, signal: 9, trendEma: 200 },
          seriesIndex:  2,   // Histogram — crosses above 0 = bullish crossover
          operator:     'crosses_above',
          value:        0,
          checkMode:    'confirmation',
          checkCandles: 1,
        },
        {
          id:           'starter_tsl_cond_engulf',
          indicatorId:  'bullish_engulfing',
          params:       {},
          seriesIndex:  0,
          operator:     'gt',
          value:        0,
          checkMode:    'lookback',
          checkCandles: 2,
        },
      ],
    },
  ],
  exitConditions: [],
  action: { type: 'enter_long', positionSizePct: 10, maxPositions: 1, entryPriceOffset: { mode: 'pct', value: 2 } },
  risk:   { stopLossPct: 3, takeProfitPct: 7 },
};

// ─── L6: Mean Reversion — LONG ────────────────────────────────────────────────
//
// Logic: price has stretched far below its 200-period EMA (ema_dev < -5%).
// Stochastic %K < 20 confirms short-term oversold exhaustion.
// Hammer pattern (lookback 2) shows rejection of lower prices — buyers absorbing.
// Combined: structural oversold + momentum exhaustion + reversal candle.

const meanReversionL: Strategy = {
  ...BASE,
  id:          'starter_mean_reversion_long',
  name:        'Mean Reversion',
  longName:    '📈 LONG — Price far below 200 EMA + Stochastic oversold + Hammer',
  description:
    'Predicts snap-back rallies when price is stretched too far below long-term fair value.\n\n' +
    'Entry group (all AND):\n' +
    '• Stochastic %K(14) < 20: short-term price is oversold — exhaustion of sellers.\n' +
    '• Hammer (lookback 2): long-wick reversal candle seen in last 2 bars — buyers absorbing sells.\n\n' +
    'AND filter (must also pass):\n' +
    '• EMA Deviation(200) < -5%: price is ≥ 5% below the 200-period EMA — genuinely stretched.\n\n' +
    'Best on daily timeframe. Snap-back target: back toward the 200 EMA. ' +
    'Adjust the -5% threshold tighter (-8%) for lower-volatility assets.',
  symbol:    'BTCUSDT',
  timeframe: '1d',
  entryConditions: [
    {
      id:                'starter_mrl_group_1',
      label:             'Oversold + Reversal Candle',
      operator:          'or',
      conditionOperator: 'and',
      conditions: [
        {
          id:           'starter_mrl_cond_stoch',
          indicatorId:  'stochastic',
          params:       { period: 14, kSmooth: 3, dPeriod: 3 },
          seriesIndex:  0,   // %K
          operator:     'lt',
          value:        20,
          checkMode:    'confirmation',
          checkCandles: 1,
        },
        {
          id:           'starter_mrl_cond_hammer',
          indicatorId:  'hammer',
          params:       {},
          seriesIndex:  0,
          operator:     'gt',
          value:        0,
          checkMode:    'lookback',
          checkCandles: 2,
        },
      ],
    },
    {
      id:                'starter_mrl_group_2',
      label:             'Below 200 EMA Filter',
      operator:          'and',
      conditionOperator: 'or',
      conditions: [
        {
          id:           'starter_mrl_cond_emad',
          indicatorId:  'ema_dev',
          params:       { period: 200 },
          seriesIndex:  0,
          operator:     'lt',
          value:        -5,
          checkMode:    'confirmation',
          checkCandles: 1,
        },
      ],
    },
  ],
  exitConditions: [],
  action: { type: 'enter_long', positionSizePct: 10, maxPositions: 1, entryPriceOffset: { mode: 'pct', value: 2 } },
  risk:   { stopLossPct: 3, takeProfitPct: 8 },
};

// ═══════════════════════════════════════════════════════════════════════════════
// ── SHORT TEMPLATES (📉) ───────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

// ─── S1: Trend-Reversal Powerhouse — SHORT ────────────────────────────────────
// (original template — kept as-is, just updated name/longName for direction grouping)

const trendReversal: Strategy = {
  ...BASE,
  id:          'starter_trend_reversal',
  name:        'Trend-Reversal Powerhouse',
  longName:    '📉 SHORT — Three Crows + RSI overbought + MACD bearish signal',
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
          id:           'starter_tr_cond_pattern',
          indicatorId:  'identical_three_crows',
          params:       {},
          seriesIndex:  0,
          operator:     'gt',
          value:        0,
          checkMode:    'lookback',
          checkCandles: 3,
        },
        {
          id:           'starter_tr_cond_rsi',
          indicatorId:  'rsi',
          params:       { period: 14, emaPeriod: 0 },
          seriesIndex:  0,
          operator:     'gt',
          value:        70,
          checkMode:    'confirmation',
          checkCandles: 1,
        },
        {
          id:           'starter_tr_cond_macd',
          indicatorId:  'macd',
          params:       { fast: 12, slow: 26, signal: 9, trendEma: 200 },
          seriesIndex:  3,
          operator:     'lt',
          value:        0,
          checkMode:    'confirmation',
          checkCandles: 1,
        },
      ],
    },
  ],
  exitConditions: [],
  action: { type: 'enter_short', positionSizePct: 10, maxPositions: 1, entryPriceOffset: { mode: 'pct', value: 2 } },
  risk:   { stopLossPct: 3, takeProfitPct: 6 },
};

// ─── S2: Golden Trio — Volatility + Momentum — SHORT ─────────────────────────
// (original template — kept as-is, updated longName)

const goldenTrio: Strategy = {
  ...BASE,
  id:          'starter_golden_trio',
  name:        'Golden Trio — Volatility + Momentum',
  longName:    '📉 SHORT — BB %B above upper band + MACD bearish crossover + RSI overbought',
  description:
    'Bearish overbought reversal: BB %B + MACD bearish crossover + RSI overbought.\n\n' +
    '• BB %B > 1.0: price has broken above the upper Bollinger Band — statistically overextended.\n' +
    '• MACD Histogram crosses below 0: momentum has just flipped bearish.\n' +
    '• RSI(14) > 70: confirms overbought exhaustion.\n\n' +
    'Three independent lenses all pointing the same way = high conviction short. ' +
    'Adjust SL/TP after cloning.',
  symbol:    'BTCUSDT',
  timeframe: '4h',
  entryConditions: [
    {
      id:    'starter_gt_group_1',
      label: 'Overbought Reversal',
      conditions: [
        {
          id:           'starter_gt_cond_bbpct',
          indicatorId:  'bbpct',
          params:       { period: 20, stdDevMult: 2 },
          seriesIndex:  0,
          operator:     'gt',
          value:        1.0,
          checkMode:    'confirmation',
          checkCandles: 1,
        },
        {
          id:           'starter_gt_cond_macd_hist',
          indicatorId:  'macd',
          params:       { fast: 12, slow: 26, signal: 9, trendEma: 200 },
          seriesIndex:  2,
          operator:     'crosses_below',
          value:        0,
          checkMode:    'confirmation',
          checkCandles: 1,
        },
        {
          id:           'starter_gt_cond_rsi',
          indicatorId:  'rsi',
          params:       { period: 14, emaPeriod: 0 },
          seriesIndex:  0,
          operator:     'gt',
          value:        70,
          checkMode:    'confirmation',
          checkCandles: 1,
        },
      ],
    },
  ],
  exitConditions: [],
  action: { type: 'enter_short', positionSizePct: 10, maxPositions: 1, entryPriceOffset: { mode: 'pct', value: 2 } },
  risk:   { stopLossPct: 2.5, takeProfitPct: 5 },
};

// ─── S3: ADX Trend-Following — SHORT ─────────────────────────────────────────
// (original template — kept as-is, updated longName)

const adxTrend: Strategy = {
  ...BASE,
  id:          'starter_adx_trend',
  name:        'ADX Trend-Following',
  longName:    '📉 SHORT — ADX strong trend + StochRSI overbought rip',
  description:
    'High-conviction trend entry: ADX(14) > 25 (strong trend) + StochRSI %K > 80 (overbought momentum).\n\n' +
    '• ADX(14) > 25: confirms the market is trending — filters out choppy, ranging conditions.\n' +
    '• StochRSI %K > 80: momentum is overbought — times a "sell the rip" entry in a downtrend.\n\n' +
    'Direction note: ADX measures strength, not direction. This template enters SHORT. ' +
    'To flip LONG, clone and change: action → enter_long and StochRSI threshold → < 20 (oversold).\n\n' +
    'Multi-timeframe tip: for best results check that the 1D chart agrees with the 4h direction.',
  symbol:    'BTCUSDT',
  timeframe: '4h',
  entryConditions: [
    {
      id:    'starter_adx_group_1',
      label: 'Strong Trend + Overbought',
      conditions: [
        {
          id:           'starter_adx_cond_adx',
          indicatorId:  'adx',
          params:       { period: 14 },
          seriesIndex:  0,
          operator:     'gt',
          value:        25,
          checkMode:    'confirmation',
          checkCandles: 1,
        },
        {
          id:           'starter_adx_cond_stochrsi',
          indicatorId:  'stochrsi',
          params:       { rsiPeriod: 14, stochPeriod: 14, kSmooth: 3, dSmooth: 3 },
          seriesIndex:  0,
          operator:     'gt',
          value:        80,
          checkMode:    'confirmation',
          checkCandles: 1,
        },
      ],
    },
  ],
  exitConditions: [],
  action: { type: 'enter_short', positionSizePct: 10, maxPositions: 1, entryPriceOffset: { mode: 'pct', value: 2 } },
  risk:   { stopLossPct: 2, takeProfitPct: 4 },
};

// ─── S4: Volatility Squeeze — SHORT ──────────────────────────────────────────
//
// Mirror of L4: same squeeze detection, but RSI crosses BELOW 50 (bears taking
// control), BB %B breaks below 0.1 (lower band), and volume confirms.

const volatilitySqueezeS: Strategy = {
  ...BASE,
  id:          'starter_volatility_squeeze_short',
  name:        'Volatility Squeeze',
  longName:    '📉 SHORT — BB squeeze breakdown + RSI momentum + volume confirmation',
  description:
    'Predicts high-momentum bearish breakdowns from low-volatility squeezes.\n\n' +
    '• BB Width(20,2) < 4.0 (lookback 5 bars): bands were in a squeeze recently — market was coiling.\n' +
    '• RSI(14) crosses below 50: momentum shifts to bearish mid-squeeze.\n' +
    '• BB %B(20,2) ≤ 0.1: price is at or breaking below the lower band.\n' +
    '• Volume Ratio(20) > 1.5: volume spiked — breakdown has real participation.\n\n' +
    'Mirror of the LONG "Volatility Squeeze" template. ' +
    'Adjust BB Width threshold after backtesting.',
  symbol:    'BTCUSDT',
  timeframe: '4h',
  entryConditions: [
    {
      id:    'starter_vsqs_group_1',
      label: 'Squeeze Breakdown Setup',
      conditions: [
        {
          id:           'starter_vsqs_cond_bbw',
          indicatorId:  'bb_width',
          params:       { period: 20, stdDevMult: 2 },
          seriesIndex:  0,
          operator:     'lt',
          value:        4.0,
          checkMode:    'lookback',
          checkCandles: 5,
        },
        {
          id:           'starter_vsqs_cond_rsi',
          indicatorId:  'rsi',
          params:       { period: 14, emaPeriod: 0 },
          seriesIndex:  0,
          operator:     'crosses_below',
          value:        50,
          checkMode:    'confirmation',
          checkCandles: 1,
        },
        {
          id:           'starter_vsqs_cond_bbpct',
          indicatorId:  'bbpct',
          params:       { period: 20, stdDevMult: 2 },
          seriesIndex:  0,
          operator:     'lte',
          value:        0.1,
          checkMode:    'confirmation',
          checkCandles: 1,
        },
        {
          id:           'starter_vsqs_cond_vol',
          indicatorId:  'volume_ratio',
          params:       { period: 20 },
          seriesIndex:  0,
          operator:     'gt',
          value:        1.5,
          checkMode:    'confirmation',
          checkCandles: 1,
        },
      ],
    },
  ],
  exitConditions: [],
  action: { type: 'enter_short', positionSizePct: 10, maxPositions: 1, entryPriceOffset: { mode: 'pct', value: 2 } },
  risk:   { stopLossPct: 2.5, takeProfitPct: 5 },
};

// ─── S5: Trend-Strength Sniper — SHORT ───────────────────────────────────────
//
// Mirror of L5: ADX strength filter + MACD histogram crosses BELOW 0 (bearish)
// + Bearish Engulfing pattern as the price-action anchor.

const trendSniperS: Strategy = {
  ...BASE,
  id:          'starter_trend_sniper_short',
  name:        'Trend-Strength Sniper',
  longName:    '📉 SHORT — ADX trend power + MACD momentum + Bearish Engulfing anchor',
  description:
    'Ensures you\'re not shorting into a ranging market by combining trend strength, ' +
    'momentum direction, and a price-action anchor.\n\n' +
    '• ADX(14) > 25: trend is real — filters out sideways chop.\n' +
    '• MACD Histogram crosses below 0: bearish momentum crossover — direction confirmed.\n' +
    '• Bearish Engulfing (lookback 2): a large red candle swallowed the previous green candle ' +
    'in the last 2 bars — exact entry anchor.\n\n' +
    'Mirror of the LONG "Trend-Strength Sniper" template.',
  symbol:    'BTCUSDT',
  timeframe: '4h',
  entryConditions: [
    {
      id:    'starter_tss_group_1',
      label: 'Trend + Momentum + Pattern',
      conditions: [
        {
          id:           'starter_tss_cond_adx',
          indicatorId:  'adx',
          params:       { period: 14 },
          seriesIndex:  0,
          operator:     'gt',
          value:        25,
          checkMode:    'confirmation',
          checkCandles: 1,
        },
        {
          id:           'starter_tss_cond_macd',
          indicatorId:  'macd',
          params:       { fast: 12, slow: 26, signal: 9, trendEma: 200 },
          seriesIndex:  2,
          operator:     'crosses_below',
          value:        0,
          checkMode:    'confirmation',
          checkCandles: 1,
        },
        {
          id:           'starter_tss_cond_engulf',
          indicatorId:  'bearish_engulfing',
          params:       {},
          seriesIndex:  0,
          operator:     'gt',
          value:        0,
          checkMode:    'lookback',
          checkCandles: 2,
        },
      ],
    },
  ],
  exitConditions: [],
  action: { type: 'enter_short', positionSizePct: 10, maxPositions: 1, entryPriceOffset: { mode: 'pct', value: 2 } },
  risk:   { stopLossPct: 3, takeProfitPct: 7 },
};

// ─── S6: Mean Reversion — SHORT ───────────────────────────────────────────────
//
// Mirror of L6: price stretched far ABOVE 200 EMA (ema_dev > +5%), Stochastic
// %K > 80 (overbought), Shooting Star (lookback 2) confirms rejection at highs.

const meanReversionS: Strategy = {
  ...BASE,
  id:          'starter_mean_reversion_short',
  name:        'Mean Reversion',
  longName:    '📉 SHORT — Price far above 200 EMA + Stochastic overbought + Shooting Star',
  description:
    'Predicts snap-back pullbacks when price is stretched too far above long-term fair value.\n\n' +
    'Entry group (all AND):\n' +
    '• Stochastic %K(14) > 80: short-term price is overbought — exhaustion of buyers.\n' +
    '• Shooting Star (lookback 2): long upper wick rejection candle seen in last 2 bars — sellers overwhelming buyers.\n\n' +
    'AND filter (must also pass):\n' +
    '• EMA Deviation(200) > +5%: price is ≥ 5% above the 200-period EMA — genuinely extended.\n\n' +
    'Best on daily timeframe. Snap-back target: back toward the 200 EMA. ' +
    'Mirror of the LONG "Mean Reversion" template.',
  symbol:    'BTCUSDT',
  timeframe: '1d',
  entryConditions: [
    {
      id:                'starter_mrs_group_1',
      label:             'Overbought + Rejection Candle',
      operator:          'or',
      conditionOperator: 'and',
      conditions: [
        {
          id:           'starter_mrs_cond_stoch',
          indicatorId:  'stochastic',
          params:       { period: 14, kSmooth: 3, dPeriod: 3 },
          seriesIndex:  0,
          operator:     'gt',
          value:        80,
          checkMode:    'confirmation',
          checkCandles: 1,
        },
        {
          id:           'starter_mrs_cond_star',
          indicatorId:  'shooting_star',
          params:       {},
          seriesIndex:  0,
          operator:     'gt',
          value:        0,
          checkMode:    'lookback',
          checkCandles: 2,
        },
      ],
    },
    {
      id:                'starter_mrs_group_2',
      label:             'Above 200 EMA Filter',
      operator:          'and',
      conditionOperator: 'or',
      conditions: [
        {
          id:           'starter_mrs_cond_emad',
          indicatorId:  'ema_dev',
          params:       { period: 200 },
          seriesIndex:  0,
          operator:     'gt',
          value:        5,
          checkMode:    'confirmation',
          checkCandles: 1,
        },
      ],
    },
  ],
  exitConditions: [],
  action: { type: 'enter_short', positionSizePct: 10, maxPositions: 1, entryPriceOffset: { mode: 'pct', value: 2 } },
  risk:   { stopLossPct: 3, takeProfitPct: 8 },
};

// ─── L7: MACD Cross + Trend Filter — LONG ─────────────────────────────────────
//
// Standalone, minimal version of the classic MACD-with-trend-filter setup
// (formerly baked into the MACD indicator as "Strategy Signal").
//
// Three conditions must align:
//  • MACD Histogram crosses above 0 — MACD line crossed signal line from below.
//  • MACD Line ≤ 0 at the cross    — the cross happened in bearish territory,
//                                     so this is a reversal signal not a
//                                     continuation pop.
//  • EMA Dev(200) > 0              — close is above the 200-period EMA, i.e.
//                                     structural uptrend bias is intact.

const macdCrossTrendLong: Strategy = {
  ...BASE,
  id:          'starter_macd_cross_trend_long',
  name:        'MACD Cross + Trend Filter',
  longName:    '📈 LONG — MACD bullish cross below zero + price above 200 EMA',
  description:
    'Classic MACD reversal setup with a 200-EMA trend filter. Enters when MACD ' +
    'momentum flips bullish from below zero while the larger trend still leans up.\n\n' +
    '• MACD Histogram crosses above 0: MACD line crossed up through the signal line.\n' +
    '• MACD Line ≤ 0: the cross happened below zero (reversal, not continuation).\n' +
    '• EMA Dev(200) > 0: close is above the 200-period EMA — uptrend bias confirmed.\n\n' +
    'Mirror of the SHORT "MACD Cross + Trend Filter" template. ' +
    'Best used as a building block — pair with your own pattern or volume filter.',
  symbol:    'BTCUSDT',
  timeframe: '4h',
  entryConditions: [
    {
      id:    'starter_mctl_group_1',
      label: 'Bullish Cross + Uptrend',
      conditions: [
        {
          id:           'starter_mctl_cond_hist',
          indicatorId:  'macd',
          params:       { fast: 12, slow: 26, signal: 9, trendEma: 200 },
          seriesIndex:  2,  // Histogram — crosses above 0 = bullish MACD cross
          operator:     'crosses_above',
          value:        0,
          checkMode:    'confirmation',
          checkCandles: 1,
        },
        {
          id:           'starter_mctl_cond_macd_below_zero',
          indicatorId:  'macd',
          params:       { fast: 12, slow: 26, signal: 9, trendEma: 200 },
          seriesIndex:  0,  // MACD Line — must be ≤ 0 when the cross happens
          operator:     'lte',
          value:        0,
          checkMode:    'confirmation',
          checkCandles: 1,
        },
        {
          id:           'starter_mctl_cond_trend',
          indicatorId:  'ema_dev',
          params:       { period: 200 },
          seriesIndex:  0,  // EMA Dev % — > 0 = close above 200 EMA
          operator:     'gt',
          value:        0,
          checkMode:    'confirmation',
          checkCandles: 1,
        },
      ],
    },
  ],
  exitConditions: [],
  action: { type: 'enter_long', positionSizePct: 10, maxPositions: 1, entryPriceOffset: { mode: 'pct', value: 2 } },
  risk:   { stopLossPct: 2.5, takeProfitPct: 5 },
};

// ─── S7: MACD Cross + Trend Filter — SHORT ────────────────────────────────────
// Mirror of L7: bearish cross from above zero, with price below the 200 EMA.

const macdCrossTrendShort: Strategy = {
  ...BASE,
  id:          'starter_macd_cross_trend_short',
  name:        'MACD Cross + Trend Filter',
  longName:    '📉 SHORT — MACD bearish cross above zero + price below 200 EMA',
  description:
    'Classic MACD reversal setup with a 200-EMA trend filter. Enters when MACD ' +
    'momentum flips bearish from above zero while the larger trend still leans down.\n\n' +
    '• MACD Histogram crosses below 0: MACD line crossed down through the signal line.\n' +
    '• MACD Line ≥ 0: the cross happened above zero (reversal, not continuation).\n' +
    '• EMA Dev(200) < 0: close is below the 200-period EMA — downtrend bias confirmed.\n\n' +
    'Mirror of the LONG "MACD Cross + Trend Filter" template. ' +
    'Best used as a building block — pair with your own pattern or volume filter.',
  symbol:    'BTCUSDT',
  timeframe: '4h',
  entryConditions: [
    {
      id:    'starter_mcts_group_1',
      label: 'Bearish Cross + Downtrend',
      conditions: [
        {
          id:           'starter_mcts_cond_hist',
          indicatorId:  'macd',
          params:       { fast: 12, slow: 26, signal: 9, trendEma: 200 },
          seriesIndex:  2,
          operator:     'crosses_below',
          value:        0,
          checkMode:    'confirmation',
          checkCandles: 1,
        },
        {
          id:           'starter_mcts_cond_macd_above_zero',
          indicatorId:  'macd',
          params:       { fast: 12, slow: 26, signal: 9, trendEma: 200 },
          seriesIndex:  0,
          operator:     'gte',
          value:        0,
          checkMode:    'confirmation',
          checkCandles: 1,
        },
        {
          id:           'starter_mcts_cond_trend',
          indicatorId:  'ema_dev',
          params:       { period: 200 },
          seriesIndex:  0,
          operator:     'lt',
          value:        0,
          checkMode:    'confirmation',
          checkCandles: 1,
        },
      ],
    },
  ],
  exitConditions: [],
  action: { type: 'enter_short', positionSizePct: 10, maxPositions: 1, entryPriceOffset: { mode: 'pct', value: 2 } },
  risk:   { stopLossPct: 2.5, takeProfitPct: 5 },
};

// ─── L8: VP Value Area Low Bounce — LONG ──────────────────────────────────────
//
// Mean-reversion long: price has pulled back INTO the Value Area Low (dist ≥ −0.5%)
// and is close to it (dist ≤ 0.5%), meaning we're trading near the VAL.
// POC is above the current price (dist_from_poc_pct > 0) — upside target.
// ADX confirms no strong downtrend (< 35) so we're in a ranging / rotational market.

const vpValBounceLong: Strategy = {
  ...BASE,
  id:          'starter_vp_val_bounce_long',
  name:        'VP VAL Bounce',
  longName:    '📈 LONG — Price near Value Area Low + POC above + Rotational market',
  description:
    'Volume Profile mean-reversion long: price has dropped to the Value Area Low, ' +
    'where prior session volume concentrations create a natural support floor.\n\n' +
    '• VP Dist from VAL ≥ −0.5%: price is at or just below the VAL (entered the zone).\n' +
    '• VP Dist from VAL ≤ 0.5%: price is not too far above the VAL yet.\n' +
    '• VP Dist from POC > 0: POC is above current price — mean-reversion upside intact.\n' +
    '• ADX(14) < 35: market is not in a strong directional trend — rotation context.\n\n' +
    'Target: reversion toward POC. Limit entry 0.5% below signal (tighten into the zone). ' +
    'Reduce lookback to 50–100 bars for intraday sessions; 200 is good for daily ranges.',
  symbol:    'BTCUSDT',
  timeframe: '1h',
  entryConditions: [
    {
      id:    'starter_vpvbl_group_1',
      label: 'VAL Support Zone',
      conditions: [
        {
          id:           'starter_vpvbl_cond_val_low',
          indicatorId:  'volume_profile',
          params:       { lookback: 200, bins: 50, valueAreaPct: 70 },
          seriesIndex:  5,   // dist_from_val_pct: negative = below VAL
          operator:     'gte',
          value:        -0.5,
          checkMode:    'confirmation',
          checkCandles: 1,
        },
        {
          id:           'starter_vpvbl_cond_val_high',
          indicatorId:  'volume_profile',
          params:       { lookback: 200, bins: 50, valueAreaPct: 70 },
          seriesIndex:  5,   // dist_from_val_pct: close to VAL but not too far above
          operator:     'lte',
          value:        0.5,
          checkMode:    'confirmation',
          checkCandles: 1,
        },
        {
          id:           'starter_vpvbl_cond_poc_above',
          indicatorId:  'volume_profile',
          params:       { lookback: 200, bins: 50, valueAreaPct: 70 },
          seriesIndex:  4,   // dist_from_poc_pct > 0 means POC above price
          operator:     'gt',
          value:        0,
          checkMode:    'confirmation',
          checkCandles: 1,
        },
        {
          id:           'starter_vpvbl_cond_adx',
          indicatorId:  'adx',
          params:       { period: 14 },
          seriesIndex:  0,
          operator:     'lt',
          value:        35,
          checkMode:    'confirmation',
          checkCandles: 1,
        },
      ],
    },
  ],
  exitConditions: [],
  action: { type: 'enter_long', positionSizePct: 10, maxPositions: 1, entryPriceOffset: { mode: 'pct', value: 0.5 } },
  risk:   { stopLossPct: 1.5, takeProfitPct: 2.5 },
};

// ─── S8: VP Value Area High Rotation — SHORT ───────────────────────────────────
//
// Mean-reversion short: mirror of the VAL bounce. Price has pushed to the Value
// Area High (dist ≤ 0.5%) where supply concentrations cap the move.
// POC is below (dist_from_poc_pct < 0) — downside reversion target.

const vpVahRotationShort: Strategy = {
  ...BASE,
  id:          'starter_vp_vah_rotation_short',
  name:        'VP VAH Rotation',
  longName:    '📉 SHORT — Price near Value Area High + POC below + Rotational market',
  description:
    'Volume Profile mean-reversion short: price has rallied to the Value Area High, ' +
    'where prior session volume concentrations create a natural resistance ceiling.\n\n' +
    '• VP Dist from VAH ≤ 0.5%: price is at or just above the VAH (entered the zone).\n' +
    '• VP Dist from VAH ≥ −0.5%: price is not too far below the VAH yet.\n' +
    '• VP Dist from POC < 0: POC is below current price — mean-reversion downside intact.\n' +
    '• ADX(14) < 35: rotational / ranging market context.\n\n' +
    'Target: reversion toward POC. Limit entry 0.5% above signal. ' +
    'Mirror of the LONG "VP VAL Bounce" template.',
  symbol:    'BTCUSDT',
  timeframe: '1h',
  entryConditions: [
    {
      id:    'starter_vpvrs_group_1',
      label: 'VAH Resistance Zone',
      conditions: [
        {
          id:           'starter_vpvrs_cond_vah_high',
          indicatorId:  'volume_profile',
          params:       { lookback: 200, bins: 50, valueAreaPct: 70 },
          seriesIndex:  3,   // dist_from_vah_pct: positive = above VAH, close to it
          operator:     'lte',
          value:        0.5,
          checkMode:    'confirmation',
          checkCandles: 1,
        },
        {
          id:           'starter_vpvrs_cond_vah_low',
          indicatorId:  'volume_profile',
          params:       { lookback: 200, bins: 50, valueAreaPct: 70 },
          seriesIndex:  3,   // dist_from_vah_pct: not too far below VAH
          operator:     'gte',
          value:        -0.5,
          checkMode:    'confirmation',
          checkCandles: 1,
        },
        {
          id:           'starter_vpvrs_cond_poc_below',
          indicatorId:  'volume_profile',
          params:       { lookback: 200, bins: 50, valueAreaPct: 70 },
          seriesIndex:  4,   // dist_from_poc_pct < 0 means POC below price
          operator:     'lt',
          value:        0,
          checkMode:    'confirmation',
          checkCandles: 1,
        },
        {
          id:           'starter_vpvrs_cond_adx',
          indicatorId:  'adx',
          params:       { period: 14 },
          seriesIndex:  0,
          operator:     'lt',
          value:        35,
          checkMode:    'confirmation',
          checkCandles: 1,
        },
      ],
    },
  ],
  exitConditions: [],
  action: { type: 'enter_short', positionSizePct: 10, maxPositions: 1, entryPriceOffset: { mode: 'pct', value: 0.5 } },
  risk:   { stopLossPct: 1.5, takeProfitPct: 2.5 },
};

// ─── L9: ICT Silver Bullet — LONG ─────────────────────────────────────────────
//
// ICT "Silver Bullet" concept: a bullish liquidity sweep (stop hunt below a
// swing low) followed by a bullish Fair Value Gap on a lower timeframe creates
// a high-probability long entry.  We model this on a single timeframe by
// requiring BOTH conditions within a 3-bar lookback window.
//
// Logic:
//  • Bullish Liquidity Sweep fires within the last 3 bars: price swept below a
//    20-bar swing low and closed back above it — sell-side liquidity taken.
//  • Bullish FVG fires within the last 3 bars: a 3-candle demand imbalance is
//    present — price should retrace into the gap before continuing up.
//  • EMA Dev(50) > 0: close is above the 50-period EMA — short-term uptrend
//    context for the reversal.
//
// Entry: limit order 1% below signal close (wait for FVG fill).
// Recommended: apply on 15m–1h charts for the original "Silver Bullet" windows
// (02:00–04:00, 10:00–11:00, 14:00–16:00 NY time).

const ictSilverBulletLong: Strategy = {
  ...BASE,
  id:          'starter_ict_silver_bullet_long',
  name:        'ICT Silver Bullet',
  longName:    '📈 LONG — Bullish Liquidity Sweep + Bullish FVG + Above 50 EMA',
  description:
    'ICT Silver Bullet long setup: institutional stop hunt below swing lows followed ' +
    'by a Fair Value Gap (demand imbalance). Enter as price retraces into the gap.\n\n' +
    '• Bullish Liquidity Sweep (lookback 3): a prior swing low (20-bar) was swept ' +
    'and price closed back above it — sell-side stops collected, smart money long.\n' +
    '• Bullish FVG (lookback 3): three-candle demand gap present — entry target zone.\n' +
    '• EMA Dev(50) > 0: short-term trend bias is up.\n\n' +
    'Limit entry 1% below signal (targets the FVG zone fill). ' +
    'Best on 15m–1h; pair with time-of-day awareness for true Silver Bullet windows.',
  symbol:    'BTCUSDT',
  timeframe: '1h',
  entryConditions: [
    {
      id:    'starter_isbl_group_1',
      label: 'Liquidity Sweep + FVG Demand',
      conditions: [
        {
          id:           'starter_isbl_cond_sweep',
          indicatorId:  'bullish_liquidity_sweep',
          params:       { lookback: 20, minWickPct: 0.05 },
          seriesIndex:  0,
          operator:     'gt',
          value:        0,
          checkMode:    'lookback',
          checkCandles: 3,
        },
        {
          id:           'starter_isbl_cond_fvg',
          indicatorId:  'bullish_fvg',
          params:       { minGapPct: 0.1 },
          seriesIndex:  0,
          operator:     'gt',
          value:        0,
          checkMode:    'lookback',
          checkCandles: 3,
        },
        {
          id:           'starter_isbl_cond_trend',
          indicatorId:  'ema_dev',
          params:       { period: 50 },
          seriesIndex:  0,
          operator:     'gt',
          value:        0,
          checkMode:    'confirmation',
          checkCandles: 1,
        },
      ],
    },
  ],
  exitConditions: [],
  action: { type: 'enter_long', positionSizePct: 10, maxPositions: 1, entryPriceOffset: { mode: 'pct', value: 1 } },
  risk:   { stopLossPct: 1.5, takeProfitPct: 3 },
};

// ─── S8: ICT Silver Bullet — SHORT ────────────────────────────────────────────
//
// Mirror of the long: bearish sweep of highs + bearish FVG + below 50 EMA.

const ictSilverBulletShort: Strategy = {
  ...BASE,
  id:          'starter_ict_silver_bullet_short',
  name:        'ICT Silver Bullet',
  longName:    '📉 SHORT — Bearish Liquidity Sweep + Bearish FVG + Below 50 EMA',
  description:
    'ICT Silver Bullet short setup: institutional stop hunt above swing highs followed ' +
    'by a Fair Value Gap (supply imbalance). Enter as price retraces into the gap.\n\n' +
    '• Bearish Liquidity Sweep (lookback 3): a prior swing high (20-bar) was swept ' +
    'and price closed back below it — buy-side stops collected, smart money short.\n' +
    '• Bearish FVG (lookback 3): three-candle supply gap present — entry target zone.\n' +
    '• EMA Dev(50) < 0: short-term trend bias is down.\n\n' +
    'Limit entry 1% above signal (targets the FVG zone fill). ' +
    'Mirror of the LONG "ICT Silver Bullet" template.',
  symbol:    'BTCUSDT',
  timeframe: '1h',
  entryConditions: [
    {
      id:    'starter_isbs_group_1',
      label: 'Liquidity Sweep + FVG Supply',
      conditions: [
        {
          id:           'starter_isbs_cond_sweep',
          indicatorId:  'bearish_liquidity_sweep',
          params:       { lookback: 20, minWickPct: 0.05 },
          seriesIndex:  0,
          operator:     'gt',
          value:        0,
          checkMode:    'lookback',
          checkCandles: 3,
        },
        {
          id:           'starter_isbs_cond_fvg',
          indicatorId:  'bearish_fvg',
          params:       { minGapPct: 0.1 },
          seriesIndex:  0,
          operator:     'gt',
          value:        0,
          checkMode:    'lookback',
          checkCandles: 3,
        },
        {
          id:           'starter_isbs_cond_trend',
          indicatorId:  'ema_dev',
          params:       { period: 50 },
          seriesIndex:  0,
          operator:     'lt',
          value:        0,
          checkMode:    'confirmation',
          checkCandles: 1,
        },
      ],
    },
  ],
  exitConditions: [],
  action: { type: 'enter_short', positionSizePct: 10, maxPositions: 1, entryPriceOffset: { mode: 'pct', value: 1 } },
  risk:   { stopLossPct: 1.5, takeProfitPct: 3 },
};

// ═══════════════════════════════════════════════════════════════════════════════
// ── Exported list — LONG first, then SHORT ─────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

export const STARTER_TEMPLATES: Strategy[] = [
  // ── LONG ────────────────────────────────────────────────────────────────────
  trendReversalLong,      // L1 — Three White Soldiers + RSI oversold + MACD bullish cross + above 200 EMA
  goldenTrioLong,         // L2 — BB %B below lower band + MACD bullish + RSI oversold
  adxTrendLong,           // L3 — ADX strong trend + StochRSI oversold dip
  volatilitySqueezeL,     // L4 — BB squeeze + RSI crosses above 50 + volume spike
  trendSniperL,           // L5 — ADX + MACD hist bullish + Bullish Engulfing
  meanReversionL,         // L6 — Stochastic oversold + Hammer + EMA Dev < -5%
  macdCrossTrendLong,     // L7 — MACD bullish cross below 0 + close above 200 EMA
  ictSilverBulletLong,    // L8 — Bullish Liquidity Sweep + Bullish FVG + above 50 EMA
  vpValBounceLong,        // L9 — VP VAL support bounce + POC above + rotational

  // ── SHORT ───────────────────────────────────────────────────────────────────
  trendReversal,          // S1 — Three Crows + RSI overbought + MACD bearish cross + below 200 EMA
  goldenTrio,             // S2 — BB %B above upper band + MACD bearish + RSI overbought
  adxTrend,               // S3 — ADX strong trend + StochRSI overbought rip
  volatilitySqueezeS,     // S4 — BB squeeze + RSI crosses below 50 + volume spike
  trendSniperS,           // S5 — ADX + MACD hist bearish + Bearish Engulfing
  meanReversionS,         // S6 — Stochastic overbought + Shooting Star + EMA Dev > +5%
  macdCrossTrendShort,    // S7 — MACD bearish cross above 0 + close below 200 EMA
  ictSilverBulletShort,   // S8 — Bearish Liquidity Sweep + Bearish FVG + below 50 EMA
  vpVahRotationShort,     // S9 — VP VAH resistance rotation + POC below + rotational
];
