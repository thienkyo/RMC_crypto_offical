import { NextRequest, NextResponse } from 'next/server';
import { testCustomFeed } from '@/lib/crawlers/custom';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { url?: string };
    const url = body.url?.trim();

    if (!url) {
      return NextResponse.json(
        { ok: false, error: 'URL parameter is required' },
        { status: 400 },
      );
    }

    const result = await testCustomFeed(url);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[api/news/custom-feeds/test] Error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Internal test error' },
      { status: 500 },
    );
  }
}
