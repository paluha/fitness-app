import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';

// Generate unique client ID like TX001, TX002, etc.
async function generateClientId(): Promise<string> {
  const prefix = 'TX';

  // Find the highest existing clientId
  const lastClient = await prisma.user.findFirst({
    where: {
      clientId: {
        startsWith: prefix
      }
    },
    orderBy: {
      clientId: 'desc'
    },
    select: {
      clientId: true
    }
  });

  let nextNumber = 1;
  if (lastClient?.clientId) {
    const numPart = lastClient.clientId.replace(prefix, '');
    nextNumber = parseInt(numPart, 10) + 1;
  }

  return `${prefix}${nextNumber.toString().padStart(3, '0')}`;
}

// Get all clients for a trainer
export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== 'TRAINER') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const clients = await prisma.user.findMany({
      where: {
        role: 'CLIENT',
        trainerId: session.user.id
      },
      select: {
        id: true,
        clientId: true,
        firstName: true,
        lastName: true,
        name: true,
        email: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    return NextResponse.json({ clients });
  } catch (error) {
    console.error('Get clients error:', error);
    return NextResponse.json({ error: 'Failed to fetch clients' }, { status: 500 });
  }
}

// Create a new client
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== 'TRAINER') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { firstName, lastName, email, password } = await request.json();

    if (!firstName || !lastName || !email || !password) {
      return NextResponse.json({ error: 'All fields are required' }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
    }

    // Check if email already exists
    const existingUser = await prisma.user.findUnique({
      where: { email }
    });

    if (existingUser) {
      return NextResponse.json({ error: 'User with this email already exists' }, { status: 409 });
    }

    // Generate unique client ID
    const clientId = await generateClientId();

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create client
    const client = await prisma.user.create({
      data: {
        clientId,
        firstName,
        lastName,
        name: `${firstName} ${lastName}`,
        email,
        password: hashedPassword,
        role: 'CLIENT',
        trainerId: session.user.id
      },
      select: {
        id: true,
        clientId: true,
        firstName: true,
        lastName: true,
        name: true,
        email: true,
        createdAt: true
      }
    });

    return NextResponse.json({ client }, { status: 201 });
  } catch (error) {
    console.error('Create client error:', error);
    return NextResponse.json({ error: 'Failed to create client' }, { status: 500 });
  }
}
