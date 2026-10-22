// Server-side merge of the three overlapping stores that hold dayLogs data.
// The UI reads from a single `dayLogs` object — but internally day state now
// lives in three places:
//
//   1. FitnessData.dayLogs (legacy JSON blob — kept in sync by the old POST,
//      but it's the slowest to update and new fields sometimes don't land here)
//   2. DayLogEntry rows     — per-field/day writes (dayClosed, workoutCompleted,
//      workoutSnapshot, steps, isOffDay, notes, meals, selectedWorkout, …)
//   3. WorkoutLogEntry rows — per-exercise writes (completed, actualSets, notes)
//
// Historically the client fetched /api/fitness (JSON) and then lazily pulled
// per-row data into Dexie, and only the Dexie hydration merged them together
// — which meant a fresh browser on another device saw only stale JSON until
// Dexie caught up. This helper does that merge on the server so every client
// sees consistent dayLogs on the very first GET.
//
// Merge precedence (newest wins):
//   • workoutDraft.exercises fields come from WorkoutLogEntry rows (authoritative).
//   • dayClosed, workoutCompleted, workoutSnapshot, isOffDay, steps, notes,
//     workoutRating, selectedWorkout, meals come from DayLogEntry rows if present,
//     otherwise whatever the legacy JSON had.
//
// The function is pure — give it a PrismaClient + userId and it hands back the
// merged dayLogs plus the raw arrays the client still needs for diff-sync.

type LegacyDayLog = {
  date: string;
  selectedWorkout?: string | null;
  workoutCompleted?: string | null;
  workoutRating?: unknown;
  workoutSnapshot?: unknown;
  workoutDraft?: { workoutId: string; workoutName?: string; exercises?: Array<Record<string, unknown>> } | null;
  meals?: unknown[];
  notes?: string;
  steps?: number | null;
  dayClosed?: boolean;
  isOffDay?: boolean;
  [k: string]: unknown;
};

/**
 * За сколько дней назад сливаем журнал.
 *
 * Строки WorkoutLogEntry/DayLogEntry копятся вечно (~1700 и ~2200 в год
 * на человека), а функция вызывается на каждой загрузке приложения,
 * каждом опросе сервера и каждом сообщении в чат. Без окна это означало
 * чтение всей истории и сериализацию «всех дней за всё время» в ответ.
 *
 * 400 дней хватает: год назад плюс запас, чтобы графики «год к году» и
 * сравнение сезонов не теряли данные.
 */
const MERGE_WINDOW_DAYS = 400;

