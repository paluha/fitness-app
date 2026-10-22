import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';

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

    // Потолок на выборку — как в workout-log: payload у kind:'meals'
    // весит килобайты, и без take первая загрузка тянула всю историю.
    const PAGE = 1000;
    const rows = await prisma.dayLogEntry.findMany({
      where,
      orderBy: { serverUpdatedAt: 'asc' },
      take: PAGE + 1,
    });
    const hasMore = rows.length > PAGE;
    if (hasMore) rows.length = PAGE;
    return NextResponse.json({
      rows,
      hasMore,
      serverTime: hasMore && rows.length > 0
        ? rows[rows.length - 1].serverUpdatedAt.toISOString()
        : new Date().toISOString(),
    });
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

    // Одна выборка на пачку вместо findUnique в цикле — см. тот же
    // разбор в workout-log: клиент шлёт до 200 операций за флаш, и
    // последовательные round-trip'ы держали соединение из пула секундами.
    const keys = items
      .map(it => ({ date: String(it.date || ''), kind: String(it.kind || '') }))
      .filter(k => k.date && k.kind);
    const existingRows = keys.length > 0
      ? await prisma.dayLogEntry.findMany({
          where: { userId, OR: keys.map(k => ({ date: k.date, kind: k.kind })) },
          select: { date: true, kind: true, clientUpdatedAt: true },
        })
      : [];
    const existingMap = new Map(existingRows.map(r => [`${r.date}\u0000${r.kind}`, r]));

    const ops: Prisma.PrismaPromise<unknown>[] = [];

    for (const it of items) {
      const date = String(it.date || '');
      const kind = String(it.kind || '');
      if (!date || !kind) { skipped++; continue; }
      const incomingAt = it.clientUpdatedAt ? new Date(it.clientUpdatedAt as string) : applyTs;

      const existing = existingMap.get(`${date}\u0000${kind}`);
      if (existing && existing.clientUpdatedAt >= incomingAt) { skipped++; continue; }

      ops.push(prisma.dayLogEntry.upsert({
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
      }));
      applied++;
    }

    if (ops.length > 0) {
      await prisma.$transaction(ops);
    }

    return NextResponse.json({ applied, skipped, serverTime: new Date().toISOString() });
  } catch (error) {
    console.error('[day-log PATCH]', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
