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

    // Build update object - only include fields that were explicitly passed
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (body.workouts !== undefined) updateData.workouts = body.workouts;
    if (body.dayLogs !== undefined) updateData.dayLogs = body.dayLogs;
    if (body.progressHistory !== undefined) updateData.progressHistory = body.progressHistory;
    if (body.bodyMeasurements !== undefined) updateData.bodyMeasurements = body.bodyMeasurements;
    if (body.favoriteMeals !== undefined) updateData.favoriteMeals = body.favoriteMeals;

    const fitnessData = await prisma.fitnessData.upsert({
      where: { userId },
      update: updateData,
      create: {
        userId,
        workouts: body.workouts || [],
        dayLogs: body.dayLogs || {},
        progressHistory: body.progressHistory || {},
        bodyMeasurements: body.bodyMeasurements || [],
        favoriteMeals: body.favoriteMeals || []
      }
    });

    return NextResponse.json({ success: true, updatedAt: fitnessData.updatedAt });
  } catch (error) {
    console.error('Error saving fitness data:', error);
    return NextResponse.json({ error: 'Failed to save fitness data' }, { status: 500 });
  }
}
