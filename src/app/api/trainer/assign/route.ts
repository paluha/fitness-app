import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// POST - Assign program to client
export async function POST(request: Request) {
  try {
    const { clientId, programId } = await request.json();

    await prisma.user.update({
      where: { id: clientId },
      data: { programId: programId || null }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error assigning program:', error);
    return NextResponse.json({ error: 'Failed to assign program' }, { status: 500 });
  }
}
