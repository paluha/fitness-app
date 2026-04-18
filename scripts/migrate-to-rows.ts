/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Migrate FitnessData JSON blobs into the new per-row tables.
 *
 * Usage:
 *   npx tsx scripts/migrate-to-rows.ts           # dry run — prints what would change
 *   npx tsx scripts/migrate-to-rows.ts --apply   # actually writes rows
 *
 * Safe to run multiple times: upserts rows by (userId, date, exerciseId) / (userId, date, kind).
 * Will NOT delete old FitnessData. That file remains the source of truth until we flip the read path.
 */
import { PrismaClient } from '@prisma/client';

const APPLY = process.argv.includes('--apply');
const prisma = new PrismaClient();

type Exercise = {
  id?: string;
  name?: string;
  completed?: boolean;
  actualSets?: unknown;
  notes?: string;
};
type WorkoutDraft = { exercises?: Exercise[] };

function pickKind(day: Record<string, unknown>, key: string): { payload: unknown } | null {
  if (!(key in day)) return null;
  const v = day[key];
  if (v === undefined || v === null) return null;
  // Skip obviously-empty values to avoid polluting the table with noise
  if (Array.isArray(v) && v.length === 0) return null;
  if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0) return null;
  return { payload: v };
}

async function migrateUser(userId: string) {
  const fd = await prisma.fitnessData.findUnique({ where: { userId } });
  if (!fd || !fd.dayLogs) return { userId, days: 0, workoutRows: 0, dayRows: 0 };
  const dayLogs = fd.dayLogs as Record<string, Record<string, unknown>>;
  const fallbackTs = fd.updatedAt; // best guess when a row has no own timestamp

  let workoutRows = 0;
  let dayRows = 0;
  const days = Object.keys(dayLogs);

  for (const date of days) {
    const day = dayLogs[date] || {};
    // --- WorkoutLogEntry: one row per exercise in the draft ---
    const draft = day.workoutDraft as WorkoutDraft | undefined;
    const workoutId = (day.selectedWorkout as any)?.id || null;
    const exercises = Array.isArray(draft?.exercises) ? draft!.exercises! : [];
    for (const ex of exercises) {
      if (!ex?.id) continue;
      workoutRows++;
      if (!APPLY) continue;
      await prisma.workoutLogEntry.upsert({
        where: { userId_date_exerciseId: { userId, date, exerciseId: ex.id } },
        create: {
          userId,
          date,
          exerciseId: ex.id,
          workoutId,
          completed: !!ex.completed,
          actualSets: (ex.actualSets as never) ?? null,
          notes: ex.notes ?? null,
          clientId: 'migration',
          clientUpdatedAt: fallbackTs,
        },
        // Migration only fills missing rows — don't clobber any real edits the
        // user may have made through the new API in the meantime.
        update: {},
      });
    }

    // --- DayLogEntry: one row per non-workout kind ---
    const kinds = ['meals', 'steps', 'notes', 'mood', 'isOffDay', 'dayClosed', 'workoutCompleted', 'workoutRating', 'selectedWorkout', 'workoutSnapshot'];
    for (const kind of kinds) {
      const picked = pickKind(day, kind);
      if (!picked) continue;
      dayRows++;
      if (!APPLY) continue;
      await prisma.dayLogEntry.upsert({
        where: { userId_date_kind: { userId, date, kind } },
        create: {
          userId,
          date,
          kind,
          payload: picked.payload as never,
          clientId: 'migration',
          clientUpdatedAt: fallbackTs,
        },
        update: {},
      });
    }
  }

  return { userId, days: days.length, workoutRows, dayRows };
}

async function main() {
  const users = await prisma.fitnessData.findMany({ select: { userId: true } });
  console.log((APPLY ? 'APPLY ' : 'DRY   ') + 'migrating ' + users.length + ' users');
  let totalExercises = 0;
  let totalKinds = 0;
  for (const { userId } of users) {
    const r = await migrateUser(userId);
    totalExercises += r.workoutRows;
    totalKinds += r.dayRows;
    console.log(' user=' + r.userId.slice(0, 12) + '.. days=' + r.days + ' exercises=' + r.workoutRows + ' kinds=' + r.dayRows);
  }
  console.log('TOTAL exercises=' + totalExercises + ' kinds=' + totalKinds);
  if (!APPLY) console.log('\nRe-run with --apply to actually write rows.');
  await prisma.$disconnect();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
