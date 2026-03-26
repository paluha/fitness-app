import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN_PLANNER;
const CHAT_ID = process.env.TELEGRAM_PLANNER_CHAT_ID;

const REMINDER_MINUTES: Record<string, number> = {
  '5m': 5,
  '1h': 60,
  '3h': 180,
  '1d': 1440,
  '2d': 2880,
};

const REMINDER_LABELS: Record<string, string> = {
  '5m': 'через 5 минут',
  '1h': 'через 1 час',
  '3h': 'через 3 часа',
  '1d': 'завтра',
  '2d': 'послезавтра',
};

async function sendTelegram(text: string) {
  if (!BOT_TOKEN || !CHAT_ID) return;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'Markdown' }),
  });
}

interface PlannerEvent {
  id: string;
  date: string;
  time: string;
  title: string;
  category: string;
  done: boolean;
  reminder: boolean;
  reminderOffsets?: string[];
  remindersSent?: string[];
}

const CATEGORY_EMOJI: Record<string, string> = {
  health: '🏥', business: '💼', personal: '👤', finance: '💰',
  fitness: '💪', travel: '✈️', other: '📌',
};

// GET — called by cron every minute
export async function GET(request: Request) {
  // Verify cron secret to prevent abuse
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const now = new Date();
    // Use NYC timezone
    const nowStr = now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const nowTime = now.toLocaleTimeString('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false });
    const nowMinutes = parseInt(nowTime.split(':')[0]) * 60 + parseInt(nowTime.split(':')[1]);

    // Get Pavel's data
    const user = await prisma.user.findFirst({
      where: { email: 'paveloshmanski@gmail.com' },
      select: { id: true }
    });
    if (!user) return NextResponse.json({ ok: true, sent: 0 });

    const fitnessData = await prisma.fitnessData.findUnique({
      where: { userId: user.id },
      select: { plannerEvents: true }
    });

    const events = (fitnessData?.plannerEvents as unknown as PlannerEvent[]) || [];
    let sent = 0;
    let updated = false;

    for (const event of events) {
      if (!event.date || !event.time || event.done || !event.reminder) continue;
      if (!event.reminderOffsets || event.reminderOffsets.length === 0) continue;

      // Calculate event time in minutes from midnight
      const [eh, em] = event.time.split(':').map(Number);
      const eventMinutes = eh * 60 + em;

      for (const offset of event.reminderOffsets) {
        const offsetMinutes = REMINDER_MINUTES[offset];
        if (!offsetMinutes) continue;

        // Already sent this reminder?
        const sentKey = `${event.id}_${offset}`;
        if (event.remindersSent?.includes(sentKey)) continue;

        // Calculate when to send: event datetime minus offset
        // For same-day events
        if (event.date === nowStr) {
          const triggerMinute = eventMinutes - offsetMinutes;
          // Send if we're within 2 minutes of the trigger time (cron runs every minute)
          if (nowMinutes >= triggerMinute && nowMinutes < triggerMinute + 2) {
            const emoji = CATEGORY_EMOJI[event.category] || '📌';
            const label = REMINDER_LABELS[offset] || offset;
            await sendTelegram(`🔔 *Напоминание*\n\n${emoji} *${event.title}*\n⏰ ${label} (${event.time})\n📅 Сегодня`);
            if (!event.remindersSent) event.remindersSent = [];
            event.remindersSent.push(sentKey);
            updated = true;
            sent++;
          }
        }

        // For future-day reminders (1d, 2d before)
        if (offsetMinutes >= 1440) {
          const eventDate = new Date(`${event.date}T${event.time}:00`);
          const triggerDate = new Date(eventDate.getTime() - offsetMinutes * 60000);
          const triggerDateStr = triggerDate.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
          const triggerTimeStr = triggerDate.toLocaleTimeString('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false });
          const [th, tm] = triggerTimeStr.split(':').map(Number);
          const triggerMinutes = th * 60 + tm;

          if (triggerDateStr === nowStr && nowMinutes >= triggerMinutes && nowMinutes < triggerMinutes + 2) {
            const emoji = CATEGORY_EMOJI[event.category] || '📌';
            const label = REMINDER_LABELS[offset] || offset;
            await sendTelegram(`🔔 *Напоминание*\n\n${emoji} *${event.title}*\n⏰ ${label} (${event.date} ${event.time})`);
            if (!event.remindersSent) event.remindersSent = [];
            event.remindersSent.push(sentKey);
            updated = true;
            sent++;
          }
        }
      }
    }

    // Save updated remindersSent flags
    if (updated) {
      await prisma.fitnessData.update({
        where: { userId: user.id },
        data: {
          plannerEvents: events as unknown as Prisma.InputJsonValue,
        },
      });
    }

    return NextResponse.json({ ok: true, sent, checked: events.length });
  } catch (error) {
    console.error('Reminder check error:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
