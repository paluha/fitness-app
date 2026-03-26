import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '@/lib/prisma';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN_PLANNER;
const ALLOWED_CHAT_ID = process.env.TELEGRAM_PLANNER_CHAT_ID;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Send message back to Telegram
async function sendTelegram(chatId: number | string, text: string) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  });
}

// Get today's date in user timezone
function getTodayStr(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function getTomorrowStr(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

// Parse Claude's response to structured planner event
async function parseWithClaude(message: string): Promise<{
  action: 'add_event' | 'add_todo' | 'add_idea' | 'list' | 'unknown';
  title?: string;
  description?: string;
  date?: string;
  time?: string;
  category?: string;
  priority?: string;
  reply: string;
}> {
  if (!ANTHROPIC_API_KEY) {
    return { action: 'unknown', reply: 'Claude API key not configured' };
  }

  const today = getTodayStr();
  const tomorrow = getTomorrowStr();

  // Get day of week for context
  const now = new Date();
  const dayOfWeek = now.toLocaleDateString('ru-RU', { weekday: 'long', timeZone: 'America/New_York' });

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 500,
    system: `You are Alisa, a personal assistant bot for a planner app. Your job is to parse user messages (usually in Russian) and extract structured data for their planner.

Today is ${today} (${dayOfWeek}). Tomorrow is ${tomorrow}.

Reply ONLY with valid JSON (no markdown, no code blocks, just raw JSON):
{
  "action": "add_event" | "add_todo" | "add_idea" | "list",
  "title": "short title",
  "description": "optional details",
  "date": "YYYY-MM-DD or empty",
  "time": "HH:MM or empty",
  "category": "health" | "business" | "personal" | "finance" | "fitness" | "travel" | "other",
  "priority": "high" | "medium" | "low",
  "reply": "friendly confirmation in Russian"
}

Rules:
- "завтра в 14:00 стоматолог" → add_event, date=tomorrow, time=14:00, category=health
- "купить продукты" → add_todo, no date, category=personal
- "идея: сделать лендинг для X" → add_idea, category=business
- "через неделю" = today + 7 days, "послезавтра" = today + 2 days
- "в понедельник" = next Monday from today
- "список" or "что на сегодня" → action=list
- If user just chats or says hi, action=unknown and reply friendly
- reply should be short, friendly, in Russian, confirming what was added
- For add_todo without explicit date, leave date empty`,
    messages: [{ role: 'user', content: message }],
  });

  try {
    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    // Try to extract JSON from response (handle if wrapped in markdown)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return { action: 'unknown', reply: 'Не удалось обработать сообщение. Попробуй ещё раз.' };
  } catch {
    return { action: 'unknown', reply: 'Ошибка обработки. Попробуй сформулировать иначе.' };
  }
}

// Find user by Telegram chat ID — for now hardcoded to the first user
async function getUserId(): Promise<string | null> {
  // Get the first user (single-user app for now)
  const user = await prisma.user.findFirst({ select: { id: true } });
  return user?.id || null;
}

