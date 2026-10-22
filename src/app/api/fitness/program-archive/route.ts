import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// История программ тренировок — отдельно от GET /api/fitness.
//
// Архив только растёт (у активного пользователя это уже под мегабайт) и
// нужен ровно на одном экране — «История программ» в профиле. Пока он ехал
// в общем ответе, каждый запуск приложения тянул все прошлые программы,
// чтобы показать сегодняшнюю тренировку.
//
// Писать архив по-прежнему можно через POST /api/fitness (там он приходит
// вместе с новыми workouts при смене программы) — этот роут только для
// чтения, чтобы не раздваивать логику записи.

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const data = await prisma.fitnessData.findUnique({
      where: { userId: session.user.id },
      select: { programArchive: true, updatedAt: true },
    });

    const archive = (data?.programArchive as unknown[] | null) || [];
    const etag = `W/"arch-${data?.updatedAt ? data.updatedAt.getTime() : 0}-${archive.length}"`;

    if (request.headers.get('if-none-match') === etag) {
      return new NextResponse(null, {
        status: 304,
        headers: { ETag: etag, 'Cache-Control': 'private, must-revalidate' },
      });
    }

    return NextResponse.json({ programArchive: archive }, {
      headers: { ETag: etag, 'Cache-Control': 'private, must-revalidate' },
    });
  } catch (error) {
    console.error('program-archive GET error:', error);
    return NextResponse.json({ error: 'Failed to load archive' }, { status: 500 });
  }
}
