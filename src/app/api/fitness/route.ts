import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createSnapshotForUser } from '@/lib/fitness-snapshots';
import { getMergedDayLogs } from '@/lib/fitness-merge';

// GET - Fetch fitness data
export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;

    // Get user data with program
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        program: {
          select: {
            nutritionRecommendations: true
          }
        }
      }
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Get user's fitness data (day logs, progress)
    const fitnessData = await prisma.fitnessData.findUnique({
      where: { userId }
    });

    // Merge the legacy dayLogs JSON with per-row WorkoutLogEntry and DayLogEntry
    // so any client gets a consistent snapshot of day state on the very first
    // request, without having to wait for the client-side Dexie hydration loop.
    const mergedDayLogs = await getMergedDayLogs(prisma, userId);

    return NextResponse.json({
      workouts: fitnessData?.workouts || null,
      dayLogs: mergedDayLogs,
      progressHistory: fitnessData?.progressHistory || null,
      bodyMeasurements: fitnessData?.bodyMeasurements || null,
      favoriteMeals: fitnessData?.favoriteMeals || null,
      plannerEvents: fitnessData?.plannerEvents || null,
      exerciseLibrary: fitnessData?.exerciseLibrary || null,
      habits: fitnessData?.habits || null,
      nutritionRecommendations: user.program?.nutritionRecommendations || null,
      settings: {
        language: user.language || 'ru',
        timezone: user.timezone || 'Europe/Moscow',
        theme: user.theme || 'auto',
        name: user.name,
        email: user.email
      }
    });
  } catch (error) {
    console.error('Error fetching fitness data:', error);
    return NextResponse.json({
      workouts: null,
      dayLogs: null,
      progressHistory: null,
      bodyMeasurements: null,
      favoriteMeals: null,
      nutritionRecommendations: null,
      settings: { language: 'ru', timezone: 'Europe/Moscow', theme: 'auto' }
    });
  }
}

// POST - Save fitness data (workouts, dayLogs, progressHistory, bodyMeasurements, favoriteMeals)
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;
    // Handle both JSON and text/plain (sendBeacon) content types
    let body;
    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      body = await request.json();
    } else {
      const text = await request.text();
      body = JSON.parse(text);
    }

    // Safety: reject empty data — prevents accidental wipe from race conditions
    if (body.dayLogs !== undefined && typeof body.dayLogs === 'object' && Object.keys(body.dayLogs).length === 0) {
      delete body.dayLogs;
    }
    if (body.progressHistory !== undefined && typeof body.progressHistory === 'object' && Object.keys(body.progressHistory).length === 0) {
      delete body.progressHistory;
    }
    if (body.workouts !== undefined && Array.isArray(body.workouts) && body.workouts.length === 0) {
      delete body.workouts;
    }
    if (body.bodyMeasurements !== undefined && Array.isArray(body.bodyMeasurements) && body.bodyMeasurements.length === 0) {
      delete body.bodyMeasurements;
    }
    // plannerEvents: trust client — deletions must persist, empty array = user cleared all

    // Fetch existing data once for merge operations
    const existing = await prisma.fitnessData.findUnique({
      where: { userId },
      select: { dayLogs: true, progressHistory: true, plannerEvents: true, exerciseLibrary: true }
    });

    // Merge dayLogs: client keys take priority, existing keys preserved
    let mergedDayLogs: Record<string, unknown> | undefined;
    if (body.dayLogs !== undefined) {
      const existingLogs = (existing?.dayLogs as Record<string, unknown>) || {};
      mergedDayLogs = { ...existingLogs, ...body.dayLogs };
    }

    // Merge progressHistory: same merge strategy as dayLogs
    let mergedProgress: Record<string, unknown> | undefined;
    if (body.progressHistory !== undefined) {
      const existingProgress = (existing?.progressHistory as Record<string, unknown>) || {};
      mergedProgress = { ...existingProgress, ...body.progressHistory };
    }

    // Build update object - only include fields that were explicitly passed
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (body.workouts !== undefined) updateData.workouts = body.workouts;
    if (mergedDayLogs !== undefined) updateData.dayLogs = mergedDayLogs;
    if (mergedProgress !== undefined) updateData.progressHistory = mergedProgress;
    if (body.bodyMeasurements !== undefined) updateData.bodyMeasurements = body.bodyMeasurements;
    if (body.favoriteMeals !== undefined) updateData.favoriteMeals = body.favoriteMeals;
    // plannerEvents: client is source of truth (bot events load on page refresh)
    if (body.plannerEvents !== undefined) {
      updateData.plannerEvents = body.plannerEvents;
    }
    if (body.habits !== undefined) updateData.habits = body.habits;
    // exerciseLibrary: merge — new images added, existing preserved
    if (body.exerciseLibrary !== undefined) {
      const existingLib = (existing?.exerciseLibrary as Record<string, string>) || {};
      updateData.exerciseLibrary = { ...existingLib, ...body.exerciseLibrary };
    }

    const fitnessData = await prisma.fitnessData.upsert({
      where: { userId },
      update: updateData,
      create: {
        userId,
        workouts: body.workouts || [],
        dayLogs: body.dayLogs || {},
        progressHistory: body.progressHistory || {},
        bodyMeasurements: body.bodyMeasurements || [],
        favoriteMeals: body.favoriteMeals || [],
        plannerEvents: body.plannerEvents || [],
        exerciseLibrary: body.exerciseLibrary || {},
        habits: body.habits || []
      }
    });

    // Rolling backup of the full post-write state. Non-blocking: even if the
    // snapshot fails we still return success because the main save is done.
    await createSnapshotForUser(userId, {
      workouts: fitnessData.workouts,
      dayLogs: fitnessData.dayLogs,
      progressHistory: fitnessData.progressHistory,
      bodyMeasurements: fitnessData.bodyMeasurements,
      favoriteMeals: fitnessData.favoriteMeals,
      plannerEvents: fitnessData.plannerEvents,
      exerciseLibrary: fitnessData.exerciseLibrary,
      habits: fitnessData.habits,
    });

    return NextResponse.json({ success: true, updatedAt: fitnessData.updatedAt });
  } catch (error) {
    console.error('Error saving fitness data:', error);
    return NextResponse.json({ error: 'Failed to save fitness data' }, { status: 500 });
  }
}
