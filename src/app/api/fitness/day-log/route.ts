import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// GET /api/fitness/day-log?since=<iso>   — diff sync: rows changed after a timestamp
// GET /api/fitness/day-log?date=YYYY-MM-DD  — all kinds for that day
// GET /api/fitness/day-log               — everything
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = session.user.id;

    const { searchParams } = new URL(request.url);
    const sinceStr = searchParams.get('since');
    const date = searchParams.get('date');

    const where: Record<string, unknown> = { userId };
    if (date) where.date = date;
    if (sinceStr) {
      const since = new Date(sinceStr);
      if (!isNaN(since.getTime())) where.serverUpdatedAt = { gt: since };
    }

    const rows = await prisma.dayLogEntry.findMany({
      where,
      orderBy: { serverUpdatedAt: 'asc' },
    });
    return NextResponse.json({ rows, serverTime: new Date().toISOString() });
  } catch (error) {
    console.error('[day-log GET]', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

// PATCH /api/fitness/day-log
// Body: { items: Array<{ date, kind, payload, clientId?, clientUpdatedAt }> }
//
// Same last-writer-wins rule as workout-log: ignore writes older than what's
// already stored. kind is the short tag ("steps", "meals", "mood", etc).
export async function PATCH(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = session.user.id;

    const body = await request.json();
    const items: Array<Record<string, unknown>> = Array.isArray(body?.items) ? body.items : [];
    if (items.length === 0) return NextResponse.json({ applied: 0, skipped: 0 });

    let applied = 0;
    let skipped = 0;
    const applyTs = new Date();

    for (const it of items) {
      const date = String(it.date || '');
      const kind = String(it.kind || '');
      if (!date || !kind) { skipped++; continue; }
      const incomingAt = it.clientUpdatedAt ? new Date(it.clientUpdatedAt as string) : applyTs;

      const existing = await prisma.dayLogEntry.findUnique({
        where: { userId_date_kind: { userId, date, kind } },
        select: { clientUpdatedAt: true },
      });
      if (existing && existing.clientUpdatedAt >= incomingAt) { skipped++; continue; }

      await prisma.dayLogEntry.upsert({
        where: { userId_date_kind: { userId, date, kind } },
        create: {
          userId,
          date,
          kind,
          payload: (it.payload as never) ?? {},
          clientId: (it.clientId as string) ?? null,
          clientUpdatedAt: incomingAt,
        },
        update: {
          payload: (it.payload as never) ?? undefined,
          clientId: (it.clientId as string) ?? undefined,
          clientUpdatedAt: incomingAt,
          deletedAt: null,
        },
      });
      applied++;
    }

    return NextResponse.json({ applied, skipped, serverTime: new Date().toISOString() });
  } catch (error) {
    console.error('[day-log PATCH]', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
