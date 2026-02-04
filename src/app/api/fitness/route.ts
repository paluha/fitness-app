import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// For now, use a fixed user ID since we don't have auth yet
const USER_ID = 'default-user';

// GET - Fetch fitness data
export async function GET() {
  try {
    // Ensure user exists
    await prisma.user.upsert({
      where: { id: USER_ID },
      update: {},
      create: { id: USER_ID, email: 'fitness@app.local' }
    });

    const fitnessData = await prisma.fitnessData.findUnique({
      where: { userId: USER_ID }
    });

    if (!fitnessData) {
      return NextResponse.json({ workouts: null, dayLogs: null, progressHistory: null });
    }

    return NextResponse.json({
      workouts: fitnessData.workouts,
      dayLogs: fitnessData.dayLogs,
      progressHistory: fitnessData.progressHistory
    });
  } catch (error) {
    console.error('Error fetching fitness data:', error);
    return NextResponse.json({ workouts: null, dayLogs: null, progressHistory: null });
  }
}

// POST - Save fitness data
export async function POST(request: Request) {
  try {
    const { workouts, dayLogs, progressHistory } = await request.json();

    // Ensure user exists
    await prisma.user.upsert({
      where: { id: USER_ID },
      update: {},
      create: { id: USER_ID, email: 'fitness@app.local' }
    });

    const fitnessData = await prisma.fitnessData.upsert({
      where: { userId: USER_ID },
      update: {
        workouts: workouts || {},
        dayLogs: dayLogs || {},
        progressHistory: progressHistory || {},
        updatedAt: new Date()
      },
      create: {
        userId: USER_ID,
        workouts: workouts || {},
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