export async function getMergedDayLogs(prisma: any, userId: string): Promise<Record<string, LegacyDayLog>> {
  const cutoff = new Date(Date.now() - MERGE_WINDOW_DAYS * 86_400_000)
    .toISOString().slice(0, 10);

  const [fd, workoutRows, dayRows] = await Promise.all([
    // programArchive целиком тут не нужен — из него берётся только самая
    // поздняя archivedAt. Полный архив у активного пользователя под
    // мегабайт, и он ехал в функцию на каждое сообщение в чат.
    prisma.fitnessData.findUnique({ where: { userId }, select: { dayLogs: true, workouts: true } }),
    prisma.workoutLogEntry.findMany({ where: { userId, deletedAt: null, date: { gte: cutoff } } }),
    prisma.dayLogEntry.findMany({ where: { userId, deletedAt: null, date: { gte: cutoff } } }),
  ]);

  // Дата смены текущей программы — одним запросом по архиву, без
  // вытаскивания самих программ.
  const archiveRows: Array<{ at: string | null }> = await prisma.$queryRaw`
    SELECT max(a->>'archivedAt') AS at
    FROM "FitnessData" f,
         jsonb_array_elements(COALESCE(f."programArchive", '[]')::jsonb) AS a
    WHERE f."userId" = ${userId}
  `.catch(() => []);

  // Workout templates keyed by id — used to reconstruct exercise metadata
  // (name, plannedSets, restTime…) when a day has WorkoutLogEntry rows but no
  // legacy workoutDraft.exercises to copy from. Without this, a day where
  // only per-row writes exist would show as "0 completed" in the calendar
  // because we'd have nothing to merge the completed flag onto.
  const workoutsTemplate = (fd?.workouts ?? []) as Array<{ id: string; name: string; exercises: Array<Record<string, unknown>> }>;
  const templateById = new Map<string, typeof workoutsTemplate[number]>();
  for (const w of workoutsTemplate) if (w && w.id) templateById.set(w.id, w);

  // С какой даты действует ТЕКУЩАЯ программа. id упражнений (1..7)
  // переиспользуются между программами, поэтому подставлять сегодняшние
  // названия в день, тренированный по прошлой программе, нельзя: вес жима
  // становился «весом отведений гантелей» в истории «прошлый раз».
  const latestArchivedAt = archiveRows[0]?.at;
  const currentProgramSince = typeof latestArchivedAt === 'string'
    ? latestArchivedAt.slice(0, 10)
    : '';

  const base: Record<string, LegacyDayLog> = {};
  const legacy = (fd?.dayLogs ?? {}) as Record<string, LegacyDayLog>;
  for (const [date, log] of Object.entries(legacy)) {
    base[date] = { ...log, date };
  }
  const ensure = (date: string): LegacyDayLog => {
    if (!base[date]) {
      base[date] = {
        date, selectedWorkout: null, workoutCompleted: null, workoutRating: null,
        workoutSnapshot: null, workoutDraft: null, meals: [], notes: '',
        steps: null, dayClosed: false, isOffDay: false,
      };
    }
    return base[date];
  };

  // Apply DayLogEntry kinds on top of legacy. These are authoritative for
  // per-field updates because the client writes them on every save.
  for (const r of dayRows) {
    const day = ensure(r.date);
    switch (r.kind) {
      case 'dayClosed':          day.dayClosed = !!r.payload; break;
      case 'workoutCompleted':   day.workoutCompleted = (r.payload ?? null) as string | null; break;
      case 'workoutSnapshot':    day.workoutSnapshot = r.payload; break;
      case 'isOffDay':           day.isOffDay = !!r.payload; break;
      case 'steps':              day.steps = (r.payload ?? null) as number | null; break;
      case 'workoutRating':      day.workoutRating = r.payload; break;
      case 'selectedWorkout':    day.selectedWorkout = (r.payload ?? null) as string | null; break;
      case 'notes':              if (typeof r.payload === 'string') day.notes = r.payload; break;
      case 'meals':              if (Array.isArray(r.payload)) day.meals = r.payload as unknown[]; break;
      default: /* unknown kind — leave alone */ break;
    }
  }

  // Apply WorkoutLogEntry rows by rebuilding `workoutDraft.exercises`.
  // Group rows by date so we can construct one draft per day.
  const byDate = new Map<string, typeof workoutRows>();
  for (const r of workoutRows) {
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date)!.push(r);
  }
  for (const [date, rows] of byDate) {
    const day = ensure(date);
    // A closed day stays on its snapshot — per-row edits on a closed day are
    // ignored (same rule as the client's hydrate step).
    if (day.dayClosed) continue;
    const workoutId = rows.find((r: any) => r.workoutId)?.workoutId
      ?? day.workoutDraft?.workoutId
      ?? day.selectedWorkout
      ?? null;
    if (!workoutId) continue;
    // Prefer existing draft exercises, fall back to snapshot, then to the
    // workout template by id. The template always has up-to-date metadata
    // (name, plannedSets, restTime) even if the day never had a draft saved.
    // Шаблон подставляем только дням текущей программы (или когда архива нет).
    const templateAllowed = !currentProgramSince || date >= currentProgramSince;
    const existingExercises = (
      day.workoutDraft?.exercises
      ?? (day.workoutSnapshot as any)?.exercises
      ?? (templateAllowed ? (templateById.get(workoutId)?.exercises as Array<Record<string, unknown>> | undefined) : undefined)
      ?? []
    ) as Array<Record<string, unknown>>;
    const exMap = new Map<string, Record<string, unknown>>();
    for (const e of existingExercises) exMap.set(String(e.id), { ...e });
    for (const r of rows) {
      const prevEx = exMap.get(String(r.exerciseId));
      if (!prevEx) {
        // Exercise exists in per-row store but not in template (e.g. exercise
        // was deleted from the template after this session). Keep the
        // completion flag at least, so the calendar still counts the day.
        exMap.set(String(r.exerciseId), {
          id: r.exerciseId,
          name: '',
          completed: r.completed,
          actualSets: r.actualSets ?? '',
          notes: r.notes ?? '',
        });
        continue;
      }
      prevEx.completed = r.completed;
      if (r.actualSets !== null && r.actualSets !== undefined) {
        // The same JSON column carries the legacy free-text string AND the new
        // structured per-set array. Distinguish on shape so we hydrate the
        // matching field on the client-facing exercise.
        if (Array.isArray(r.actualSets)) prevEx.sets = r.actualSets;
        else prevEx.actualSets = r.actualSets;
      }
      if (r.notes !== null && r.notes !== undefined) prevEx.notes = r.notes;
    }
    const templateName = templateById.get(workoutId)?.name;
    day.workoutDraft = {
      workoutId,
      workoutName: (day.workoutDraft?.workoutName as string | undefined)
        ?? ((day.workoutSnapshot as any)?.workoutName as string | undefined)
        ?? templateName
        ?? '',
      exercises: Array.from(exMap.values()),
    };
  }

  // ── Выкидываем тяжёлые base64-картинки из снапшотов/драфтов дней ──
  // У пользователя dayLogs раздувались до ~10 МБ (246 вшитых base64-картинок
  // упражнений), и ответ /api/fitness не догружался на телефоне → календарь
  // тренировок оставался ПУСТЫМ. Картинки упражнений и так лежат в
  // exerciseLibrary; в снапшоте дня нужен только completed/sets. Срезаем
  // imageUrl со всех exercises, если это data:-URI (обычные URL оставляем).
  const stripImg = (exs?: Array<Record<string, unknown>> | null) => {
    if (!Array.isArray(exs)) return;
    for (const e of exs) {
      if (typeof e.imageUrl === 'string' && e.imageUrl.startsWith('data:')) delete e.imageUrl;
    }
  };
  for (const day of Object.values(base)) {
    stripImg((day.workoutDraft as any)?.exercises);
    stripImg((day.workoutSnapshot as any)?.exercises);
  }

  return base;
}
