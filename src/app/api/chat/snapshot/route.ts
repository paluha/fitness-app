import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// Лёгкий снапшот данных юзера для красивых карточек в чате.
// Возвращает готовые числа: цели/факт по макросам за сегодня, последнюю
// тренировку, последний анализ. Фронт подставляет это в карточки на месте
// плейсхолдеров [[card:...]] из ответа ассистента.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = session.user.id;

  const [user, fitness, lastLab] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { goalProtein: true, goalFat: true, goalCarbs: true, goalCalories: true },
    }),
    prisma.fitnessData.findUnique({ where: { userId }, select: { dayLogs: true } }),
    prisma.labResult.findFirst({
      where: { userId }, orderBy: { collectedAt: 'desc' },
      select: { panelName: true, collectedAt: true, markers: true },
    }),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const dayLogs = (fitness?.dayLogs as Record<string, { meals?: { name?: string; calories?: number; protein?: number; fat?: number; carbs?: number }[]; workoutSnapshot?: { workoutName?: string; exercises?: { completed?: boolean }[] }; workoutDraft?: { workoutName?: string; exercises?: { completed?: boolean }[] } }>) || {};

  // Макросы за сегодня
  const todayMeals = Array.isArray(dayLogs[today]?.meals) ? dayLogs[today]!.meals! : [];
  const eaten = todayMeals.reduce(
    (a, m) => ({ kcal: a.kcal + (m.calories || 0), p: a.p + (m.protein || 0), f: a.f + (m.fat || 0), c: a.c + (m.carbs || 0) }),
    { kcal: 0, p: 0, f: 0, c: 0 }
  );

  // Последняя тренировка (последний день с выполненными упражнениями)
  let lastWorkout: { date: string; name: string; done: number; total: number } | null = null;
  const dates = Object.keys(dayLogs).sort().reverse();
  for (const d of dates) {
    const src = dayLogs[d]?.workoutSnapshot ?? dayLogs[d]?.workoutDraft;
    const ex = src?.exercises ?? [];
    const done = Array.isArray(ex) ? ex.filter(e => e?.completed).length : 0;
    if (done > 0) { lastWorkout = { date: d, name: src?.workoutName || 'Тренировка', done, total: ex.length }; break; }
  }

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
      eaten,
      meals: todayMeals.length,
    },
    lastWorkout,
    labs,
  });
}
