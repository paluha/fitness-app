import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// Used by the client when the user hasn't set their own goals yet. Keep in
// sync with the fallback constant on the page side.
const FALLBACK_GOAL = { protein: 200, fat: 90, carbs: 200, calories: 2410 };

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
        timezone: true,
        theme: true,
        goalProtein: true,
        goalFat: true,
        goalCarbs: true,
        goalCalories: true,
      }
    });

    return NextResponse.json({
      name: user?.name || '',
      email: user?.email || '',
      language: user?.language || 'ru',
      timezone: user?.timezone || 'Europe/Moscow',
      theme: user?.theme || 'auto',
      goal: {
        protein: user?.goalProtein ?? FALLBACK_GOAL.protein,
        fat: user?.goalFat ?? FALLBACK_GOAL.fat,
        carbs: user?.goalCarbs ?? FALLBACK_GOAL.carbs,
        calories: user?.goalCalories ?? FALLBACK_GOAL.calories,
      },
    });
  } catch (error) {
    console.error('Error fetching settings:', error);
    return NextResponse.json({
      language: 'ru',
      timezone: 'Europe/Moscow',
      theme: 'auto',
      goal: FALLBACK_GOAL,
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

    const body = await request.json();
    const { name, language, timezone, theme, goal } = body;
    const themeOk = theme === 'light' || theme === 'dark' || theme === 'auto';

    // Goal: accept any subset of the four macros; clamp to non-negative
    // integers. Passing null on a field clears the override and restores
    // the fallback. Anything malformed is silently skipped — we'd rather
    // keep the old value than error the whole PUT for a typo.
    const goalUpdate: Record<string, number | null | undefined> = {};
    if (goal && typeof goal === 'object') {
      const map = [
        ['protein', 'goalProtein'],
        ['fat', 'goalFat'],
        ['carbs', 'goalCarbs'],
        ['calories', 'goalCalories'],
      ] as const;
      for (const [key, dbKey] of map) {
        if (!(key in goal)) continue;
        const v = (goal as Record<string, unknown>)[key];
        if (v === null) goalUpdate[dbKey] = null;
        else if (typeof v === 'number' && Number.isFinite(v) && v >= 0) goalUpdate[dbKey] = Math.round(v);
      }
    }

    const user = await prisma.user.update({
      where: { id: session.user.id },
      data: {
        name: name || undefined,
        language: language || undefined,
        timezone: timezone || undefined,
        theme: themeOk ? theme : undefined,
        ...goalUpdate,
      }
    });

    return NextResponse.json({
      success: true,
      name: user.name,
      language: user.language,
      timezone: user.timezone,
      theme: user.theme,
      goal: {
        protein: user.goalProtein ?? FALLBACK_GOAL.protein,
        fat: user.goalFat ?? FALLBACK_GOAL.fat,
        carbs: user.goalCarbs ?? FALLBACK_GOAL.carbs,
        calories: user.goalCalories ?? FALLBACK_GOAL.calories,
      },
    });
  } catch (error) {
    console.error('Error updating settings:', error);
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
  }
}
