import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// For now, use a fixed trainer ID since we don't have auth yet
const TRAINER_ID = 'demo-trainer';

// GET - Fetch trainer data (programs and clients)
export async function GET() {
  try {
    // Ensure trainer user exists
    await prisma.user.upsert({
      where: { id: TRAINER_ID },
      update: {},
      create: {
        id: TRAINER_ID,
        email: 'trainer@app.local',
        name: 'Demo Trainer',
        role: 'TRAINER'
      }
    });

    // Get programs created by this trainer
    const programs = await prisma.trainingProgram.findMany({
      where: { trainerId: TRAINER_ID },
      include: {
        _count: {
          select: { clients: true }
        }
      }
    });

    // Get clients assigned to this trainer
    const clients = await prisma.user.findMany({
      where: {
        trainerId: TRAINER_ID,
        role: 'CLIENT'
      },
      select: {
        id: true,
        name: true,
        email: true,
        programId: true,
        program: {
          select: { name: true }
        },
        updatedAt: true
      }
    });

    return NextResponse.json({
      programs: programs.map(p => ({
        id: p.id,
        name: p.name,
        workouts: p.workouts,
        activeWorkoutDays: p.activeWorkoutDays,
        clientCount: p._count.clients
      })),
      clients: clients.map(c => ({
        id: c.id,
        name: c.name,
        email: c.email,
        programId: c.programId,
        programName: c.program?.name || null,
        lastActive: c.updatedAt?.toISOString() || null
      }))
    });
  } catch (error) {
    console.error('Error fetching trainer data:', error);
    return NextResponse.json({ programs: [], clients: [] });
  }
}
