import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

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

    const rows = await prisma.workoutLogEntry.findMany({
      where,
      orderBy: { serverUpdatedAt: 'asc' },
    });
    return NextResponse.json({
      rows,
      serverTime: new Date().toISOString(), // client stores this as new lastSyncTs
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

    for (const it of items) {
      const date = String(it.date || '');
      const exerciseId = String(it.exerciseId || '');
      if (!date || !exerciseId) { skipped++; continue; }
      const incomingAt = it.clientUpdatedAt ? new Date(it.clientUpdatedAt as string) : applyTs;

      const existing = await prisma.workoutLogEntry.findUnique({
        where: { userId_date_exerciseId: { userId, date, exerciseId } },
        select: { clientUpdatedAt: true, actualSets: true },
      });
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

      await prisma.workoutLogEntry.upsert({
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
      });
      applied++;
    }

    return NextResponse.json({ applied, skipped, serverTime: new Date().toISOString() });
  } catch (error) {
    console.error('[workout-log PATCH]', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
