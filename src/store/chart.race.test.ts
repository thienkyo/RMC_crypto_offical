import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useChartStore } from './chart';
import { createMockCandles } from '@/test/probes/chartProbes';

describe('Chart Store — Race Condition & Latency Probes', () => {
  beforeEach(() => {
    vi.useRealTimers();
    useChartStore.setState({
      symbol: 'BTCUSDT',
      source: 'binance',
      timeframe: '1h',
      candles: [],
      candlesKey: null,
      isLoading: false,
      isStale: false,
      lastTickAt: null,
    });
  });

  it('drops out-of-order delayed REST responses across ticker switches', async () => {
    const store = useChartStore.getState();

    // 1. User starts on BTCUSDT and initiates slow fetch (300ms simulated network latency)
    store.setSymbol('BTCUSDT');
    const btcPromise = new Promise<{ candles: ReturnType<typeof createMockCandles>; key: string }>((resolve) => {
      setTimeout(() => {
        resolve({
          candles: createMockCandles(10, 60000),
          key: 'BTCUSDT-1h',
        });
      }, 300);
    });

    // 2. User quickly switches to NVDA before BTC fetch finishes (fast fetch: 50ms latency)
    store.setSymbol('NVDA');
    expect(useChartStore.getState().symbol).toBe('NVDA');
    expect(useChartStore.getState().candlesKey).toBeNull();
    expect(useChartStore.getState().candles).toEqual([]);

    const nvdaPromise = new Promise<{ candles: ReturnType<typeof createMockCandles>; key: string }>((resolve) => {
      setTimeout(() => {
        resolve({
          candles: createMockCandles(10, 120),
          key: 'NVDA-1h',
        });
      }, 50);
    });

    // 3. NVDA resolves first (at 50ms)
    const nvdaResult = await nvdaPromise;
    useChartStore.getState().setCandles(nvdaResult.candles, nvdaResult.key);

    let state = useChartStore.getState();
    expect(state.symbol).toBe('NVDA');
    expect(state.candlesKey).toBe('NVDA-1h');
    expect(state.candles[0]?.open).toBe(120);

    // 4. Stale BTC response finishes later (at 300ms)
    const btcResult = await btcPromise;
    useChartStore.getState().setCandles(btcResult.candles, btcResult.key);

    // 5. Assert: BTC payload was dropped! Chart remains strictly NVDA
    state = useChartStore.getState();
    expect(state.symbol).toBe('NVDA');
    expect(state.candlesKey).toBe('NVDA-1h');
    expect(state.candles[0]?.open).toBe(120);
    expect(state.candles.length).toBe(10);
  });

  it('rejects stale timeframe responses when interval is changed in-flight', async () => {
    const store = useChartStore.getState();
    store.setSymbol('BTCUSDT');
    store.setTimeframe('1h');

    // Simulate in-flight fetch for 1h
    const slow1hPromise = new Promise<{ candles: ReturnType<typeof createMockCandles>; key: string }>((resolve) => {
      setTimeout(() => {
        resolve({
          candles: createMockCandles(20, 60000, 1700000000000, 3600000),
          key: 'BTCUSDT-1h',
        });
      }, 150);
    });

    // User switches to 15m
    store.setTimeframe('15m');
    expect(useChartStore.getState().timeframe).toBe('15m');
    expect(useChartStore.getState().candlesKey).toBeNull();

    // Fast 15m fetch arrives
    const fast15mCandles = createMockCandles(20, 60000, 1700000000000, 900000);
    useChartStore.getState().setCandles(fast15mCandles, 'BTCUSDT-15m');

    expect(useChartStore.getState().candlesKey).toBe('BTCUSDT-15m');

    // Slow 1h fetch resolves later
    const slow1hResult = await slow1hPromise;
    useChartStore.getState().setCandles(slow1hResult.candles, slow1hResult.key);

    // Assert: 1h data rejected
    const finalState = useChartStore.getState();
    expect(finalState.timeframe).toBe('15m');
    expect(finalState.candlesKey).toBe('BTCUSDT-15m');
    expect(finalState.candles).toEqual(fast15mCandles);
  });

  it('prevents Binance crypto data from contaminating equities on source handoff', async () => {
    const store = useChartStore.getState();
    store.setSymbol('ETHUSDT');
    expect(store.source).toBe('binance');

    // Simulate in-flight Binance candle fetch
    const btcInFlight = createMockCandles(50, 3000);

    // User switches to equity symbol (AAPL)
    store.setSymbol('AAPL');
    expect(useChartStore.getState().symbol).toBe('AAPL');
    expect(useChartStore.getState().source).toBe('equities');
    expect(useChartStore.getState().candlesKey).toBeNull();

    // Late Binance response attempts commit
    useChartStore.getState().setCandles(btcInFlight, 'ETHUSDT-1h');

    const state = useChartStore.getState();
    expect(state.symbol).toBe('AAPL');
    expect(state.source).toBe('equities');
    expect(state.candlesKey).toBeNull();
    expect(state.candles).toEqual([]);
  });

  it('survives rapid consecutive symbol switches without state corruption', () => {
    const symbols = [
      'BTCUSDT', 'NVDA', 'ETHUSDT', 'AAPL', 'SOLUSDT',
      'TSM', 'ASML', 'MU', 'WDC', 'DOGEUSDT',
    ];

    for (const sym of symbols) {
      useChartStore.getState().setSymbol(sym);
      const state = useChartStore.getState();
      expect(state.symbol).toBe(sym);
      expect(state.candles).toEqual([]);
      expect(state.candlesKey).toBeNull();
      expect(state.isStale).toBe(false);
      expect(state.lastTickAt).toBeNull();
    }

    // Final symbol in roster is DOGEUSDT
    expect(useChartStore.getState().symbol).toBe('DOGEUSDT');
    expect(useChartStore.getState().source).toBe('binance');

    // Committing candles for an intermediate symbol (NVDA) is rejected
    useChartStore.getState().setCandles(createMockCandles(10, 100), 'NVDA-1h');
    expect(useChartStore.getState().candles).toEqual([]);

    // Committing for the active symbol succeeds
    const dogeCandles = createMockCandles(15, 0.15);
    useChartStore.getState().setCandles(dogeCandles, 'DOGEUSDT-1h');
    expect(useChartStore.getState().candlesKey).toBe('DOGEUSDT-1h');
    expect(useChartStore.getState().candles.length).toBe(15);
  });

  describe('Bar Mutation Probes (updateLastCandle)', () => {
    it('updates last candle in-place when tick timestamp matches open bar', () => {
      const baseCandles = createMockCandles(5, 100, 1700000000000, 60000);
      useChartStore.getState().setCandles(baseCandles, 'BTCUSDT-1h');

      const initialCount = useChartStore.getState().candles.length;
      const lastCandle = baseCandles[baseCandles.length - 1]!;

      // Tick arriving for current bar with updated close price
      const updatedTick = {
        ...lastCandle,
        close: 108.5,
        high: Math.max(lastCandle.high, 108.5),
      };

      const isNewBar = useChartStore.getState().updateLastCandle(updatedTick);

      expect(isNewBar).toBe(false);
      const state = useChartStore.getState();
      expect(state.candles.length).toBe(initialCount);
      expect(state.candles[state.candles.length - 1]?.close).toBe(108.5);
      expect(state.lastTickAt).not.toBeNull();
    });

    it('appends a new candle when tick timestamp advances past open bar', () => {
      const baseCandles = createMockCandles(5, 100, 1700000000000, 60000);
      useChartStore.getState().setCandles(baseCandles, 'BTCUSDT-1h');

      const initialCount = useChartStore.getState().candles.length;
      const lastCandle = baseCandles[baseCandles.length - 1]!;

      // New bar tick with advanced openTime
      const newBarTick = {
        openTime: lastCandle.openTime + 60000,
        open: lastCandle.close,
        high: lastCandle.close + 1,
        low: lastCandle.close - 1,
        close: lastCandle.close + 0.5,
        volume: 50,
        closeTime: lastCandle.closeTime + 60000,
      };

      const isNewBar = useChartStore.getState().updateLastCandle(newBarTick);

      expect(isNewBar).toBe(true);
      const state = useChartStore.getState();
      expect(state.candles.length).toBe(initialCount + 1);
      expect(state.candles[state.candles.length - 1]?.openTime).toBe(newBarTick.openTime);
    });

    it('gracefully returns false when candles array is empty', () => {
      useChartStore.getState().setCandles([], 'BTCUSDT-1h');

      const tick = createMockCandles(1, 100)[0]!;
      const isNewBar = useChartStore.getState().updateLastCandle(tick);

      expect(isNewBar).toBe(false);
      expect(useChartStore.getState().candles).toEqual([]);
    });
  });
});