// Add event to planner
async function addToPlan(userId: string, event: {
  title: string; description?: string; date?: string; time?: string;
  category?: string; priority?: string;
  type: 'event' | 'todo' | 'idea';
}) {
  const fitnessData = await prisma.fitnessData.findUnique({
    where: { userId },
    select: { plannerEvents: true }
  });

  const existingEvents = (fitnessData?.plannerEvents as unknown[]) || [];
  const newEvent = {
    id: `ev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    date: event.date || '',
    time: event.time || '',
    title: event.title,
    description: event.description || '',
    category: event.category || 'other',
    done: false,
    reminder: event.type === 'event',
    type: event.type,
    priority: event.priority || 'medium',
  };

  await prisma.fitnessData.update({
    where: { userId },
    data: {
      plannerEvents: [...existingEvents, newEvent] as unknown as undefined,
      updatedAt: new Date(),
    },
  });

  return newEvent;
}

// Get today's events for listing
async function getTodayEvents(userId: string): Promise<string> {
  const fitnessData = await prisma.fitnessData.findUnique({
    where: { userId },
    select: { plannerEvents: true }
  });

  const events = ((fitnessData?.plannerEvents || []) as Array<{
    type: string; date: string; time: string; title: string; done: boolean; category: string;
  }>);
  const today = getTodayStr();
  const tomorrow = getTomorrowStr();

  const todayEvents = events.filter(e => e.date === today && !e.done);
  const tomorrowEvents = events.filter(e => e.date === tomorrow && !e.done);
  const todos = events.filter(e => e.type === 'todo' && !e.done);

  const lines: string[] = [];

  if (todayEvents.length > 0) {
    lines.push('📅 *Сегодня:*');
    todayEvents.forEach(e => {
      lines.push(`  ${e.time ? e.time + ' — ' : ''}${e.title}`);
    });
  } else {
    lines.push('📅 *Сегодня:* нет событий');
  }

  if (tomorrowEvents.length > 0) {
    lines.push('');
    lines.push('🔜 *Завтра:*');
    tomorrowEvents.forEach(e => {
      lines.push(`  ${e.time ? e.time + ' — ' : ''}${e.title}`);
    });
  }

  if (todos.length > 0) {
    lines.push('');
    lines.push(`📋 *Дела (${todos.length}):*`);
    todos.slice(0, 5).forEach(e => {
      lines.push(`  • ${e.title}`);
    });
    if (todos.length > 5) lines.push(`  _...и ещё ${todos.length - 5}_`);
  }

  return lines.join('\n') || 'Ничего не запланировано 🎉';
}

export async function POST(request: Request) {
  let chatId: number | string | null = null;
  try {
    const body = await request.json();
    const message = body.message;

    if (!message?.text || !message?.chat?.id) {
      return NextResponse.json({ ok: true });
    }

    chatId = message.chat.id;

    // Security: only respond to allowed chat
    if (ALLOWED_CHAT_ID && String(chatId) !== ALLOWED_CHAT_ID) {
      await sendTelegram(chatId, '⛔ Доступ запрещён.');
      return NextResponse.json({ ok: true });
    }

    const text = message.text.trim();

    // Handle /start command
    if (text === '/start') {
      await sendTelegram(chatId,
        `👋 Привет! Я *Alisa* — твой персональный ассистент.\n\nПросто напиши мне что нужно сделать:\n\n📅 _"завтра в 14:00 стоматолог"_\n📋 _"купить продукты"_\n💡 _"идея: запустить рассылку"_\n📊 _"что на сегодня?"_\n\nЯ сама разберусь куда это добавить!`
      );
      return NextResponse.json({ ok: true });
    }

    // Parse with Claude
    const parsed = await parseWithClaude(text);

    const userId = await getUserId();
    if (!userId) {
      await sendTelegram(chatId, '❌ Пользователь не найден в системе.');
      return NextResponse.json({ ok: true });
    }

    if (parsed.action === 'list') {
      const list = await getTodayEvents(userId);
      await sendTelegram(chatId, list);
    } else if (parsed.action === 'add_event' || parsed.action === 'add_todo' || parsed.action === 'add_idea') {
      const type = parsed.action === 'add_event' ? 'event' : parsed.action === 'add_todo' ? 'todo' : 'idea';
      await addToPlan(userId, {
        title: parsed.title || text,
        description: parsed.description,
        date: parsed.date,
        time: parsed.time,
        category: parsed.category,
        priority: parsed.priority,
        type,
      });
      await sendTelegram(chatId, parsed.reply || '✅ Добавлено!');
    } else {
      await sendTelegram(chatId, parsed.reply || 'Не совсем понял. Попробуй сформулировать как задачу, событие или идею.');
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Telegram webhook error:', error);
    if (chatId) {
      try {
        const errMsg = error instanceof Error ? error.message : String(error);
        await sendTelegram(chatId, `⚠️ Ошибка: ${errMsg.substring(0, 300)}`);
      } catch { /* ignore */ }
    }
    return NextResponse.json({ ok: true });
  }
}

// GET — for webhook verification
export async function GET() {
  return NextResponse.json({ status: 'Telegram webhook active' });
}
