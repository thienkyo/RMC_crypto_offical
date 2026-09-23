import { NextRequest, NextResponse } from 'next/server';
import { getCustomFeeds, addCustomFeed } from '@/lib/db/news';

export async function GET() {
  try {
    const feeds = await getCustomFeeds();
    return NextResponse.json({ feeds });
  } catch (err) {
    console.error('[api/news/custom-feeds] GET error:', err);
    return NextResponse.json({ error: 'Failed to load custom feeds' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      name?: string;
      url?: string;
      resolvedFeedUrl?: string;
      mode?: 'rss' | 'discovered' | 'html';
    };

    const url = body.url?.trim();
    if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
      return NextResponse.json(
        { error: 'Valid URL starting with http:// or https:// is required' },
        { status: 400 },
      );
    }

    const name = body.name?.trim() || new URL(url).hostname;

    const feed = await addCustomFeed({
      name,
      url,
      resolvedFeedUrl: body.resolvedFeedUrl?.trim() || null,
      mode: body.mode || 'rss',
    });

    return NextResponse.json({ feed });
  } catch (err) {
    console.error('[api/news/custom-feeds] POST error:', err);
    return NextResponse.json({ error: 'Failed to add custom feed' }, { status: 500 });
  }
}
