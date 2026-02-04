import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const TRAINER_ID = 'demo-trainer';

// POST - Create new program
export async function POST(request: Request) {
  try {
    const { name, workouts, activeWorkoutDays } = await request.json();

    const program = await prisma.trainingProgram.create({
      data: {
        name,
        trainerId: TRAINER_ID,
        workouts: workouts || [],
        activeWorkoutDays: activeWorkoutDays || 4
      },
      include: {
        _count: {
          select: { clients: true }
        }
      }
    });

    return NextResponse.json({
      id: program.id,
      name: program.name,
      workouts: program.workouts,
      activeWorkoutDays: program.activeWorkoutDays,
      clientCount: program._count.clients
    });
  } catch (error) {
    console.error('Error creating program:', error);
    return NextResponse.json({ error: 'Failed to create program' }, { status: 500 });
  }
}

// PUT - Update existing program
export async function PUT(request: Request) {
  try {
    const { id, name, workouts, activeWorkoutDays } = await request.json();

    const program = await prisma.trainingProgram.update({
      where: { id },
      data: {
        name,
        workouts: workouts || [],
        activeWorkoutDays: activeWorkoutDays || 4,
        updatedAt: new Date()
      },
      include: {
        _count: {
          select: { clients: true }
        }
      }
    });

    return NextResponse.json({
      id: program.id,
      name: program.name,
      workouts: program.workouts,
      activeWorkoutDays: program.activeWorkoutDays,
      clientCount: program._count.clients
    });
  } catch (error) {
    console.error('Error updating program:', error);
    return NextResponse.json({ error: 'Failed to update program' }, { status: 500 });
  }
}

// DELETE - Delete program
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Program ID required' }, { status: 400 });
    }

    // First, unassign all clients from this program
    await prisma.user.updateMany({
      where: { programId: id },
      data: { programId: null }
    });

    // Then delete the program
    await prisma.trainingProgram.delete({
      where: { id }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting program:', error);
    return NextResponse.json({ error: 'Failed to delete program' }, { status: 500 });
  }
}
