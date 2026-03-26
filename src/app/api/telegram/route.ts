import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN_PLANNER;
const ALLOWED_CHAT_ID = process.env.TELEGRAM_PLANNER_CHAT_ID;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

interface PlannerEvent {
  id: string;
  date: string;
  time: string;
  title: string;
  description: string;
  category: string;
  done: boolean;
  reminder: boolean;
  type: 'event' | 'todo' | 'idea';
  priority?: string;
  reminderOffsets?: string[];
  remindersSent?: string[];
}

async function sendTelegram(chatId: number | string, text: string) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  });
}

function getTodayStr(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function getTomorrowStr(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

async function getUserId(): Promise<string | null> {
  const user = await prisma.user.findFirst({
    where: { email: 'paveloshmanski@gmail.com' },
    select: { id: true }
  });
  return user?.id || null;
}

async function getEvents(userId: string): Promise<PlannerEvent[]> {
  const data = await prisma.fitnessData.findUnique({
    where: { userId },
    select: { plannerEvents: true }
  });
  return (data?.plannerEvents as unknown as PlannerEvent[]) || [];
}

async function saveEvents(userId: string, events: PlannerEvent[]) {
  await prisma.fitnessData.update({
    where: { userId },
    data: {
      plannerEvents: events as unknown as Prisma.InputJsonValue,
      updatedAt: new Date(),
    },
  });
}

const CATEGORY_EMOJI: Record<string, string> = {
  health: '🏥', business: '💼', personal: '👤', finance: '💰',
  fitness: '💪', travel: '✈️', other: '📌',
};

// Build context of existing events for Claude
function buildEventsContext(events: PlannerEvent[]): string {
  if (events.length === 0) return 'Список пуст.';

  const lines: string[] = [];
  const undoneEvents = events.filter(e => !e.done && e.type === 'event').slice(-10);
  const undoneTodos = events.filter(e => !e.done && e.type === 'todo').slice(-10);
  const ideas = events.filter(e => e.type === 'idea').slice(-10);
  const doneRecent = events.filter(e => e.done).slice(-5);

  if (undoneEvents.length > 0) {
    lines.push('СОБЫТИЯ:');
    undoneEvents.forEach((e, i) => lines.push(`  [${i}] id=${e.id} "${e.title}" ${e.date} ${e.time} (${e.category})`));
  }
  if (undoneTodos.length > 0) {
    lines.push('ДЕЛА:');
    undoneTodos.forEach((e, i) => lines.push(`  [${i}] id=${e.id} "${e.title}" приоритет=${e.priority || 'medium'} (${e.category})`));
  }
  if (ideas.length > 0) {
    lines.push('ИДЕИ:');
    ideas.forEach((e, i) => lines.push(`  [${i}] id=${e.id} "${e.title}"`));
  }
  if (doneRecent.length > 0) {
    lines.push('ВЫПОЛНЕНО (последние):');
    doneRecent.forEach(e => lines.push(`  ✓ "${e.title}"`));
  }

  return lines.join('\n');
}

interface ParsedAction {
  action: 'add_event' | 'add_todo' | 'add_idea' | 'edit' | 'delete' | 'complete' | 'list' | 'list_all' | 'list_ideas' | 'unknown';
  target_id?: string; // id of event to edit/delete/complete
  title?: string;
  description?: string;
  date?: string;
  time?: string;
  category?: string;
  priority?: string;
  reply: string;
}

async function parseWithClaude(message: string, eventsContext: string): Promise<ParsedAction> {
  if (!ANTHROPIC_API_KEY) {
    return { action: 'unknown', reply: 'Claude API key not configured' };
  }

  const today = getTodayStr();
  const tomorrow = getTomorrowStr();
  const now = new Date();
  const dayOfWeek = now.toLocaleDateString('ru-RU', { weekday: 'long', timeZone: 'America/New_York' });

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 600,
    system: `You are Alisa, a smart personal assistant. You manage the user's planner: events (with date/time), todos (backlog tasks), and ideas. User speaks Russian.

Today: ${today} (${dayOfWeek}). Tomorrow: ${tomorrow}.

CURRENT PLANNER:
${eventsContext}

Reply ONLY with raw JSON:
{
  "action": "add_event" | "add_todo" | "add_idea" | "edit" | "delete" | "complete" | "list" | "list_all" | "list_ideas" | "unknown",
  "target_id": "event id to edit/delete/complete (from CURRENT PLANNER above)",
  "title": "new or updated title",
  "description": "details",
  "date": "YYYY-MM-DD",
  "time": "HH:MM",
  "category": "health|business|personal|finance|fitness|travel|other",
  "priority": "high|medium|low",
  "reply": "friendly confirmation in Russian"
}

RULES:
- ADD: "завтра стоматолог в 14" → add_event. "купить молоко" → add_todo. "идея: ..." → add_idea
- EDIT: "исправь массаж на 15:00" or "перенеси встречу на пятницу" → action=edit, target_id from list, include changed fields only
- DELETE: "удали массаж" or "удали последнее" → action=delete, target_id from list
- COMPLETE: "отметь молоко" or "готово молоко" or "сделал X" → action=complete, target_id from list
- LIST: "что на сегодня" → list. "покажи всё" or "все дела" → list_all. "покажи идеи" → list_ideas
- DATES: "через неделю" = +7 days. "послезавтра" = +2. "в понедельник" = next Monday. "1 апреля" = 2026-04-01
- Find the right target_id by matching the title from user's message to items in CURRENT PLANNER
- If user says "последнее" (last one), use the last item's id from the relevant list
- reply: short, friendly, Russian, confirm what you did
- If unclear, action=unknown, ask for clarification in reply`,
    messages: [{ role: 'user', content: message }],
  });

  try {
    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return { action: 'unknown', reply: 'Не удалось обработать. Попробуй ещё раз.' };
  } catch {
    return { action: 'unknown', reply: 'Ошибка. Попробуй сформулировать иначе.' };
  }
}

