import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// GET - Fetch user settings
export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        name: true,
        email: true,
        language: true,
        timezone: true
      }
    });

    return NextResponse.json({
      name: user?.name || '',
      email: user?.email || '',
      language: user?.language || 'ru',
      timezone: user?.timezone || 'Europe/Moscow'
    });
  } catch (error) {
    console.error('Error fetching settings:', error);
    return NextResponse.json({
      language: 'ru',
      timezone: 'Europe/Moscow'
    });
  }
}

// PUT - Update user settings
export async function PUT(request: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { name, language, timezone } = await request.json();

    const user = await prisma.user.update({
      where: { id: session.user.id },
      data: {
        name: name || undefined,
        language: language || undefined,
        timezone: timezone || undefined
      }
    });

    return NextResponse.json({
      success: true,
      name: user.name,
      language: user.language,
      timezone: user.timezone
    });
  } catch (error) {
    console.error('Error updating settings:', error);
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
  }
}
