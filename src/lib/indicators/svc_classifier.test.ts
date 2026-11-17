import { describe, it, expect } from 'vitest';
import { svc_classifier, trainLinearSvm } from './svc_classifier';
import { INDICATORS } from './index';
import { evaluateConditionGroupsChecked, buildIndicatorCache } from '@/lib/strategy/evaluate';
import { STARTER_TEMPLATES } from '@/lib/strategy/starterTemplates';
import { runBacktest } from '@/lib/strategy/backtester';
import type { Candle } from '@/types/market';
import type { ConditionGroup } from '@/types/strategy';

function makeMockCandles(count: number): Candle[] {
  const candles: Candle[] = [];
  let price = 50000;

  for (let i = 0; i < count; i++) {
    // Alternating wave with trend
    const drift = Math.sin(i / 5) * 200 + (i % 2 === 0 ? 50 : -40);
    const open = price;
    const close = open + drift;
    const high = Math.max(open, close) + 80;
    const low = Math.min(open, close) - 60;
    price = close;

    candles.push({
      openTime: 1700000000000 + i * 60000,
      open,
      high,
      low,
      close,
      volume: 1000 + i * 10,
      closeTime: 1700000000000 + (i + 1) * 60000 - 1,
    });
  }

  return candles;
}

describe('ML: Support Vector Classifier (SVC) Indicator', () => {
  it('is correctly registered in the central INDICATORS map', () => {
    expect(INDICATORS['svc_classifier']).toBeDefined();
    expect(INDICATORS['svc_classifier']?.id).toBe('svc_classifier');
    expect(INDICATORS['svc_classifier']?.name).toContain('Support Vector Classifier');
  });

  describe('Toggle On / Off Behavior', () => {
    it('returns empty result when enabled = 0 (toggled off)', () => {
      const candles = makeMockCandles(60);
      const result = svc_classifier.compute(candles, { ...svc_classifier.defaultParams, enabled: 0 });
      expect(result).toEqual([]);
    });

    it('returns active series when enabled = 1 (toggled on)', () => {
      const candles = makeMockCandles(60);
      const result = svc_classifier.compute(candles, { ...svc_classifier.defaultParams, enabled: 1, lookback: 20 });
      expect(result.length).toBe(2);
      expect(result[0]!.id).toBe('svc_signal_20');
      expect(result[1]!.id).toBe('svc_margin_20');
    });

    it('defaults to enabled = 1 when defaultParams are passed', () => {
      const candles = makeMockCandles(60);
      const result = svc_classifier.compute(candles, svc_classifier.defaultParams);
      expect(result.length).toBe(2);
      expect(result[0]!.data.length).toBeGreaterThan(0);
    });
  });

  describe('Linear SVM Training Functionality', () => {
    it('learns a separating boundary between positive and negative classes', () => {
      // 4 clearly separable 2D points
      // Class +1: high drift (+2, +3)
      // Class -1: negative drift (-2, -3)
      const drifts = [2, 3, -2, -3];
      const vols   = [1, 1.2, 0.8, 1];
      const labels = [1, 1, -1, -1];

      const model = trainLinearSvm(drifts, vols, labels, 40, 0.01);

      // Model weight for drift should be distinctly positive
      expect(model.w1).toBeGreaterThan(0);

      // Predictions for new positive and negative points
      const scorePos = model.w1 * 2.5 + model.w2 * 1.0 + model.b;
      const scoreNeg = model.w1 * (-2.5) + model.w2 * 1.0 + model.b;

      expect(scorePos).toBeGreaterThan(0);
      expect(scoreNeg).toBeLessThan(0);
    });
  });

  describe('Indicator Series & Formatting Output', () => {
    it('produces valid sub-panel series with custom formatValue and markers', () => {
      const candles = makeMockCandles(80);
      const [signalSeries, marginSeries] = svc_classifier.compute(candles, {
        enabled: 1,
        lookback: 25,
        threshold: 0.05,
      });

      expect(signalSeries).toBeDefined();
      expect(marginSeries).toBeDefined();

      // Check panel setup
      expect(signalSeries!.panel).toBe('sub');
      expect(signalSeries!.seriesType).toBe('histogram');
      expect(marginSeries!.panel).toBe('sub');
      expect(marginSeries!.seriesType).toBe('line');

      // Check formatValue
      expect(signalSeries!.formatValue!(1)).toBe('Bullish');
      expect(signalSeries!.formatValue!(-1)).toBe('Bearish');
      expect(signalSeries!.formatValue!(0)).toBe('Neutral');

      expect(marginSeries!.formatValue!(1.2345)).toBe('1.23');

      // Check that markers exist for signal flips
      expect(signalSeries!.markers).toBeDefined();
      if (signalSeries!.markers!.length > 0) {
        const marker = signalSeries!.markers![0]!;
        expect(['arrowUp', 'arrowDown']).toContain(marker.shape);
      }
    });

    it('returns empty array when candle count is insufficient for lookback window', () => {
      const candles = makeMockCandles(15);
      const result = svc_classifier.compute(candles, { ...svc_classifier.defaultParams, lookback: 30 });
      expect(result).toEqual([]);
    });
  });

  describe('Zero Lookahead Bias (Strict Causality)', () => {
    it('ensures predictions at bar t are identical whether future bars exist or not', () => {
      const fullCandles = makeMockCandles(100);
      const cutoff = 60;
      const truncatedCandles = fullCandles.slice(0, cutoff);

      const [fullSignal] = svc_classifier.compute(fullCandles, { ...svc_classifier.defaultParams, lookback: 20 });
      const [truncSignal] = svc_classifier.compute(truncatedCandles, { ...svc_classifier.defaultParams, lookback: 20 });

      expect(fullSignal).toBeDefined();
      expect(truncSignal).toBeDefined();

      // Find the value for candle at cutoff - 1 in both runs
      const targetTime = truncatedCandles[cutoff - 1]!.openTime;
      const fullPoint = fullSignal!.data.find((p) => p.time === targetTime);
      const truncPoint = truncSignal!.data.find((p) => p.time === targetTime);

      expect(fullPoint).toBeDefined();
      expect(truncPoint).toBeDefined();
      expect(truncPoint!.value).toBe(fullPoint!.value);
    });
  });

  describe('Performance / Latency Benchmark', () => {
    it('computes 1,000 candles with walk-forward SVM in under 200ms', () => {
      const candles = makeMockCandles(1000);
      const start = performance.now();
      const res = svc_classifier.compute(candles, { ...svc_classifier.defaultParams, lookback: 30 });
      const elapsed = performance.now() - start;

      expect(res.length).toBe(2);
      expect(res[0]!.data.length).toBe(1000 - 30);
      expect(elapsed).toBeLessThan(200);
    });
  });

  describe('Strategy Engine Integration', () => {
    it('integrates seamlessly with evaluateConditionGroupsChecked in strategy builder', () => {
      const candles = makeMockCandles(80);

      // Condition: SVC Signal is Bullish (> 0)
      const groups: ConditionGroup[] = [
        {
          id: 'grp_ml',
          label: 'ML Regime Confluence',
          operator: 'or',
          conditions: [
            {
              id: 'c_svc',
              indicatorId: 'svc_classifier',
              params: { enabled: 1, lookback: 20, threshold: 0.05 },
              seriesIndex: 0, // svc_signal series
              operator: 'gt',
              value: 0,
            },
          ],
        },
      ];

      // Bar index 50
      const conditions = groups.flatMap((g) => g.conditions);
      const cache = buildIndicatorCache(conditions, candles);
      const passes = evaluateConditionGroupsChecked(groups, candles, 50, cache);
      expect(typeof passes).toBe('boolean');
    });

    it('ships ready-to-use Long and Short ML starter templates in STARTER_TEMPLATES', () => {
      const longTemplate = STARTER_TEMPLATES.find((t) => t.id === 'starter_ml_svc_trend_long');
      const shortTemplate = STARTER_TEMPLATES.find((t) => t.id === 'starter_ml_svc_trend_short');

      expect(longTemplate).toBeDefined();
      expect(shortTemplate).toBeDefined();

      expect(longTemplate!.name).toBe('ML Support Vector Trend');
      expect(shortTemplate!.name).toBe('ML Support Vector Trend');
      expect(longTemplate!.action.type).toBe('enter_long');
      expect(shortTemplate!.action.type).toBe('enter_short');

      // Verify each template references svc_classifier
      const longHasSvc = longTemplate!.entryConditions.some((g) =>
        g.conditions.some((c) => c.indicatorId === 'svc_classifier'),
      );
      const shortHasSvc = shortTemplate!.entryConditions.some((g) =>
        g.conditions.some((c) => c.indicatorId === 'svc_classifier'),
      );
      expect(longHasSvc).toBe(true);
      expect(shortHasSvc).toBe(true);
    });

    it('can backtest the ML starter template directly without errors', () => {
      const longTemplate = STARTER_TEMPLATES.find((t) => t.id === 'starter_ml_svc_trend_long');
      expect(longTemplate).toBeDefined();

      const candles = makeMockCandles(150);
      const result = runBacktest(longTemplate!, candles);

      expect(result).toBeDefined();
      expect(typeof result.metrics.totalTrades).toBe('number');
      expect(typeof result.metrics.winRatePct).toBe('number');
      expect(Array.isArray(result.trades)).toBe(true);
      expect(Array.isArray(result.equityCurve)).toBe(true);
    });
  });
});
