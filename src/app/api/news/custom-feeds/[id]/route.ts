import { NextRequest, NextResponse } from 'next/server';
import { updateCustomFeed, deleteCustomFeed } from '@/lib/db/news';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await req.json()) as { active?: boolean; name?: string };

    await updateCustomFeed(id, {
      active: body.active,
      name: body.name?.trim(),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/news/custom-feeds/[id]] PATCH error:', err);
    return NextResponse.json({ error: 'Failed to update custom feed' }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await deleteCustomFeed(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/news/custom-feeds/[id]] DELETE error:', err);
    return NextResponse.json({ error: 'Failed to delete custom feed' }, { status: 500 });
  }
}
