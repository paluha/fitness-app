import { prisma } from './prisma';

// Keep this many snapshots per user. Older ones get pruned on every write.
export const MAX_SNAPSHOTS_PER_USER = 50;

/**
 * Не чаще одного снапшота в 15 минут на пользователя.
 *
 * Снапшот писался на каждый автосейв, а автосейв срабатывает через 1.5 с
 * после любого изменения: одна тренировка в зале (30 отметок подходов) —
 * это ~30 копий всей строки по ~1.5 МБ. Замер на живой базе: таблица
 * снапшотов занимала 257 МБ из 285 МБ всей базы, 205 МБ из них — один
 * пользователь.
 *
 * Смысл снапшота — «откатиться, если что-то испортилось». Для этого
 * достаточно точки раз в 15 минут; 50 точек покрывают больше 12 часов.
 */
const MIN_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Поля, которые в снапшот НЕ кладём.
 *
 * exerciseLibrary — мегабайт base64-картинок. Они меняются раз в месяц,
 * живут в своей копии и к порче журнала тренировок отношения не имеют,
 * а каждую копию раздували в полтора раза.
 */
const SKIP_FIELDS = new Set(['exerciseLibrary']);

// Create a rolling backup of a user's FitnessData after every successful save.
// Non-fatal: logged and swallowed on error so a snapshot failure never breaks
// the main save path.
export async function createSnapshotForUser(userId: string, data: Record<string, unknown>): Promise<void> {
  try {
    // Свежий снапшот уже есть — ничего не пишем.
    const last = await prisma.fitnessSnapshot.findFirst({
      where: { userId },
      select: { createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    if (last && Date.now() - last.createdAt.getTime() < MIN_INTERVAL_MS) {
      return;
    }

    const slim: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      if (!SKIP_FIELDS.has(k)) slim[k] = v;
    }

    await prisma.fitnessSnapshot.create({ data: { userId, data: slim as object } });
    // Trim old snapshots beyond the retention count
    const extras = await prisma.fitnessSnapshot.findMany({
      where: { userId },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
      skip: MAX_SNAPSHOTS_PER_USER,
    });
    if (extras.length > 0) {
      await prisma.fitnessSnapshot.deleteMany({
        where: { id: { in: extras.map(x => x.id) } },
      });
    }
  } catch (e) {
    console.error('[snapshot create failed]', e);
  }
}
