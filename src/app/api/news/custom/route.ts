import { NextRequest, NextResponse } from 'next/server';
import { getLatestCustomArticles } from '@/lib/db/news';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 50);

    const articles = await getLatestCustomArticles(limit);
    return NextResponse.json({ articles });
  } catch (err) {
    console.error('[api/news/custom] Error:', err);
    return NextResponse.json({ error: 'Failed to load custom articles' }, { status: 500 });
  }
}
