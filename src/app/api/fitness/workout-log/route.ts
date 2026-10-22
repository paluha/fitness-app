import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';

// GET /api/fitness/workout-log?since=<iso>  — pull rows changed after a timestamp (diff sync).
// GET /api/fitness/workout-log?date=YYYY-MM-DD  — pull all rows for a specific day.
// GET /api/fitness/workout-log                — pull everything for the user (first load).
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

    // Потолок на выборку: без него первая загрузка (клиент идёт без
    // since) тянула всю историю пользователя одним ответом — а она растёт
    // примерно на 1700 строк в год. Порядок по serverUpdatedAt возрастающий,
    // поэтому клиент добирает остаток, повторив запрос с последним
    // serverTime из hasMore-ответа.
    const PAGE = 1000;
    const rows = await prisma.workoutLogEntry.findMany({
      where,
      orderBy: { serverUpdatedAt: 'asc' },
      take: PAGE + 1,
    });
    const hasMore = rows.length > PAGE;
    if (hasMore) rows.length = PAGE;
    return NextResponse.json({
      rows,
      hasMore,
      // При незавершённой выборке отдаём время последней строки, иначе
      // клиент запомнил бы «сейчас» и потерял непрочитанный хвост.
      serverTime: hasMore && rows.length > 0
        ? rows[rows.length - 1].serverUpdatedAt.toISOString()
        : new Date().toISOString(), // client stores this as new lastSyncTs
    });
  } catch (error) {
    console.error('[workout-log GET]', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

// PATCH /api/fitness/workout-log
// Body: { items: Array<{ date, exerciseId, workoutId?, completed?, actualSets?, notes?, clientId?, clientUpdatedAt }> }
//
// Upserts a batch of rows. Conflict rule: if an existing row's clientUpdatedAt
// is >= the incoming clientUpdatedAt, the incoming write is IGNORED — older
// writes can't overwrite newer ones. This makes it safe to re-send pending
// ops after coming back online without fear of rolling the state backwards.
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

    // Один запрос на всю пачку вместо findUnique в цикле.
    //
    // Клиент шлёт до 200 операций за раз (src/lib/sync.ts), и раньше на
    // каждую уходило по два обращения к базе: 60 отметок = 120
    // последовательных round-trip'ов. При удалённой базе это секунды на
    // один PATCH, и всё это время запрос держит соединение из пула в 5 —
    // при 50 пользователях пул кончался бы раньше, чем база нагружалась.
    const keys = items
      .map(it => ({ date: String(it.date || ''), exerciseId: String(it.exerciseId || '') }))
      .filter(k => k.date && k.exerciseId);
    const existingRows = keys.length > 0
      ? await prisma.workoutLogEntry.findMany({
          where: { userId, OR: keys.map(k => ({ date: k.date, exerciseId: k.exerciseId })) },
          select: { date: true, exerciseId: true, clientUpdatedAt: true, actualSets: true },
        })
      : [];
    const existingMap = new Map(existingRows.map(r => [`${r.date}\u0000${r.exerciseId}`, r]));

    // Копим операции и применяем одной транзакцией.
    const ops: Prisma.PrismaPromise<unknown>[] = [];

    for (const it of items) {
      const date = String(it.date || '');
      const exerciseId = String(it.exerciseId || '');
      if (!date || !exerciseId) { skipped++; continue; }
      const incomingAt = it.clientUpdatedAt ? new Date(it.clientUpdatedAt as string) : applyTs;

      const existing = existingMap.get(`${date}\u0000${exerciseId}`);
      if (existing && existing.clientUpdatedAt >= incomingAt) { skipped++; continue; }

      // Защита от затирания нулями: клиент со «свежей» пустой копией дня
      // (офлайн-старт со старым бэкапом) может прислать completed=true с
      // подходами 0×0 поверх реальных весов. Повторная отметка выполненности
      // не должна стирать сохранённые подходы — нули игнорируем, флаг применяем.
      const setWeight = (v: unknown) => (v && typeof v === 'object' ? ((v as { weight?: number }).weight || 0) : 0);
      const setReps = (v: unknown) => (v && typeof v === 'object' ? ((v as { reps?: number }).reps || 0) : 0);
      const isAllZero = (v: unknown) => Array.isArray(v) && v.length > 0 && v.every(x => setWeight(x) === 0 && setReps(x) === 0);
      const hasReal = (v: unknown) => Array.isArray(v) && v.some(x => setWeight(x) > 0 || setReps(x) > 0);
      let actualSetsIn = it.actualSets;
      if (it.completed && isAllZero(actualSetsIn) && hasReal(existing?.actualSets)) {
        actualSetsIn = undefined;
      }

      ops.push(prisma.workoutLogEntry.upsert({
        where: { userId_date_exerciseId: { userId, date, exerciseId } },
        create: {
          userId,
          date,
          exerciseId,
          workoutId: (it.workoutId as string) ?? null,
          completed: !!it.completed,
          actualSets: (it.actualSets as never) ?? null,
          notes: (it.notes as string) ?? null,
          clientId: (it.clientId as string) ?? null,
          clientUpdatedAt: incomingAt,
        },
        update: {
          workoutId: (it.workoutId as string) ?? undefined,
          completed: it.completed !== undefined ? !!it.completed : undefined,
          actualSets: actualSetsIn !== undefined ? (actualSetsIn as never) : undefined,
          notes: it.notes !== undefined ? (it.notes as string) : undefined,
          clientId: (it.clientId as string) ?? undefined,
          clientUpdatedAt: incomingAt,
          deletedAt: null, // PATCH un-deletes if needed
        },
      }));
      applied++;
    }

    if (ops.length > 0) {
      await prisma.$transaction(ops);
    }

    return NextResponse.json({ applied, skipped, serverTime: new Date().toISOString() });
  } catch (error) {
    console.error('[workout-log PATCH]', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
