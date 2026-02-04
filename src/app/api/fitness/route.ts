import { NextResponse } from 'next/server';

// Simple API that returns empty data - app works with localStorage
// When you set up database, uncomment the prisma imports

// GET - Return empty data (app uses localStorage as primary storage)
export async function GET() {
  return NextResponse.json({ workouts: null, dayLogs: null, progressHistory: null });
}

// POST - Accept data but don't persist (localStorage handles it)
export async function POST() {
  return NextResponse.json({ success: true, mode: 'local' });
}
