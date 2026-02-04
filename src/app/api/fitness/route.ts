import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// For now, use a fixed user ID since we don't have auth yet
const USER_ID = 'default-user';
const TRAINER_ID = 'demo-trainer';

// GET - Fetch fitness data
export async function GET() {
  try {
    // Ensure user exists
    await prisma.user.upsert({
      where: { id: USER_ID },
      update: {},
      create: {
        id: USER_ID,
        email: 'fitness@app.local',
        role: 'CLIENT',
        trainerId: TRAINER_ID
      }
    });

    // Get user's fitness data (day logs, progress)
    const fitnessData = await prisma.fitnessData.findUnique({
      where: { userId: USER_ID }
    });

    return NextResponse.json({
      workouts: fitnessData?.workouts || null,
      dayLogs: fitnessData?.dayLogs || null,
      progressHistory: fitnessData?.progressHistory || null
    });
  } catch (error) {
    console.error('Error fetching fitness data:', error);
    return NextResponse.json({
      hasProgram: false,
      programName: null,
      workouts: null,
      activeWorkoutDays: 0,
      dayLogs: null,
      progressHistory: null
    });
  }
}

// POST - Save fitness data (workouts, dayLogs, progressHistory)
export async function POST(request: Request) {
  try {
    const { workouts, dayLogs, progressHistory } = await request.json();

    // Ensure user exists
    await prisma.user.upsert({
      where: { id: USER_ID },
      update: {},
      create: {
        id: USER_ID,
        email: 'fitness@app.local',
        role: 'CLIENT',
        trainerId: TRAINER_ID
      }
    });

    const fitnessData = await prisma.fitnessData.upsert({
      where: { userId: USER_ID },
      update: {
        workouts: workouts || undefined,
        dayLogs: dayLogs || {},
        progressHistory: progressHistory || {},
        updatedAt: new Date()
      },
      create: {
        userId: USER_ID,
        workouts: workouts || [],
        dayLogs: dayLogs || {},
        progressHistory: progressHistory || {}
      }
    });

    return NextResponse.json({ success: true, updatedAt: fitnessData.updatedAt });
  } catch (error) {
    console.error('Error saving fitness data:', error);
    return NextResponse.json({ error: 'Failed to save fitness data' }, { status: 500 });
  }
}
