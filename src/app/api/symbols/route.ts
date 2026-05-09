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

export async function GET() {
  let crypto: MarketSymbol[] = CRYPTO_FALLBACK;
  let stale = false;

  try {
    // Fetch top 40 so we have enough headroom after filtering stablecoins.
    // The list refreshes every hour via Next.js ISR revalidation.
    const res = await fetch(
      'https://api.coingecko.com/api/v3/coins/markets' +
      '?vs_currency=usd&order=market_cap_desc&per_page=40&page=1&sparkline=false',
      {
        next: { revalidate: 3600 },
        headers: { Accept: 'application/json' },
      },
    );

    if (!res.ok) throw new Error(`CoinGecko ${res.status}`);

    const coins = (await res.json()) as CoinGeckoMarket[];

    // Pinned base assets — always excluded from the ranked pool so they
    // don't occupy a slot, then added back explicitly at the end.
    const pinnedBases = new Set(PINNED.map((p) => p.baseAsset));

    // Filter out stablecoins and pinned coins, then cap at CRYPTO_LIST_SIZE - pinned.length
    const ranked: MarketSymbol[] = coins
      .filter((c) => {
        const base = c.symbol.toUpperCase();
        return !STABLECOINS.has(base) && !pinnedBases.has(base);
      })
      .slice(0, CRYPTO_LIST_SIZE - PINNED.length)
      .map((c) => ({
        symbol:      `${c.symbol.toUpperCase()}USDT`,
        baseAsset:   c.symbol.toUpperCase(),
        quoteAsset:  'USDT',
        source:      'binance' as const,
        displayName: c.name,
        rank:        c.market_cap_rank,
      }));

    // Append pinned coins (PAXG etc.) at the end
    crypto = [...ranked, ...PINNED];
  } catch (err) {
    console.warn('[api/symbols] CoinGecko unavailable, using fallback:', err);
    stale = true;
  }

  return NextResponse.json({ crypto, equities: MAG7, stale });
}
