import { describe, it, expect, beforeEach } from 'vitest';
import { useChartStore } from './chart';

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
});
