import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// Библиотека картинок упражнений — отдельно от GET /api/fitness.
//
// Картинки лежат в FitnessData.exerciseLibrary как base64 и у активного
// пользователя занимают больше мегабайта. Пока они ехали в общем ответе,
// каждая загрузка приложения тянула их заново, хотя меняются они раз в
// месяц. Здесь отдаём их отдельным запросом, который клиент кэширует по
// ETag: второй и последующие заходы получают 304 без тела.

/** Версия библиотеки — по времени последней записи и числу картинок. */
function libEtag(updatedAt: Date | null | undefined, count: number): string {
  return `W/"lib-${updatedAt ? updatedAt.getTime() : 0}-${count}"`;
}

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const data = await prisma.fitnessData.findUnique({
      where: { userId: session.user.id },
      select: { exerciseLibrary: true, updatedAt: true },
    });

    const lib = (data?.exerciseLibrary as Record<string, string> | null) || {};
    const etag = libEtag(data?.updatedAt, Object.keys(lib).length);

    // Клиент прислал тот же ETag — тело не нужно, экономим мегабайты трафика.
    if (request.headers.get('if-none-match') === etag) {
      return new NextResponse(null, {
        status: 304,
        headers: { ETag: etag, 'Cache-Control': 'private, must-revalidate' },
      });
    }

    return NextResponse.json({ exerciseLibrary: lib }, {
      headers: { ETag: etag, 'Cache-Control': 'private, must-revalidate' },
    });
  } catch (error) {
    console.error('exercise-library GET error:', error);
    return NextResponse.json({ error: 'Failed to load library' }, { status: 500 });
  }
}

/**
 * Добавить/заменить картинки. Шлём только изменившиеся: тело запроса —
 * { images: { "жим лёжа": "data:image/jpeg;base64,..." } }.
 *
 * Раньше клиент при каждом автосейве отправлял библиотеку целиком — отметка
 * одного подхода в зале гнала на сервер мегабайт и перезаписывала всю строку
 * в БД. Теперь приходит только новая картинка.
 */
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    const body = await request.json().catch(() => null);
    const incoming = body?.images;
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
      return NextResponse.json({ error: 'images object required' }, { status: 400 });
    }

    // Отбрасываем мусор: ключ — название упражнения, значение — data-URL.
    const clean: Record<string, string> = {};
    for (const [rawName, value] of Object.entries(incoming)) {
      const name = String(rawName).toLowerCase().trim();
      if (!name || typeof value !== 'string' || !value.startsWith('data:image/')) continue;
      // 3 МБ на картинку — выше этого в base64 клиент не сжимает, значит мусор.
      if (value.length > 3_000_000) continue;
      clean[name] = value;
    }
    if (Object.keys(clean).length === 0) {
      return NextResponse.json({ error: 'no valid images' }, { status: 400 });
    }

    const existing = await prisma.fitnessData.findUnique({
      where: { userId },
      select: { exerciseLibrary: true },
    });
    const merged = { ...((existing?.exerciseLibrary as Record<string, string>) || {}), ...clean };

    await prisma.fitnessData.upsert({
      where: { userId },
      update: { exerciseLibrary: merged, updatedAt: new Date() },
      create: {
        userId,
        workouts: [],
        dayLogs: {},
        progressHistory: {},
        bodyMeasurements: [],
        favoriteMeals: [],
        plannerEvents: [],
        exerciseLibrary: merged,
        habits: [],
        programArchive: [],
        recipes: [],
        vitals: [],
      },
    });

    return NextResponse.json({ ok: true, saved: Object.keys(clean).length });
  } catch (error) {
    console.error('exercise-library POST error:', error);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
}

/** Удалить картинку упражнения. */
export async function DELETE(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    const name = new URL(request.url).searchParams.get('name')?.toLowerCase().trim();
    if (!name) {
      return NextResponse.json({ error: 'name required' }, { status: 400 });
    }

    const existing = await prisma.fitnessData.findUnique({
      where: { userId },
      select: { exerciseLibrary: true },
    });
    const lib = (existing?.exerciseLibrary as Record<string, string>) || {};
    if (!(name in lib)) {
      return NextResponse.json({ ok: true, removed: 0 });
    }
    delete lib[name];

    await prisma.fitnessData.update({
      where: { userId },
      data: { exerciseLibrary: lib, updatedAt: new Date() },
    });
    return NextResponse.json({ ok: true, removed: 1 });
  } catch (error) {
    console.error('exercise-library DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
