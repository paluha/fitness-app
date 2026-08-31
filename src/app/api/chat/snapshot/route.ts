import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getMergedDayLogs } from '@/lib/fitness-merge';

// Лёгкий снапшот данных юзера для красивых карточек в чате.
// Возвращает готовые числа: цели/факт по макросам за сегодня, последнюю
// тренировку, последний анализ. Фронт подставляет это в карточки на месте
// плейсхолдеров [[card:...]] из ответа ассистента.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = session.user.id;

  const [user, mergedDayLogs, lastLab] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { goalProtein: true, goalFat: true, goalCarbs: true, goalCalories: true, timezone: true },
    }),
    getMergedDayLogs(prisma, userId),
    prisma.labResult.findFirst({
      where: { userId }, orderBy: { collectedAt: 'desc' },
      select: { panelName: true, collectedAt: true, markers: true },
    }),
  ]);

  // «Сегодня» в таймзоне пользователя (как клиент сохраняет даты), а не в UTC.
  // Иначе ночью серверный UTC-день разъезжается с локальным днём юзера.
  const tz = user?.timezone || 'Europe/Moscow';
  let today: string;
  try {
    today = new Date().toLocaleDateString('en-CA', { timeZone: tz }); // YYYY-MM-DD
  } catch {
    today = new Date().toISOString().slice(0, 10);
  }
  const dayLogs = (mergedDayLogs as Record<string, { meals?: { name?: string; calories?: number; protein?: number; fat?: number; carbs?: number }[]; workoutSnapshot?: { workoutName?: string; exercises?: { name?: string; completed?: boolean }[] }; workoutDraft?: { workoutName?: string; exercises?: { name?: string; completed?: boolean }[] } }>) || {};

  // Макросы по дням (последние 14) — чтобы карточка могла показать любой
  // запрошенный день, а не только сегодня.
  const dates = Object.keys(dayLogs).sort().reverse();
  const macrosByDate: Record<string, { eaten: { kcal: number; p: number; f: number; c: number }; meals: number }> = {};
  for (const d of dates.slice(0, 14)) {
    const meals = Array.isArray(dayLogs[d]?.meals) ? dayLogs[d]!.meals! : [];
    if (meals.length === 0) continue;
    macrosByDate[d] = {
      eaten: meals.reduce(
        (a, m) => ({ kcal: a.kcal + (m.calories || 0), p: a.p + (m.protein || 0), f: a.f + (m.fat || 0), c: a.c + (m.carbs || 0) }),
        { kcal: 0, p: 0, f: 0, c: 0 }
      ),
      meals: meals.length,
    };
  }
  const emptyEaten = { eaten: { kcal: 0, p: 0, f: 0, c: 0 }, meals: 0 };
  const todayMacros = macrosByDate[today] ?? emptyEaten;

  // Последние тренировки (дни с выполненными упражнениями, новые сверху).
  // Имена выполненных упражнений нужны фронту, чтобы показать «на что была»
  // тренировка (группы мышц маппятся на клиенте).
  const recentWorkouts: { date: string; name: string; done: number; total: number; exercises: string[] }[] = [];
  for (const d of dates) {
    const src = dayLogs[d]?.workoutSnapshot ?? dayLogs[d]?.workoutDraft;
    const ex = src?.exercises ?? [];
    const doneEx = Array.isArray(ex) ? ex.filter(e => e?.completed) : [];
    if (doneEx.length === 0) continue;
    recentWorkouts.push({
      date: d,
      name: src?.workoutName || 'Тренировка',
      done: doneEx.length,
      total: ex.length,
      exercises: doneEx.map(e => e?.name || '').filter(Boolean).slice(0, 10),
    });
    if (recentWorkouts.length >= 5) break;
  }
  const lastWorkout = recentWorkouts.length
    ? { date: recentWorkouts[0].date, name: recentWorkouts[0].name, done: recentWorkouts[0].done, total: recentWorkouts[0].total }
    : null;

  // Последний анализ — отклонения
  let labs: { date: string; panelName: string | null; abnormal: number; total: number } | null = null;
  if (lastLab) {
    const markers = Array.isArray(lastLab.markers) ? (lastLab.markers as { flag?: string }[]) : [];
    labs = {
      date: lastLab.collectedAt.toISOString().slice(0, 10),
      panelName: lastLab.panelName,
      abnormal: markers.filter(m => m.flag && m.flag !== 'normal').length,
      total: markers.length,
    };
  }

  return NextResponse.json({
    today,
    macros: {
      goal: { kcal: user?.goalCalories ?? null, p: user?.goalProtein ?? null, f: user?.goalFat ?? null, c: user?.goalCarbs ?? null },
      // данные за сегодня (для обратной совместимости) + по дням
      eaten: todayMacros.eaten,
      meals: todayMacros.meals,
      byDate: macrosByDate,
    },
    lastWorkout,
    recentWorkouts,
    labs,
  });
}
