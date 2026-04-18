import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { MAX_SNAPSHOTS_PER_USER } from '@/lib/fitness-snapshots';

// GET /api/fitness/snapshots — list recent snapshots (metadata only)
// GET /api/fitness/snapshots?id=<snapshotId> — fetch a specific snapshot's full data
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (id) {
      const snapshot = await prisma.fitnessSnapshot.findFirst({
        where: { id, userId },
      });
      if (!snapshot) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      return NextResponse.json({ id: snapshot.id, createdAt: snapshot.createdAt, data: snapshot.data });
    }

    // Metadata list, newest first
    const list = await prisma.fitnessSnapshot.findMany({
      where: { userId },
      select: { id: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: MAX_SNAPSHOTS_PER_USER,
    });
    return NextResponse.json({ snapshots: list });
  } catch (error) {
    console.error('[snapshots GET]', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

// POST /api/fitness/snapshots — restore a snapshot into FitnessData
// Body: { id: string }
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;
    const { id } = await request.json();
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const snap = await prisma.fitnessSnapshot.findFirst({ where: { id, userId } });
    if (!snap) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const data = snap.data as Record<string, unknown>;
    // Before restoring, take ONE MORE snapshot of the current state so the
    // restore itself is reversible.
    const current = await prisma.fitnessData.findUnique({ where: { userId } });
    if (current) {
      await prisma.fitnessSnapshot.create({
        data: {
          userId,
          data: {
            workouts: current.workouts,
            dayLogs: current.dayLogs,
            progressHistory: current.progressHistory,
            bodyMeasurements: current.bodyMeasurements,
            favoriteMeals: current.favoriteMeals,
            plannerEvents: current.plannerEvents,
            exerciseLibrary: current.exerciseLibrary,
            habits: current.habits,
            _note: 'auto-snapshot before restore of ' + id,
          } as object,
        },
      });
    }

    await prisma.fitnessData.upsert({
      where: { userId },
      update: {
        workouts: data.workouts ?? undefined,
        dayLogs: data.dayLogs ?? undefined,
        progressHistory: data.progressHistory ?? undefined,
        bodyMeasurements: data.bodyMeasurements ?? undefined,
        favoriteMeals: data.favoriteMeals ?? undefined,
        plannerEvents: data.plannerEvents ?? undefined,
        exerciseLibrary: data.exerciseLibrary ?? undefined,
        habits: data.habits ?? undefined,
      } as never,
      create: {
        userId,
        workouts: (data.workouts ?? []) as never,
        dayLogs: (data.dayLogs ?? {}) as never,
        progressHistory: (data.progressHistory ?? {}) as never,
        bodyMeasurements: (data.bodyMeasurements ?? []) as never,
        favoriteMeals: (data.favoriteMeals ?? []) as never,
        plannerEvents: (data.plannerEvents ?? []) as never,
        exerciseLibrary: (data.exerciseLibrary ?? {}) as never,
        habits: (data.habits ?? []) as never,
      },
    });

    return NextResponse.json({ success: true, restored: id });
  } catch (error) {
    console.error('[snapshots POST]', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

