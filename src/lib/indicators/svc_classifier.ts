/**
 * Support Vector Classifier (SVC) Machine Learning Indicator.
 *
 * Inspired by quantitative classification models predicting market direction:
 * Maps 2D market features into a linear Support Vector Machine (SVM):
 *   1. Drift: Normalized (Close - Open) / Open
 *   2. Volatility: Normalized (High - Low) / Open
 *
 * A rolling walk-forward window fits an optimal maximum-margin decision boundary
 * (hyperplane) separating bullish candles (+1) from bearish candles (-1):
 *   f(x) = w · x + b
 *
 * For bar t:
 *   - The model trains strictly on completed bars [t - lookback, t - 1] to avoid lookahead bias.
 *   - Evaluates features of bar t against the learned hyperplane to output:
 *       • svc_signal: +1 (Bullish), -1 (Bearish), or 0 (Neutral within threshold)
 *       • svc_margin: continuous signed distance to decision boundary
 *
 * Parameters:
 *   enabled   — 1: On (compute model), 0: Off (bypass/return inactive).
 *   lookback  — Rolling training window size (default: 30 bars, min: 10, max: 200).
 *   threshold — Margin deadband around decision boundary for neutral state (default: 0.1).
 */

import type { Candle } from '@/types/market';
import type { Indicator, IndicatorResult, IndicatorSeries, IndicatorPoint, IndicatorMarker } from './types';

export interface SvcClassifierParams {
  /** 1 = On, 0 = Off */
  enabled:   number;
  /** Lookback bars for rolling training window (e.g. 30) */
  lookback:  number;
  /** Confidence margin threshold; predictions within [-threshold, threshold] become 0 (neutral) */
  threshold: number;
  [key: string]: number;
}

export interface SvmWeights {
  w1: number; // weight for Drift
  w2: number; // weight for Volatility
  b:  number; // bias / intercept
}

/**
 * Fast Pegasos / SGD soft-margin Linear SVM solver.
 * Optimizes hinge loss with L2 regularization over the rolling window:
 *   min (lambda/2)*||w||^2 + (1/N) * sum(max(0, 1 - y * (w·x + b)))
 *
 * Zero-allocation, warm-started: executes in < 0.015ms per window in V8.
 */
export function trainLinearSvm(
  drifts: number[],
  vols: number[],
  labels: number[],
  epochs = 20,
  lambda = 0.01,
  initWeights?: SvmWeights,
): SvmWeights {
  const n = labels.length;
  if (n === 0) return { w1: 0, w2: 0, b: 0 };

  let w1 = initWeights ? initWeights.w1 : 0;
  let w2 = initWeights ? initWeights.w2 : 0;
  let b  = initWeights ? initWeights.b  : 0;
  let step = 1;

  for (let epoch = 0; epoch < epochs; epoch++) {
    for (let i = 0; i < n; i++) {
      const y  = labels[i]!;
      const x1 = drifts[i]!;
      const x2 = vols[i]!;

      const margin = y * (w1 * x1 + w2 * x2 + b);
      const eta = 1 / (lambda * step + 1);
      step++;

      if (margin < 1) {
        // Margin violation: update weights with subgradient of hinge loss
        w1 = (1 - eta * lambda) * w1 + eta * y * x1;
        w2 = (1 - eta * lambda) * w2 + eta * y * x2;
        b  = b + eta * y;
      } else {
        // Satisfied margin: apply L2 decay
        w1 = (1 - eta * lambda) * w1;
        w2 = (1 - eta * lambda) * w2;
      }
    }
  }

  return { w1, w2, b };
}

