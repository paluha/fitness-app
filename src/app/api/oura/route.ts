import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ouraConfigured, ouraSync } from '@/lib/oura';

/** Состояние подключения и последние дни показателей. */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const conn = await prisma.ouraConnection.findUnique({
    where: { userId: session.user.id },
    select: { lastSyncAt: true, createdAt: true },
  });
  // Дни отдаём независимо от подключения: выгруженная история остаётся
  // при отключении кольца, и показывать её по-прежнему нужно.
  const days = await prisma.ouraDaily.findMany({
    where: { userId: session.user.id },
    orderBy: { date: 'desc' },
    take: 30,
  });

  return new Response(JSON.stringify({
    configured: ouraConfigured(),
    connected: !!conn,
    lastSyncAt: conn?.lastSyncAt ?? null,
    days,
  }), { headers: { 'Content-Type': 'application/json' } });
}

/** Запустить выгрузку вручную. */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
  const r = await ouraSync(session.user.id, 30);
  return new Response(JSON.stringify(r), {
    status: r.ok ? 200 : 400,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Отключить кольцо. Выгруженные дни оставляем — это уже его история. */
export async function DELETE() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
  await prisma.ouraConnection.deleteMany({ where: { userId: session.user.id } });
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
}
