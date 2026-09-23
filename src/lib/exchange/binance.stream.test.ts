import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { subscribeKline } from './binance';
import { MockWebSocketClient } from '@/test/probes/chartProbes';

describe('Binance WebSocket Stream & Race Probes', () => {
  const originalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    MockWebSocketClient.clearInstances();
    // @ts-expect-error Mocking global WebSocket for probe testing
    globalThis.WebSocket = MockWebSocketClient;
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
    vi.restoreAllMocks();
  });

  const createSampleKlineFrame = (
    symbol = 'BTCUSDT',
    interval = '1h',
    closePrice = '65000.50',
    isClosed = false,
  ) => ({
    e: 'kline',
    E: 1700000060000,
    s: symbol,
    k: {
      t: 1700000000000,
      T: 1700003599999,
      s: symbol,
      i: interval,
      f: 100,
      L: 200,
      o: '64800.00',
      c: closePrice,
      h: '65200.00',
      l: '64750.00',
      v: '120.5',
      q: '7832500.00',
      V: '60.0',
      Q: '3900000.00',
      B: '0',
      x: isClosed,
    },
  });

  it('connects to correct Binance kline stream endpoint and delivers parsed ticks', () => {
    const onCandle = vi.fn();
    const onError = vi.fn();

    const unsubscribe = subscribeKline('BTCUSDT', '1h', onCandle, onError);
    expect(MockWebSocketClient.instances.length).toBe(1);

    const client = MockWebSocketClient.instances[0]!;
    expect(client.url).toContain('btcusdt@kline_1h');

    // Deliver valid tick frame
    client.triggerMessage(createSampleKlineFrame('BTCUSDT', '1h', '65123.45', false));

    expect(onCandle).toHaveBeenCalledTimes(1);
    expect(onCandle).toHaveBeenCalledWith(
      {
        openTime: 1700000000000,
        open: 64800,
        high: 65200,
        low: 64750,
        close: 65123.45,
        volume: 7832500, // Quote asset volume 'q'
        closeTime: 1700003599999,
      },
      false, // isClosed
    );

    unsubscribe();
    expect(client.closed).toBe(true);
  });

  it('strictly drops late buffered messages delivered after unsubscribe', () => {
    const onCandle = vi.fn();
    const unsubscribe = subscribeKline('ETHUSDT', '15m', onCandle);

    const client = MockWebSocketClient.instances[0]!;

    // 1. Initial message delivered while subscribed
    client.triggerMessage(createSampleKlineFrame('ETHUSDT', '15m', '3500.00'));
    expect(onCandle).toHaveBeenCalledTimes(1);

    // 2. User navigates away or switches ticker; unsubscribe is called
    unsubscribe();

    // 3. Socket buffer delivers late message after intentional close
    client.triggerMessage(createSampleKlineFrame('ETHUSDT', '15m', '3505.00'));

    // Assert: onCandle was NOT called again; stale message was safely dropped
    expect(onCandle).toHaveBeenCalledTimes(1);
  });

  it('rejects cross-ticker and interval mismatch messages', () => {
    const onCandle = vi.fn();
    const unsubscribe = subscribeKline('SOLUSDT', '1h', onCandle);
    const client = MockWebSocketClient.instances[0]!;

    // Case A: Wrong symbol arriving on this socket (e.g. BTC on SOL stream)
    client.triggerMessage(createSampleKlineFrame('BTCUSDT', '1h', '65000.00'));
    expect(onCandle).not.toHaveBeenCalled();

    // Case B: Wrong interval (e.g. 5m frame on 1h subscription)
    client.triggerMessage(createSampleKlineFrame('SOLUSDT', '5m', '150.00'));
    expect(onCandle).not.toHaveBeenCalled();

    // Case C: Matching symbol and interval accepted
    client.triggerMessage(createSampleKlineFrame('SOLUSDT', '1h', '150.50'));
    expect(onCandle).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it('safely handles non-kline frames, pongs, and malformed JSON without crashing', () => {
    const onCandle = vi.fn();
    const onError = vi.fn();
    const unsubscribe = subscribeKline('BTCUSDT', '1h', onCandle, onError);
    const client = MockWebSocketClient.instances[0]!;

    // Non-kline server envelope
    client.triggerMessage({ result: null, id: 1234 });
    // Event without kline payload
    client.triggerMessage({ e: 'trade', s: 'BTCUSDT' });
    // Invalid JSON string
    client.triggerMessage('NOT_VALID_JSON{:::');

    expect(onCandle).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();

    unsubscribe();
  });

  it('schedules auto-reconnect on unexpected drop, but not on intentional unsubscribe', () => {
    vi.useFakeTimers();

    const onCandle = vi.fn();
    const unsubscribe = subscribeKline('BTCUSDT', '1h', onCandle);
    expect(MockWebSocketClient.instances.length).toBe(1);

    const client1 = MockWebSocketClient.instances[0]!;

    // Simulate unexpected network drop (code 1006)
    client1.triggerUnexpectedClose();

    // Immediately after drop, reconnect has not fired yet
    expect(MockWebSocketClient.instances.length).toBe(1);

    // Advance 2,000ms (auto-reconnect delay)
    vi.advanceTimersByTime(2000);

    // Assert: New socket was created automatically
    expect(MockWebSocketClient.instances.length).toBe(2);
    const client2 = MockWebSocketClient.instances[1]!;
    expect(client2.url).toContain('btcusdt@kline_1h');

    // Clean intentional unsubscribe on the active subscription
    unsubscribe();
    expect(client2.closed).toBe(true);

    // Advance timers again; verify NO third reconnection occurs
    vi.advanceTimersByTime(5000);
    expect(MockWebSocketClient.instances.length).toBe(2);

    vi.useRealTimers();
  });

  it('calls onError callback when socket encounters an error event', () => {
    const onError = vi.fn();
    const unsubscribe = subscribeKline('BTCUSDT', '1h', vi.fn(), onError);
    const client = MockWebSocketClient.instances[0]!;

    client.triggerError(new Error('Connection reset'));
    expect(onError).toHaveBeenCalledTimes(1);

    unsubscribe();
  });
});
