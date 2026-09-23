import type { Candle } from '@/types/market';

/**
 * Generates an array of deterministic, valid OHLCV candles for testing.
 */
export function createMockCandles(
  count: number,
  basePrice = 100,
  baseTime = 1_700_000_000_000,
  intervalMs = 3_600_000,
): Candle[] {
  const candles: Candle[] = [];
  let price = basePrice;

  for (let i = 0; i < count; i++) {
    const openTime = baseTime + i * intervalMs;
    const closeTime = openTime + intervalMs - 1;
    const open = price;
    const high = price + 2;
    const low = price - 2;
    const close = price + (i % 2 === 0 ? 1 : -1);
    const volume = 1000 + i * 50;

    candles.push({
      openTime,
      open,
      high,
      low,
      close,
      volume,
      closeTime,
    });

    price = close;
  }

  return candles;
}

/**
 * Creates a mock fetch function that responds with specified latencies
 * to test out-of-order race conditions.
 */
export function createDelayedFetchMock(
  routes: Record<string, { data: Candle[]; delayMs: number; status?: number }>,
) {
  const inFlightRequests: Array<{ url: string; delayMs: number }> = [];

  const mockFetch = async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const matchedKey = Object.keys(routes).find((route) => url.includes(route));

    if (!matchedKey) {
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: `No mock route matched for ${url}` }),
      };
    }

    const config = routes[matchedKey]!;
    inFlightRequests.push({ url, delayMs: config.delayMs });

    if (config.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, config.delayMs));
    }

    if (config.status && config.status >= 400) {
      return {
        ok: false,
        status: config.status,
        json: async () => ({ error: `Mock HTTP error ${config.status}` }),
      };
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({
        symbol: url,
        interval: '1h',
        data: config.data,
      }),
    };
  };

  return { mockFetch, inFlightRequests };
}

/**
 * Controllable WebSocket double for testing exchange streaming lifecycles,
 * message race conditions, and disconnects.
 */
export class MockWebSocketClient {
  public static instances: MockWebSocketClient[] = [];
  public static clearInstances() {
    MockWebSocketClient.instances = [];
  }

  public url: string;
  public readyState = 1; // 1 = OPEN
  public onmessage: ((event: { data: string }) => void) | null = null;
  public onerror: ((event: unknown) => void) | null = null;
  public onclose: ((event: { code: number; reason: string }) => void) | null = null;
  public closed = false;
  public sent: string[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocketClient.instances.push(this);
  }

  public send(data: string) {
    this.sent.push(data);
  }

  public close() {
    this.closed = true;
    this.readyState = 3; // 3 = CLOSED
    if (this.onclose) {
      this.onclose({ code: 1000, reason: 'Normal Closure' });
    }
  }

  /** Simulate receiving a server frame */
  public triggerMessage(data: unknown) {
    if (this.onmessage) {
      const payload = typeof data === 'string' ? data : JSON.stringify(data);
      this.onmessage({ data: payload });
    }
  }

  /** Simulate a socket error */
  public triggerError(err: unknown = new Error('WebSocket connection error')) {
    if (this.onerror) {
      this.onerror(err);
    }
  }

  /** Simulate an unexpected drop */
  public triggerUnexpectedClose(code = 1006, reason = 'Abnormal Closure') {
    this.readyState = 3;
    if (this.onclose) {
      this.onclose({ code, reason });
    }
  }
}
