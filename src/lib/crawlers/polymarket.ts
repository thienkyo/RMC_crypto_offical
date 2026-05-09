/**
 * Polymarket crawler — fetches active prediction markets and stores odds as
 * polymarket_snapshots. No API key required.
 *
 * API: https://gamma-api.polymarket.com/markets
 *
 * We filter for crypto-related markets by tag, then match to internal symbols
 * via the entity extractor.
 */

import { db } from '@/lib/db/client';
import { extractSymbols } from '@/lib/sentiment/entity';

const GAMMA_API = 'https://gamma-api.polymarket.com';

interface PolymarketMarket {
  id:          string;
  question:    string;
  active:      boolean;
  closed:      boolean;
  outcomePrices?: string; // JSON array of prices e.g. '["0.75","0.25"]'
  outcomes?:    string;   // JSON array e.g. '["Yes","No"]'
  tags?:        Array<{ label: string }>;
}

function parsePrice(priceJson: string | undefined, index: number): number {
  if (!priceJson) return 0.5;
  try {
    const arr = JSON.parse(priceJson) as string[];
    return parseFloat(arr[index] ?? '0') || 0;
  } catch {
    return 0.5;
  }
}

export async function crawlPolymarket(): Promise<{ inserted: number }> {
  let markets: PolymarketMarket[];
  try {
    const res = await fetch(
      `${GAMMA_API}/markets?active=true&closed=false&tag_slug=crypto&limit=50`,
      {
        headers: { 'User-Agent': 'RMC-Crypto-Bot/1.0 (personal monitoring tool)' },
        signal:  AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    markets = await res.json() as PolymarketMarket[];
  } catch (err) {
    console.error('[polymarket] fetch failed:', (err as Error).message);
    return { inserted: 0 };
  }

  let inserted = 0;

  for (const market of markets) {
    if (!market.active || market.closed) continue;

    const symbols = extractSymbols(market.question);
    // Only store markets we can tag to a known symbol
    if (symbols.length === 0) continue;

    const yesProb = parsePrice(market.outcomePrices, 0);
    const noProb  = parsePrice(market.outcomePrices, 1);

    try {
      await db.query(`
        INSERT INTO polymarket_snapshots (market_id, question, symbols, yes_prob, no_prob)
        VALUES ($1, $2, $3, $4, $5)
      `, [market.id, market.question, symbols, yesProb, noProb]);
      inserted++;
    } catch (err) {
      // Non-fatal — continue with next market
      console.error('[polymarket] insert error:', (err as Error).message);
    }
  }

  return { inserted };
}
