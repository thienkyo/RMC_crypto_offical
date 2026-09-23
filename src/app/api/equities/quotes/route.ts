import { NextRequest, NextResponse } from 'next/server';
import { fetchEquityQuotes, isEquitySymbol, MAG7_SYMBOLS } from '@/lib/exchange/equities';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const rawSymbols = searchParams.get('symbols');

  const requested = rawSymbols
    ? rawSymbols.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
    : [...MAG7_SYMBOLS];

  // Whitelist against the known universe before anything reaches a provider.
  // These strings are interpolated into outbound Polygon/Yahoo URLs, so an
  // unchecked value like "FOO?apiKey=x&" injects query parameters into our own
  // authenticated request.
  const symbols = requested.filter(isEquitySymbol);

  if (symbols.length === 0) {
    return NextResponse.json(
      requested.length > 0
        ? { quotes: {}, rejected: requested }
        : { quotes: {} },
    );
  }

  try {
    const quotes = await fetchEquityQuotes(symbols);
    return NextResponse.json(
      { quotes },
      { headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' } },
    );
  } catch (err) {
    console.error('[api/equities/quotes] Error:', err);
    return NextResponse.json({ error: 'Failed to fetch equity quotes' }, { status: 500 });
  }
}
