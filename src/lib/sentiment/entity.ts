/**
 * Symbol entity extraction — keyword-based matching.
 *
 * Maps coin/stock names and tickers to internal symbol strings
 * (e.g. "bitcoin" → "BTCUSDT", "apple" → "AAPL").
 *
 * Matching rules (designed to avoid English-word false positives):
 *  - NAMES (e.g. "bitcoin", "chainlink"): whole-word, case-insensitive.
 *  - TICKERS (e.g. "BTC", "LINK", "DOT"): matched ONLY when they appear as a
 *    cashtag ($LINK, any case) OR as a bare ALL-CAPS word (LINK, case-sensitive).
 *    This is the key fix — a lowercase "link", "ton", "dot", "sol" in prose no
 *    longer mis-tags an article, while "$LINK" and "Chainlink (LINK)" still do.
 *  - Cap at 5 symbols per article.
 *
 * Residual risk: a few coin *names* are also English words (polygon, cosmos,
 * stellar, tron). In a crypto/stock news feed these almost always refer to the
 * asset, so we accept it — the high-frequency offenders were the 3-letter
 * tickers, which this design neutralises.
 */

/** Full names → internal symbol. Matched case-insensitively as whole words. */
const NAME_MAP: Record<string, string> = {
  // ── Crypto (top-20) ──────────────────────────────────────────────────────
  bitcoin: 'BTCUSDT',
  ethereum: 'ETHUSDT',
  tether: 'USDTUSDT',
  'binance coin': 'BNBUSDT',
  solana: 'SOLUSDT',
  ripple: 'XRPUSDT',
  'usd coin': 'USDCUSDT',
  dogecoin: 'DOGEUSDT',
  cardano: 'ADAUSDT',
  avalanche: 'AVAXUSDT',
  tron: 'TRXUSDT',
  shiba: 'SHIBUSDT',
  'shiba inu': 'SHIBUSDT',
  chainlink: 'LINKUSDT',
  polkadot: 'DOTUSDT',
  polygon: 'POLUSDT',
  toncoin: 'TONUSDT',
  litecoin: 'LTCUSDT',
  uniswap: 'UNIUSDT',
  cosmos: 'ATOMUSDT',
  stellar: 'XLMUSDT',

  // ── Mag7 stocks ──────────────────────────────────────────────────────────
  apple: 'AAPL',
  microsoft: 'MSFT',
  nvidia: 'NVDA',
  google: 'GOOGL',
  alphabet: 'GOOGL',
  amazon: 'AMZN',
  facebook: 'META',
  tesla: 'TSLA',
};

/**
 * Tickers → internal symbol. Matched ONLY as a cashtag ($XXX, any case) or a
 * bare ALL-CAPS word (case-sensitive). Never as a lowercase word in prose.
 */
const TICKER_MAP: Record<string, string> = {
  // ── Crypto ────────────────────────────────────────────────────────────────
  BTC: 'BTCUSDT',
  ETH: 'ETHUSDT',
  USDT: 'USDTUSDT',
  BNB: 'BNBUSDT',
  SOL: 'SOLUSDT',
  XRP: 'XRPUSDT',
  USDC: 'USDCUSDT',
  DOGE: 'DOGEUSDT',
  ADA: 'ADAUSDT',
  AVAX: 'AVAXUSDT',
  TRX: 'TRXUSDT',
  SHIB: 'SHIBUSDT',
  LINK: 'LINKUSDT',
  DOT: 'DOTUSDT',
  POL: 'POLUSDT',
  MATIC: 'POLUSDT',
  TON: 'TONUSDT',
  LTC: 'LTCUSDT',
  UNI: 'UNIUSDT',
  ATOM: 'ATOMUSDT',
  XLM: 'XLMUSDT',

  // ── Mag7 stocks ──────────────────────────────────────────────────────────
  AAPL: 'AAPL',
  MSFT: 'MSFT',
  NVDA: 'NVDA',
  GOOGL: 'GOOGL',
  AMZN: 'AMZN',
  META: 'META',
  TSLA: 'TSLA',
};

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Pre-compile all patterns once at module load.
const PATTERNS: Array<{ re: RegExp; symbol: string }> = [
  // Names: whole-word, case-insensitive.
  ...Object.entries(NAME_MAP).map(([kw, symbol]) => ({
    re: new RegExp(`\\b${escapeRe(kw)}\\b`, 'i'),
    symbol,
  })),
  // Tickers — two accepted forms:
  //   1. cashtag: $LINK (any case)
  //   2. bare ALL-CAPS word: LINK (case-sensitive, so "link" in prose is ignored)
  ...Object.entries(TICKER_MAP).flatMap(([tk, symbol]) => [
    { re: new RegExp(`\\$${escapeRe(tk)}\\b`, 'i'), symbol },
    { re: new RegExp(`\\b${escapeRe(tk)}\\b`), symbol }, // no 'i' flag → case-sensitive
  ]),
];

/**
 * Extract up to 5 unique symbol strings from a text string.
 * Safe to call with any input — never throws.
 */
export function extractSymbols(text: string): string[] {
  if (!text) return [];

  const found = new Set<string>();

  for (const { re, symbol } of PATTERNS) {
    if (found.has(symbol)) continue;
    if (re.test(text)) {
      found.add(symbol);
      if (found.size >= 5) break;
    }
  }

  return Array.from(found);
}
