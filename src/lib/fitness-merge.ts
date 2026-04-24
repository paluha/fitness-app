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

export async function getMergedDayLogs(prisma: any, userId: string): Promise<Record<string, LegacyDayLog>> {
  const [fd, workoutRows, dayRows] = await Promise.all([
    prisma.fitnessData.findUnique({ where: { userId }, select: { dayLogs: true, workouts: true } }),
    prisma.workoutLogEntry.findMany({ where: { userId, deletedAt: null } }),
    prisma.dayLogEntry.findMany({ where: { userId, deletedAt: null } }),
  ]);

  // Workout templates keyed by id — used to reconstruct exercise metadata
  // (name, plannedSets, restTime…) when a day has WorkoutLogEntry rows but no
  // legacy workoutDraft.exercises to copy from. Without this, a day where
  // only per-row writes exist would show as "0 completed" in the calendar
  // because we'd have nothing to merge the completed flag onto.
  const workoutsTemplate = (fd?.workouts ?? []) as Array<{ id: string; name: string; exercises: Array<Record<string, unknown>> }>;
  const templateById = new Map<string, typeof workoutsTemplate[number]>();
  for (const w of workoutsTemplate) if (w && w.id) templateById.set(w.id, w);

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
    const existingExercises = (
      day.workoutDraft?.exercises
      ?? (day.workoutSnapshot as any)?.exercises
      ?? (templateById.get(workoutId)?.exercises as Array<Record<string, unknown>> | undefined)
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
      if (r.actualSets !== null && r.actualSets !== undefined) prevEx.actualSets = r.actualSets;
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

  return base;
}
