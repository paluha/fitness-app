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

    // Get client with fitness data
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
        createdAt: client.createdAt
      },
      fitnessData: {
        workouts: client.fitnessData?.workouts || null,
        dayLogs: client.fitnessData?.dayLogs || {},
        progressHistory: client.fitnessData?.progressHistory || {},
        bodyMeasurements: client.fitnessData?.bodyMeasurements || [],
        lastUpdated: client.fitnessData?.updatedAt || null
      }
    });
  } catch (error) {
    console.error('Get client data error:', error);
    return NextResponse.json({ error: 'Failed to fetch client data' }, { status: 500 });
  }
}
