import { NextResponse } from 'next/server';
import type { MarketSymbol } from '@/types/market';

// ─── Mag 7 equities ───────────────────────────────────────────────────────────

const MAG7: MarketSymbol[] = [
  { symbol: 'AAPL',  baseAsset: 'AAPL',  quoteAsset: 'USD', source: 'equities', displayName: 'Apple'   },
  { symbol: 'MSFT',  baseAsset: 'MSFT',  quoteAsset: 'USD', source: 'equities', displayName: 'Microsoft' },
  { symbol: 'GOOGL', baseAsset: 'GOOGL', quoteAsset: 'USD', source: 'equities', displayName: 'Alphabet' },
  { symbol: 'AMZN',  baseAsset: 'AMZN',  quoteAsset: 'USD', source: 'equities', displayName: 'Amazon'  },
  { symbol: 'NVDA',  baseAsset: 'NVDA',  quoteAsset: 'USD', source: 'equities', displayName: 'NVIDIA'  },
  { symbol: 'META',  baseAsset: 'META',  quoteAsset: 'USD', source: 'equities', displayName: 'Meta'    },
  { symbol: 'TSLA',  baseAsset: 'TSLA',  quoteAsset: 'USD', source: 'equities', displayName: 'Tesla'   },
];

// ─── Stablecoin blocklist ─────────────────────────────────────────────────────
// Base-asset symbols that represent fiat-pegged or commodity-replicating tokens
// that have no useful price signal for chart analysis.
// Note: PAXG (gold-backed) is intentionally NOT here — it's a tradeable asset.
const STABLECOINS = new Set([
  'USDT', 'USDC', 'BUSD', 'DAI',  'TUSD', 'FDUSD', 'USDP', 'GUSD',
  'USDD', 'FRAX', 'LUSD', 'SUSD', 'PYUSD', 'EUROC', 'EURT', 'USDE',
  'USDS', 'EURS', 'CEUR', 'CUSD', 'XSGD', 'BIDR',
]);

// ─── Pinned supplemental coins ────────────────────────────────────────────────
// Always included regardless of CoinGecko rank (e.g. PAXG rarely makes top 20
// by raw market cap but is a meaningful tradeable asset).
const PINNED: MarketSymbol[] = [
  {
    symbol:      'PAXGUSDT',
    baseAsset:   'PAXG',
    quoteAsset:  'USDT',
    source:      'binance',
    displayName: 'PAX Gold',
  },
];

// ─── Fallback list (used when CoinGecko is unreachable) ───────────────────────
// 19 non-stable majors + PAXG = 20 total.
const CRYPTO_FALLBACK: MarketSymbol[] = [
  { symbol: 'BTCUSDT',  baseAsset: 'BTC',  quoteAsset: 'USDT', source: 'binance', displayName: 'Bitcoin',    rank: 1  },
  { symbol: 'ETHUSDT',  baseAsset: 'ETH',  quoteAsset: 'USDT', source: 'binance', displayName: 'Ethereum',   rank: 2  },
  { symbol: 'BNBUSDT',  baseAsset: 'BNB',  quoteAsset: 'USDT', source: 'binance', displayName: 'BNB',        rank: 3  },
  { symbol: 'SOLUSDT',  baseAsset: 'SOL',  quoteAsset: 'USDT', source: 'binance', displayName: 'Solana',     rank: 4  },
  { symbol: 'XRPUSDT',  baseAsset: 'XRP',  quoteAsset: 'USDT', source: 'binance', displayName: 'XRP',        rank: 5  },
  { symbol: 'DOGEUSDT', baseAsset: 'DOGE', quoteAsset: 'USDT', source: 'binance', displayName: 'Dogecoin',   rank: 6  },
  { symbol: 'ADAUSDT',  baseAsset: 'ADA',  quoteAsset: 'USDT', source: 'binance', displayName: 'Cardano',    rank: 7  },
  { symbol: 'TRXUSDT',  baseAsset: 'TRX',  quoteAsset: 'USDT', source: 'binance', displayName: 'TRON',       rank: 8  },
  { symbol: 'AVAXUSDT', baseAsset: 'AVAX', quoteAsset: 'USDT', source: 'binance', displayName: 'Avalanche',  rank: 9  },
  { symbol: 'LINKUSDT', baseAsset: 'LINK', quoteAsset: 'USDT', source: 'binance', displayName: 'Chainlink',  rank: 10 },
  { symbol: 'DOTUSDT',  baseAsset: 'DOT',  quoteAsset: 'USDT', source: 'binance', displayName: 'Polkadot',   rank: 11 },
  { symbol: 'MATICUSDT',baseAsset: 'MATIC',quoteAsset: 'USDT', source: 'binance', displayName: 'Polygon',    rank: 12 },
  { symbol: 'LTCUSDT',  baseAsset: 'LTC',  quoteAsset: 'USDT', source: 'binance', displayName: 'Litecoin',   rank: 13 },
  { symbol: 'BCHUSDT',  baseAsset: 'BCH',  quoteAsset: 'USDT', source: 'binance', displayName: 'Bitcoin Cash',rank: 14},
  { symbol: 'UNIUSDT',  baseAsset: 'UNI',  quoteAsset: 'USDT', source: 'binance', displayName: 'Uniswap',    rank: 15 },
  { symbol: 'ATOMUSDT', baseAsset: 'ATOM', quoteAsset: 'USDT', source: 'binance', displayName: 'Cosmos',     rank: 16 },
  { symbol: 'ETCUSDT',  baseAsset: 'ETC',  quoteAsset: 'USDT', source: 'binance', displayName: 'Ethereum Classic', rank: 17 },
  { symbol: 'XLMUSDT',  baseAsset: 'XLM',  quoteAsset: 'USDT', source: 'binance', displayName: 'Stellar',    rank: 18 },
  { symbol: 'NEARUSDT', baseAsset: 'NEAR', quoteAsset: 'USDT', source: 'binance', displayName: 'NEAR Protocol', rank: 19 },
  ...PINNED,
];

