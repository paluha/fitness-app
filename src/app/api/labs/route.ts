import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// CRUD для лабораторных анализов пользователя.
// GET   /api/labs          — список результатов (новые сверху)
// POST  /api/labs          — сохранить новый результат
// DELETE /api/labs?id=...   — удалить результат

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const results = await prisma.labResult.findMany({
    where: { userId: session.user.id },
    orderBy: { collectedAt: 'desc' },
    take: 200,
  });
  return NextResponse.json({ results });
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { panelName, lab, collectedAt, markers, fileUrl, notes } = body ?? {};

  if (!Array.isArray(markers) || markers.length === 0) {
    return NextResponse.json({ error: 'markers required' }, { status: 400 });
  }
  const date = collectedAt ? new Date(collectedAt) : new Date();
  if (isNaN(date.getTime())) {
    return NextResponse.json({ error: 'invalid collectedAt' }, { status: 400 });
  }

  const created = await prisma.labResult.create({
    data: {
      userId: session.user.id,
      panelName: panelName || null,
      lab: lab || null,
      collectedAt: date,
      markers,
      fileUrl: fileUrl || null,
      notes: notes || null,
    },
  });
  return NextResponse.json({ result: created });
}

export async function DELETE(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  // удаляем только свой результат
  await prisma.labResult.deleteMany({ where: { id, userId: session.user.id } });
  return NextResponse.json({ ok: true });
}