function formatEventsList(events: PlannerEvent[], title: string, filterFn: (e: PlannerEvent) => boolean): string {
  const filtered = events.filter(filterFn);
  if (filtered.length === 0) return `${title}\n  _пусто_`;

  const lines = [title];
  filtered.forEach(e => {
    const emoji = CATEGORY_EMOJI[e.category] || '📌';
    const done = e.done ? '✅ ' : '';
    const time = e.time ? `${e.time} — ` : '';
    const date = e.date ? ` (${e.date})` : '';
    lines.push(`  ${done}${emoji} ${time}${e.title}${date}`);
  });
  return lines.join('\n');
}

export async function POST(request: Request) {
  let chatId: number | string = 0;
  try {
    const body = await request.json();
    const message = body.message;

    if (!message?.text || !message?.chat?.id) {
      return NextResponse.json({ ok: true });
    }

    chatId = message.chat.id;

    if (ALLOWED_CHAT_ID && String(chatId) !== ALLOWED_CHAT_ID) {
      await sendTelegram(chatId, '⛔ Доступ запрещён.');
      return NextResponse.json({ ok: true });
    }

    const text = message.text.trim();

    if (text === '/start') {
      await sendTelegram(chatId,
        `👋 Привет! Я *Alisa* — твой персональный ассистент.\n\nЯ умею:\n📅 _"завтра в 14:00 стоматолог"_ — событие\n📋 _"купить продукты"_ — задача\n💡 _"идея: запустить рассылку"_ — идея\n✏️ _"перенеси массаж на 15:00"_ — изменить\n✅ _"отметь молоко"_ — выполнено\n🗑 _"удали последнее"_ — удалить\n📊 _"что на сегодня?"_ — список\n📋 _"покажи всё"_ — все дела\n\nПросто пиши как обычно — я разберусь!`
      );
      return NextResponse.json({ ok: true });
    }

    const userId = await getUserId();
    if (!userId) {
      await sendTelegram(chatId, '❌ Пользователь не найден в базе.');
      return NextResponse.json({ ok: true });
    }

    // Load current events for context
    const events = await getEvents(userId);
    const context = buildEventsContext(events);

    // Parse with Claude
    const parsed = await parseWithClaude(text, context);

    // Debug: show what Claude parsed
    console.log('Parsed action:', parsed.action, 'title:', parsed.title, 'target:', parsed.target_id);

    switch (parsed.action) {
      case 'list': {
        const today = getTodayStr();
        const tomorrow = getTomorrowStr();
        const parts: string[] = [];
        parts.push(formatEventsList(events, '📅 *Сегодня:*', e => e.date === today && !e.done));
        const tmrw = events.filter(e => e.date === tomorrow && !e.done);
        if (tmrw.length > 0) parts.push(formatEventsList(events, '\n🔜 *Завтра:*', e => e.date === tomorrow && !e.done));
        const todos = events.filter(e => e.type === 'todo' && !e.done);
        if (todos.length > 0) parts.push(`\n📋 *Дела (${todos.length}):*\n` + todos.slice(0, 8).map(e => `  • ${e.title}`).join('\n'));
        await sendTelegram(chatId, parts.join('\n') || 'Ничего не запланировано 🎉');
        break;
      }

      case 'list_all': {
        const parts: string[] = [];
        parts.push(formatEventsList(events, '📅 *События:*', e => e.type === 'event' && !e.done));
        parts.push(formatEventsList(events, '\n📋 *Дела:*', e => e.type === 'todo' && !e.done));
        parts.push(formatEventsList(events, '\n💡 *Идеи:*', e => e.type === 'idea'));
        const doneCount = events.filter(e => e.done).length;
        if (doneCount > 0) parts.push(`\n✅ _Выполнено: ${doneCount}_`);
        await sendTelegram(chatId, parts.join('\n'));
        break;
      }

      case 'list_ideas': {
        await sendTelegram(chatId, formatEventsList(events, '💡 *Идеи:*', e => e.type === 'idea'));
        break;
      }

      case 'add_event':
      case 'add_todo':
      case 'add_idea': {
        const type = parsed.action === 'add_event' ? 'event' : parsed.action === 'add_todo' ? 'todo' : 'idea';
        const newEvent: PlannerEvent = {
          id: `ev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          date: parsed.date || '',
          time: parsed.time || '',
          title: parsed.title || text,
          description: parsed.description || '',
          category: parsed.category || 'other',
          done: false,
          reminder: type === 'event',
          type,
          priority: parsed.priority || 'medium',
          reminderOffsets: type === 'event' && parsed.date && parsed.time ? ['1h'] : [],
        };
        events.push(newEvent);
        await saveEvents(userId, events);
        await sendTelegram(chatId, parsed.reply || '✅ Добавлено!');
        break;
      }

      case 'edit': {
        if (!parsed.target_id) {
          await sendTelegram(chatId, parsed.reply || '❓ Не понял что исправить. Уточни.');
          break;
        }
        const idx = events.findIndex(e => e.id === parsed.target_id);
        if (idx === -1) {
          await sendTelegram(chatId, '❓ Не нашла это событие. Попробуй "покажи всё".');
          break;
        }
        if (parsed.title) events[idx].title = parsed.title;
        if (parsed.description) events[idx].description = parsed.description;
        if (parsed.date) events[idx].date = parsed.date;
        if (parsed.time) events[idx].time = parsed.time;
        if (parsed.category) events[idx].category = parsed.category;
        if (parsed.priority) events[idx].priority = parsed.priority;
        await saveEvents(userId, events);
        await sendTelegram(chatId, parsed.reply || '✏️ Исправлено!');
        break;
      }

      case 'delete': {
        if (!parsed.target_id) {
          await sendTelegram(chatId, parsed.reply || '❓ Не понял что удалить.');
          break;
        }
        const deleteIdx = events.findIndex(e => e.id === parsed.target_id);
        if (deleteIdx === -1) {
          await sendTelegram(chatId, '❓ Не нашла это событие.');
          break;
        }
        const deleted = events.splice(deleteIdx, 1)[0];
        await saveEvents(userId, events);
        await sendTelegram(chatId, parsed.reply || `🗑 Удалено: "${deleted.title}"`);
        break;
      }

      case 'complete': {
        if (!parsed.target_id) {
          await sendTelegram(chatId, parsed.reply || '❓ Не понял что отметить.');
          break;
        }
        const completeIdx = events.findIndex(e => e.id === parsed.target_id);
        if (completeIdx === -1) {
          await sendTelegram(chatId, '❓ Не нашла это событие.');
          break;
        }
        events[completeIdx].done = true;
        await saveEvents(userId, events);
        await sendTelegram(chatId, parsed.reply || `✅ Выполнено: "${events[completeIdx].title}"`);
        break;
      }

      default:
        await sendTelegram(chatId, parsed.reply || 'Не совсем поняла. Попробуй сформулировать как задачу, событие или идею.');
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Telegram webhook error:', error);
    if (chatId && chatId !== 0) {
      try {
        const errMsg = error instanceof Error ? error.message : String(error);
        await sendTelegram(chatId, `⚠️ Ошибка: ${errMsg.substring(0, 300)}`);
      } catch { /* ignore */ }
    }
    return NextResponse.json({ ok: true });
  }
}

export async function GET() {
  return NextResponse.json({ status: 'Telegram webhook active' });
}
