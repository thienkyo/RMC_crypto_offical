import { NextResponse } from 'next/server';
import type { MarketSymbol } from '@/types/market';

/** Common Binance quote assets, in priority order for suffix-stripping. */
const QUOTE_ASSETS = ['USDT', 'USDC', 'BUSD', 'BTC', 'ETH', 'BNB'] as const;

/**
 * Infer the base asset by stripping the longest matching quote suffix.
 * e.g. "PEPEUSDT" → "PEPE", "ETHBTC" → "ETH"
 */
function inferBaseAsset(symbol: string): string {
  for (const quote of QUOTE_ASSETS) {
    if (symbol.endsWith(quote) && symbol.length > quote.length) {
      return symbol.slice(0, -quote.length);
    }
  }
  return symbol;
}

/**
 * Normalize raw user input to an uppercase Binance symbol.
 * Bare base assets (no recognized quote suffix) default to USDT pairs.
 * e.g. "pepe" → "PEPEUSDT", "ethbtc" → "ETHBTC"
 */
function normalize(input: string): string {
  const upper = input.trim().toUpperCase();
  const hasQuote = QUOTE_ASSETS.some((q) => upper.endsWith(q) && upper.length > q.length);
  return hasQuote ? upper : `${upper}USDT`;
}

interface Binance24hrTicker {
  symbol:             string;
  lastPrice:          string;
  priceChangePercent: string;
}

interface BinanceErrorBody {
  code: number;
  msg:  string;
}

/**
 * GET /api/symbols/validate?symbol=<input>
 *
 * Validates a user-provided symbol against Binance's 24hr ticker.
 * Returns the normalized MarketSymbol on success, or a reason string on failure.
 *
 * The ?symbol= value can be a raw base asset ("PEPE") or a full pair ("PEPEUSDT").
 * Normalization always produces a USDT pair unless another quote is explicitly provided.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const raw = searchParams.get('symbol');

  if (!raw?.trim()) {
    return NextResponse.json(
      { valid: false, reason: 'Missing ?symbol= parameter' },
      { status: 400 },
    );
  }

  const symbol = normalize(raw);

  try {
    const res = await fetch(
      `https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`,
      // Short cache — we want live validation but don't want to hammer Binance
      { next: { revalidate: 60 } },
    );

    if (res.status === 400) {
      const body = (await res.json()) as BinanceErrorBody;
      const msg = body.msg?.includes('Invalid symbol')
        ? `${symbol} is not listed on Binance`
        : body.msg ?? `${symbol} not found`;
      return NextResponse.json({ valid: false, reason: msg });
    }

    if (!res.ok) {
      return NextResponse.json(
        { valid: false, reason: `Binance returned ${res.status} — try again` },
      );
    }

    const data = (await res.json()) as Binance24hrTicker;
    const baseAsset  = inferBaseAsset(symbol);
    const quoteAsset = symbol.slice(baseAsset.length);

    const marketSymbol: MarketSymbol = {
      symbol,
      baseAsset,
      quoteAsset,
      source:      'binance',
      // Use baseAsset as displayName — the user chose this symbol so they know what it is.
      // CoinGecko name lookup would add latency and complexity for a rare path.
      displayName: baseAsset,
    };

    return NextResponse.json({
      valid:        true,
      symbol,
      price:        parseFloat(data.lastPrice),
      marketSymbol,
    });
  } catch (err) {
    console.error('[api/symbols/validate]', err);
    return NextResponse.json(
      { valid: false, reason: 'Validation failed — check your connection' },
      { status: 500 },
    );
  }
}
