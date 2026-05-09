/** Normalized OHLCV candle — internal schema, exchange-agnostic. */
export interface Candle {
  /** Unix milliseconds — open of the bar. */
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Quote-asset volume (e.g. USDT for BTC/USDT). */
  volume: number;
  /** Unix milliseconds — close of the bar. */
  closeTime: number;
}

/** All supported timeframes. Order matches selector display order. */
export const TIMEFRAMES = [
  '1m', '3m', '5m', '15m', '30m',
  '1h', '2h', '4h', '6h', '12h',
  '1d', '1w',
] as const;

export type Timeframe = (typeof TIMEFRAMES)[number];

/** Data source for a symbol. Determines which exchange/API we call. */
export type SymbolSource = 'binance' | 'equities';

export interface MarketSymbol {
  /** Exchange-native symbol, e.g. "BTCUSDT" or "AAPL". */
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  source: SymbolSource;
  displayName: string;
  /** CoinGecko market-cap rank (crypto only). */
  rank?: number;
}

/** Live 24-hour stats shown in the watchlist. */
export interface Ticker {
  symbol: string;
  price: number;
  change24h: number;   // absolute
  changePct24h: number; // percentage
  volume24h: number;
}
