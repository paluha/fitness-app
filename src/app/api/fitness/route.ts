import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

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

    return NextResponse.json({
      workouts: fitnessData?.workouts || null,
      dayLogs: fitnessData?.dayLogs || null,
      progressHistory: fitnessData?.progressHistory || null,
      bodyMeasurements: fitnessData?.bodyMeasurements || null,
      favoriteMeals: fitnessData?.favoriteMeals || null,
      plannerEvents: fitnessData?.plannerEvents || null,
      nutritionRecommendations: user.program?.nutritionRecommendations || null,
      settings: {
        language: user.language || 'ru',
        timezone: user.timezone || 'Europe/Moscow',
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
      settings: { language: 'ru', timezone: 'Europe/Moscow' }
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
    const body = await request.json();

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
    // Don't wipe plannerEvents if client sends empty array but server has data
    if (body.plannerEvents !== undefined && Array.isArray(body.plannerEvents) && body.plannerEvents.length === 0) {
      delete body.plannerEvents;
    }

    // Fetch existing data once for merge operations
    const existing = await prisma.fitnessData.findUnique({
      where: { userId },
      select: { dayLogs: true, progressHistory: true, plannerEvents: true }
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
    // Merge plannerEvents: client events take priority by ID, server-only events (from bot) preserved
    if (body.plannerEvents !== undefined) {
      const clientEvents = (body.plannerEvents as Array<{ id: string }>) || [];
      const serverEvents = (existing?.plannerEvents as Array<{ id: string }>) || [];
      const clientIds = new Set(clientEvents.map((e: { id: string }) => e.id));
      // Keep server events that client doesn't have (added by bot while page was open)
      const botOnlyEvents = serverEvents.filter((e: { id: string }) => !clientIds.has(e.id));
      updateData.plannerEvents = [...clientEvents, ...botOnlyEvents];
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
        plannerEvents: body.plannerEvents || []
      }
    });

    return NextResponse.json({ success: true, updatedAt: fitnessData.updatedAt });
  } catch (error) {
    console.error('Error saving fitness data:', error);
    return NextResponse.json({ error: 'Failed to save fitness data' }, { status: 500 });
  }
}
