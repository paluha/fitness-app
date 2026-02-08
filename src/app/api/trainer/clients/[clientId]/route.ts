import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// Get client data for trainer
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== 'TRAINER') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { clientId } = await params;

    // Get client with fitness data and program
    const client = await prisma.user.findUnique({
      where: { id: clientId },
      select: {
        id: true,
        clientId: true,
        firstName: true,
        lastName: true,
        name: true,
        email: true,
        trainerId: true,
        createdAt: true,
        programId: true,
        program: {
          select: {
            id: true,
            name: true,
            nutritionRecommendations: true
          }
        },
        fitnessData: {
          select: {
            workouts: true,
            dayLogs: true,
            progressHistory: true,
            bodyMeasurements: true,
            updatedAt: true
          }
        }
      }
    });

    if (!client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }

    // Check if this client belongs to this trainer
    if (client.trainerId !== session.user.id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    return NextResponse.json({
      client: {
        id: client.id,
        clientId: client.clientId,
        firstName: client.firstName,
        lastName: client.lastName,
        name: client.name,
        email: client.email,
        createdAt: client.createdAt,
        programId: client.programId,
        programName: client.program?.name || null
      },
      fitnessData: {
        workouts: client.fitnessData?.workouts || null,
        dayLogs: client.fitnessData?.dayLogs || {},
        progressHistory: client.fitnessData?.progressHistory || {},
        bodyMeasurements: client.fitnessData?.bodyMeasurements || [],
        lastUpdated: client.fitnessData?.updatedAt || null
      },
      nutritionRecommendations: client.program?.nutritionRecommendations || null
    });
  } catch (error) {
    console.error('Get client data error:', error);
    return NextResponse.json({ error: 'Failed to fetch client data' }, { status: 500 });
  }
}

// Update client's nutrition recommendations
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== 'TRAINER') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { clientId } = await params;
    const { nutritionRecommendations } = await request.json();

    // Get client to verify ownership and get program
    const client = await prisma.user.findUnique({
      where: { id: clientId },
      select: {
        trainerId: true,
        programId: true
      }
    });

    if (!client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }

    if (client.trainerId !== session.user.id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // If client has a program, update the program's recommendations
    if (client.programId) {
      await prisma.trainingProgram.update({
        where: { id: client.programId },
        data: {
          nutritionRecommendations: nutritionRecommendations,
          updatedAt: new Date()
        }
      });
    } else {
      // Create a new program for this client with recommendations
      const program = await prisma.trainingProgram.create({
        data: {
          name: `Программа клиента`,
          trainerId: session.user.id,
          workouts: [],
          nutritionRecommendations: nutritionRecommendations
        }
      });

      // Assign the program to the client
      await prisma.user.update({
        where: { id: clientId },
        data: { programId: program.id }
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Update client recommendations error:', error);
    return NextResponse.json({ error: 'Failed to update recommendations' }, { status: 500 });
  }
}
