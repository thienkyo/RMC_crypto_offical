/**
 * Symbol entity extraction — keyword-based matching.
 *
 * Maps coin/stock names and tickers to internal symbol strings
 * (e.g. "bitcoin" → "BTCUSDT", "apple" → "AAPL").
 *
 * Rules:
 *  - Whole-word matching only (word boundaries) to avoid false positives
 *  - Case-insensitive
 *  - Cap at 5 symbols per article
 *  - Ticker matches beat name matches when deduplicating
 */

/** keyword (lowercase) → internal symbol */
const KEYWORD_MAP: Record<string, string> = {
  // ── Crypto (top-20) ──────────────────────────────────────────────────────
  bitcoin:     'BTCUSDT',  btc:      'BTCUSDT',
  ethereum:    'ETHUSDT',  eth:      'ETHUSDT',
  tether:      'USDTUSDT', usdt:     'USDTUSDT',
  bnb:         'BNBUSDT',  'binance coin': 'BNBUSDT',
  solana:      'SOLUSDT',  sol:      'SOLUSDT',
  xrp:         'XRPUSDT',  ripple:   'XRPUSDT',
  usdc:        'USDCUSDT', 'usd coin': 'USDCUSDT',
  dogecoin:    'DOGEUSDT', doge:     'DOGEUSDT',
  cardano:     'ADAUSDT',  ada:      'ADAUSDT',
  avalanche:   'AVAXUSDT', avax:     'AVAXUSDT',
  tron:        'TRXUSDT',  trx:      'TRXUSDT',
  shiba:       'SHIBUSDT', shib:     'SHIBUSDT', 'shiba inu': 'SHIBUSDT',
  chainlink:   'LINKUSDT', link:     'LINKUSDT',
  polkadot:    'DOTUSDT',  dot:      'DOTUSDT',
  polygon:     'POLUSDT',  pol:      'POLUSDT',  matic:    'POLUSDT',
  toncoin:     'TONUSDT',  ton:      'TONUSDT',
  litecoin:    'LTCUSDT',  ltc:      'LTCUSDT',
  uniswap:     'UNIUSDT',  uni:      'UNIUSDT',
  cosmos:      'ATOMUSDT', atom:     'ATOMUSDT',
  stellar:     'XLMUSDT',  xlm:      'XLMUSDT',

  // ── Mag7 stocks ──────────────────────────────────────────────────────────
  apple:    'AAPL', aapl:       'AAPL',
  microsoft:'MSFT', msft:       'MSFT',
  nvidia:   'NVDA', nvda:       'NVDA',
  google:   'GOOGL', googl:     'GOOGL', alphabet: 'GOOGL',
  amazon:   'AMZN', amzn:       'AMZN',
  meta:     'META', facebook:   'META',
  tesla:    'TSLA', tsla:       'TSLA',
};

// Pre-compile all regex patterns once at module load — O(1) per call
const PATTERNS: Array<{ re: RegExp; symbol: string }> = Object.entries(KEYWORD_MAP).map(
  ([kw, sym]) => ({
    re:     new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'),
    symbol: sym,
  }),
);

/**
 * Extract up to 5 unique symbol strings from a text string.
 * Safe to call with any input — never throws.
 */
export function extractSymbols(text: string): string[] {
  if (!text) return [];

  const found = new Set<string>();

  for (const { re, symbol } of PATTERNS) {
    if (re.test(text)) {
      found.add(symbol);
      if (found.size >= 5) break;
    }
  }

  return Array.from(found);
}
