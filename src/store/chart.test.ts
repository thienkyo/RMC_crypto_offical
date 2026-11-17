import { describe, it, expect, beforeEach } from 'vitest';
import { useChartStore } from './chart';
import { resolveUpdatedLogicalRange } from '@/components/chart/PriceChart';
import type { Candle } from '@/types/market';

function makeCandles(count: number, startMs: number, stepMs: number): Candle[] {
  return Array.from({ length: count }, (_, i) => ({
    openTime:  startMs + i * stepMs,
    open:      100 + i,
    high:      105 + i,
    low:       95 + i,
    close:     102 + i,
    volume:    1000,
    closeTime: startMs + (i + 1) * stepMs - 1,
  }));
}

describe('Chart Store — Symbol & Source Management', () => {
  beforeEach(() => {
    useChartStore.setState({
      symbol: 'BTCUSDT',
      source: 'binance',
      timeframe: '1h',
      candles: [],
      candlesKey: null,
      isStale: false,
    });
  });

  it('initializes with default crypto symbol and binance source', () => {
    const state = useChartStore.getState();
    expect(state.symbol).toBe('BTCUSDT');
    expect(state.source).toBe('binance');
  });

  it('switches to equities and automatically infers source', () => {
    useChartStore.getState().setSymbol('AAPL');
    const state = useChartStore.getState();
    expect(state.symbol).toBe('AAPL');
    expect(state.source).toBe('equities');
    expect(state.candlesKey).toBeNull();
    expect(state.candles).toEqual([]);
  });

  it('switches back to crypto and infers binance source', () => {
    useChartStore.getState().setSymbol('AAPL');
    expect(useChartStore.getState().source).toBe('equities');

    useChartStore.getState().setSymbol('ETHUSDT');
    const state = useChartStore.getState();
    expect(state.symbol).toBe('ETHUSDT');
    expect(state.source).toBe('binance');
  });

  it('drops in-flight candles for a previous ticker', () => {
    const store = useChartStore.getState();
    store.setSymbol('BTCUSDT');

    // Simulate in-flight fetch arriving for old symbol after switch
    store.setSymbol('AAPL');

    const fakeCandles = [
      { openTime: 1000, open: 100, high: 105, low: 95, close: 102, volume: 1000, closeTime: 1999 },
    ];

    // Try committing candles with old context key
    store.setCandles(fakeCandles, 'BTCUSDT-1h');

    const state = useChartStore.getState();
    expect(state.symbol).toBe('AAPL');
    expect(state.candles).toEqual([]);
    expect(state.candlesKey).toBeNull();
  });

  it('toggles log scale mode', () => {
    expect(useChartStore.getState().isLogScale).toBe(false);
    useChartStore.getState().toggleLogScale();
    expect(useChartStore.getState().isLogScale).toBe(true);
    useChartStore.getState().toggleLogScale();
    expect(useChartStore.getState().isLogScale).toBe(false);
  });

  it('merges a shorter 1000-bar fallback slice into existing 4380-bar history on the same contextKey', () => {
    const stepMs = 4 * 3600_000;
    const fullHistory = makeCandles(4380, 1730721600000, stepMs);
    useChartStore.setState({ symbol: 'BTCUSDT', timeframe: '4h' });
    useChartStore.getState().setCandles(fullHistory, 'BTCUSDT-4h');
    expect(useChartStore.getState().candles.length).toBe(4380);

    // Simulate a 60s poll hitting the 1000-bar direct Binance fallback
    const fallbackTail = fullHistory.slice(-1000).map((c, idx) =>
      idx === 999 ? { ...c, close: 99999 } : c,
    );
    useChartStore.getState().setCandles(fallbackTail, 'BTCUSDT-4h');

    const state = useChartStore.getState();
    expect(state.candles.length).toBe(4380);
    expect(state.candles[0]!.openTime).toBe(fullHistory[0]!.openTime);
    expect(state.candles[4379]!.close).toBe(99999);
  });
});

describe('resolveUpdatedLogicalRange — prevents 2025 viewport jump on history expansion', () => {
  const stepMs = 4 * 3600_000;
  const full4380 = makeCandles(4380, 1730721600000, stepMs);
  const tail1000 = full4380.slice(-1000);

  it('shifts live-edge range by +3380 when 1000-bar fallback expands to 4380 bars', () => {
    // At live edge of 1000-bar array: [899, 1026]
    const rawSavedRange = { from: 899, to: 1026 };
    const nextRange = resolveUpdatedLogicalRange(tail1000, full4380, rawSavedRange);
    expect(nextRange).toEqual({ from: 4279, to: 4406 });
  });

  it('preserves historical timestamp anchor when scrolled back and older bars are prepended', () => {
    // Scrolled back to bars 500..600 of the 1000-bar array
    const rawSavedRange = { from: 500, to: 600 };
    const nextRange = resolveUpdatedLogicalRange(tail1000, full4380, rawSavedRange);
    // In full4380, those exact same timestamps live at 500+3380 .. 600+3380
    expect(nextRange).toEqual({ from: 3880, to: 3980 });
  });
});