// ─── CoinGecko response shape ─────────────────────────────────────────────────

interface CoinGeckoMarket {
  symbol:          string;
  name:            string;
  market_cap_rank: number;
}

// ─── Route handler ────────────────────────────────────────────────────────────

const CRYPTO_LIST_SIZE = 20;

/**
 * Fetch the set of all active USDT spot symbols from Binance.
 *
 * Uses the lightweight price-ticker endpoint (~200 KB vs ~2 MB for exchangeInfo).
 * Cached for 1 hour alongside the symbol list — only refetched when CoinGecko is
 * also being re-evaluated.
 *
 * Returns an empty Set on failure so the caller can gracefully skip validation
 * rather than crash the whole route.
 */
async function fetchActiveBinanceUsdtSymbols(): Promise<Set<string>> {
  try {
    const res = await fetch('https://api.binance.com/api/v3/ticker/price', {
      next: { revalidate: 3600 },
    });
    if (!res.ok) throw new Error(`Binance ticker/price ${res.status}`);
    const pairs = (await res.json()) as Array<{ symbol: string }>;
    return new Set(pairs.map((p) => p.symbol));
  } catch (err) {
    console.warn('[api/symbols] Binance ticker/price fetch failed, skipping validation:', err);
    return new Set(); // empty = skip validation, accept all
  }
}

export async function GET() {
  let crypto: MarketSymbol[] = CRYPTO_FALLBACK;
  let stale = false;

  try {
    // Fetch top 60 from CoinGecko — extra headroom so we can still fill 20
    // valid Binance pairs after filtering stablecoins + unlisted tokens.
    const [coingeckoRes, activeBinanceSymbols] = await Promise.all([
      fetch(
        'https://api.coingecko.com/api/v3/coins/markets' +
        '?vs_currency=usd&order=market_cap_desc&per_page=60&page=1&sparkline=false',
        { next: { revalidate: 3600 }, headers: { Accept: 'application/json' } },
      ),
      fetchActiveBinanceUsdtSymbols(),
    ]);

    if (!coingeckoRes.ok) throw new Error(`CoinGecko ${coingeckoRes.status}`);

    const coins = (await coingeckoRes.json()) as CoinGeckoMarket[];

    const pinnedBases = new Set(PINNED.map((p) => p.baseAsset));
    const want = CRYPTO_LIST_SIZE - PINNED.length;

    // Walk the CoinGecko list in rank order, skipping:
    //   1. Stablecoins
    //   2. Pinned coins (added back explicitly below)
    //   3. Coins with no active USDT spot pair on Binance
    //      (only enforced when we successfully fetched the Binance list)
    const ranked: MarketSymbol[] = [];
    for (const c of coins) {
      if (ranked.length >= want) break;
      const base          = c.symbol.toUpperCase();
      const binanceSymbol = `${base}USDT`;

      if (STABLECOINS.has(base))  continue;
      if (pinnedBases.has(base))  continue;

      // Skip if we have Binance data and the pair isn't active
      if (activeBinanceSymbols.size > 0 && !activeBinanceSymbols.has(binanceSymbol)) {
        console.log(`[api/symbols] skipping ${binanceSymbol} — not on Binance spot`);
        continue;
      }

      ranked.push({
        symbol:      binanceSymbol,
        baseAsset:   base,
        quoteAsset:  'USDT',
        source:      'binance' as const,
        displayName: c.name,
        rank:        c.market_cap_rank,
      });
    }

    crypto = [...ranked, ...PINNED];
  } catch (err) {
    console.warn('[api/symbols] CoinGecko unavailable, using fallback:', err);
    stale = true;
  }

  return NextResponse.json({ crypto, equities: MAG7, stale });
}
