/** Raw Binance REST klines array element (12 fields per row). */
export type RawBinanceKlineRow = [
  number,  // 0  openTime (ms)
  string,  // 1  open
  string,  // 2  high
  string,  // 3  low
  string,  // 4  close
  string,  // 5  volume (base asset)
  number,  // 6  closeTime (ms)
  string,  // 7  quote asset volume  ← we store this as "volume"
  number,  // 8  number of trades
  string,  // 9  taker buy base asset volume
  string,  // 10 taker buy quote asset volume
  string,  // 11 ignore
];

/** Binance WebSocket kline stream message. */
export interface BinanceKlineStreamMsg {
  e: 'kline';
  E: number; // event time ms
  s: string; // symbol e.g. "BTCUSDT"
  k: {
    t: number;   // kline start time ms
    T: number;   // kline close time ms
    s: string;   // symbol
    i: string;   // interval e.g. "1h"
    o: string;   // open
    c: string;   // close
    h: string;   // high
    l: string;   // low
    v: string;   // base asset volume
    q: string;   // quote asset volume
    x: boolean;  // is kline closed (final tick for this bar)
    n: number;   // number of trades
  };
}

/** Binance 24hr mini ticker stream. */
export interface BinanceMiniTickerMsg {
  e: '24hrMiniTicker';
  E: number;
  s: string; // symbol
  c: string; // close (last price)
  o: string; // open
  h: string; // high
  l: string; // low
  v: string; // base volume
  q: string; // quote volume
}