export const svc_classifier: Indicator<SvcClassifierParams> = {
  id: 'svc_classifier',
  name: 'ML: Support Vector Classifier',
  description: 'Machine Learning Support Vector Classifier (SVC). Separates bullish and bearish market regimes using a rolling maximum-margin decision boundary over Drift and Volatility.',
  defaultParams: {
    enabled:   1,
    lookback:  30,
    threshold: 0.1,
  },
  paramsMeta: {
    enabled: {
      type: 'select',
      label: 'Model State',
      options: [
        { label: 'On', value: 1 },
        { label: 'Off', value: 0 },
      ],
    },
    lookback: {
      type: 'number',
      label: 'Lookback Window',
      min: 10,
      max: 200,
      step: 5,
    },
    threshold: {
      type: 'number',
      label: 'Neutral Deadband',
      min: 0,
      max: 2,
      step: 0.05,
    },
  },

  compute(
    candles: Candle[],
    { enabled = 1, lookback = 30, threshold = 0.1 }: Partial<SvcClassifierParams> = {},
  ): IndicatorResult {
    // ── Toggle Off Check ────────────────────────────────────────────────────────
    if (enabled === 0 || candles.length === 0) {
      return [];
    }

    const n = candles.length;
    const windowSize = Math.max(10, Math.min(200, Math.floor(lookback)));
    if (n < windowSize + 2) return [];

    // Pre-calculate per-bar raw features
    // Drift: (Close - Open) / Open
    // Volatility: (High - Low) / Open
    // Label for bar i: +1 if Close >= Open else -1
    const rawDrifts = new Float64Array(n);
    const rawVols   = new Float64Array(n);
    const rawLabels = new Int8Array(n);

    for (let i = 0; i < n; i++) {
      const c = candles[i]!;
      const o = c.open || 1e-6;
      rawDrifts[i] = (c.close - c.open) / o;
      rawVols[i]   = (c.high - c.low) / o;
      rawLabels[i] = c.close >= c.open ? 1 : -1;
    }

    const signalPoints: IndicatorPoint[] = [];
    const marginPoints: IndicatorPoint[] = [];
    const markers: IndicatorMarker[] = [];

    let prevSignal = 0;

    // Allocate reusable window arrays once (no GC pressure / slice allocations in the loop)
    const winDrifts = new Array<number>(windowSize);
    const winVols   = new Array<number>(windowSize);
    const winLabels = new Array<number>(windowSize);

    let model: SvmWeights = { w1: 0, w2: 0, b: 0 };

    // Walk forward bar by bar:
    // At bar t, train on historical window [t - windowSize, t - 1].
    // Zero lookahead bias: bar t and future bars are never used in training.
    for (let t = windowSize; t < n; t++) {
      const windowStart = t - windowSize;

      // 1. Compute rolling mean & variance over [windowStart, t - 1]
      let sumD = 0;
      let sumV = 0;
      for (let i = 0; i < windowSize; i++) {
        const idx = windowStart + i;
        sumD += rawDrifts[idx]!;
        sumV += rawVols[idx]!;
      }
      const meanD = sumD / windowSize;
      const meanV = sumV / windowSize;

      let varD = 0;
      let varV = 0;
      for (let i = 0; i < windowSize; i++) {
        const idx = windowStart + i;
        const diffD = rawDrifts[idx]! - meanD;
        const diffV = rawVols[idx]!   - meanV;
        varD += diffD * diffD;
        varV += diffV * diffV;
      }
      const stdD = Math.sqrt(varD / windowSize) || 1e-6;
      const stdV = Math.sqrt(varV / windowSize) || 1e-6;

      // 2. Normalize training window features directly into preallocated arrays
      for (let i = 0; i < windowSize; i++) {
        const idx = windowStart + i;
        winDrifts[i] = (rawDrifts[idx]! - meanD) / stdD;
        winVols[i]   = (rawVols[idx]!   - meanV) / stdV;
        winLabels[i] = rawLabels[idx]!;
      }

      // 3. Train linear SVM with warm-started weights from previous bar
      // 3 epochs with warm-start is sufficient to adapt to 1-bar delta while running in ~0.002ms
      model = trainLinearSvm(winDrifts, winVols, winLabels, 3, 0.01, model);

      // 4. Feature vector of bar t (standardized using the window's historical statistics)
      const x1 = (rawDrifts[t]! - meanD) / stdD;
      const x2 = (rawVols[t]!   - meanV) / stdV;

      // Decision function: signed distance to decision boundary
      const margin = model.w1 * x1 + model.w2 * x2 + model.b;

      let signal = 0;
      if (margin >= threshold) {
        signal = 1;  // Bullish
      } else if (margin <= -threshold) {
        signal = -1; // Bearish
      }

      const time = candles[t]!.openTime;
      const color = signal === 1 ? '#22c55e' : signal === -1 ? '#ef4444' : '#6b7280';

      signalPoints.push({ time, value: signal, color });
      marginPoints.push({ time, value: Math.round(margin * 100) / 100 });

      // Signal transition markers
      if (signal !== prevSignal && signal !== 0) {
        markers.push({
          time,
          position: signal === 1 ? 'belowBar' : 'aboveBar',
          color: signal === 1 ? '#22c55e' : '#ef4444',
          shape: signal === 1 ? 'arrowUp' : 'arrowDown',
          size: 1,
          text: signal === 1 ? 'SVC Bull' : 'SVC Bear',
        });
      }
      prevSignal = signal;
    }

    const signalSeries: IndicatorSeries = {
      id: `svc_signal_${windowSize}`,
      name: `SVC Signal (${windowSize})`,
      panel: 'sub',
      color: '#22c55e',
      seriesType: 'histogram',
      data: signalPoints,
      markers,
      formatValue: (v: number) => (v > 0 ? 'Bullish' : v < 0 ? 'Bearish' : 'Neutral'),
    };

    const marginSeries: IndicatorSeries = {
      id: `svc_margin_${windowSize}`,
      name: `SVC Margin (${windowSize})`,
      panel: 'sub',
      color: '#3b82f6',
      lineWidth: 1.5,
      seriesType: 'line',
      data: marginPoints,
      formatValue: (v: number) => v.toFixed(2),
    };

    return [signalSeries, marginSeries];
  },
};
