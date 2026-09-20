import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import Anthropic from '@anthropic-ai/sdk';
import { trainxSystem } from '@/lib/trainx-ai';

// Планер: пользователь описывает планы обычным текстом, ИИ возвращает
// ЧЕРНОВИКИ дел с датами и временем. Ничего не сохраняется: календарь
// пишется только после явного «Добавить в календарь» на клиенте.

export const maxDuration = 45;

const MAX_DRAFTS = 30;

const PLANNER_SCHEMA = {
  type: 'object' as const,
  properties: {
    reply: {
      type: 'string' as const,
      description: 'Короткий ответ пользователю: что подготовлено или какой вопрос требует уточнения',
    },
    needsClarification: {
      type: 'boolean' as const,
      description: 'true, если дату или время невозможно определить и нужен уточняющий вопрос',
    },
    tasks: {
      type: 'array' as const,
      description: 'ПОЛНЫЙ обновлённый список черновиков, а не только новые. Пустой массив — если нужно уточнение.',
      items: {
        type: 'object' as const,
        properties: {
          title: { type: 'string' as const, description: 'Что сделать, кратко и по-человечески' },
          date: { type: 'string' as const, description: 'Дата в формате ГГГГ-ММ-ДД' },
          time: { type: 'string' as const, description: 'Время ЧЧ:ММ или пустая строка, если время неважно' },
          category: { type: 'string' as const, enum: ['workout', 'health', 'personal'] },
          duration: { type: ['number', 'null'] as const, description: 'Длительность в минутах или null' },
          note: { type: 'string' as const, description: 'Короткая заметка или пустая строка' },
        },
        required: ['title', 'date', 'time', 'category', 'duration', 'note'],
        additionalProperties: false,
      },
    },
  },
  required: ['reply', 'needsClarification', 'tasks'],
  additionalProperties: false,
};

const PLANNER_MODULE =
  'Ты — планировщик дел в приложении TrainX. Пользователь описывает планы свободным ' +
  'текстом, ты раскладываешь их на отдельные дела с датой и временем. ' +
  'ПРАВИЛА: ' +
  '(1) Ты НЕ записываешь ничего в календарь — только готовишь черновики, которые ' +
  'пользователь потом проверит и добавит сам. Никогда не утверждай, что дело уже добавлено. ' +
  '(2) Все даты — в часовом поясе пользователя, он указан в контексте. «Сегодня», ' +
  '«завтра», «в среду» считай относительно указанной текущей даты. ' +
  '(3) Если дату определить невозможно (например «на следующей неделе» без дня), ' +
  'поставь needsClarification=true, верни ПУСТОЙ tasks и задай один короткий вопрос. ' +
  'Не выдумывай дату наугад. ' +
  '(4) Если пользователь правит уже подготовленные черновики («перенеси прогулку на 20:30»), ' +
  'верни ВЕСЬ обновлённый список целиком, включая неизменённые дела. ' +
  '(5) Категория: workout — тренировки, зал, йога, бег; health — анализы, врач, ' +
  'замеры, давление, лекарства; personal — всё остальное. ' +
  '(6) Повторяющиеся дела («каждый вторник») разворачивай в отдельные дела на ' +
  'ближайшие 4 недели, не больше. ' +
  `(7) Максимум ${MAX_DRAFTS} дел за раз. Если пользователь просит больше — скажи об этом. ` +
  '(8) Название дела — без даты и времени внутри: они лежат в отдельных полях. ' +
  'Отвечай по-русски, коротко и по делу.';

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'ИИ-планер не настроен на сервере.' }, { status: 503 });
    }

    const body = await request.json().catch(() => ({}));
    const message: string = typeof body.message === 'string' ? body.message.slice(0, 3000) : '';
    if (!message.trim()) {
      return NextResponse.json({ error: 'Пустое сообщение' }, { status: 400 });
    }
    const today: string = /^\d{4}-\d{2}-\d{2}$/.test(body.today) ? body.today : new Date().toISOString().slice(0, 10);
    const selectedDate: string = /^\d{4}-\d{2}-\d{2}$/.test(body.selectedDate) ? body.selectedDate : today;
    const timezone: string = typeof body.timezone === 'string' ? body.timezone.slice(0, 64) : 'UTC';
    const history: { role: string; text: string }[] = Array.isArray(body.history)
      ? body.history.filter((m: unknown): m is { role: string; text: string } =>
          !!m && typeof m === 'object'
          && ['user', 'assistant'].includes((m as { role?: unknown }).role as string)
          && typeof (m as { text?: unknown }).text === 'string')
        .slice(-12)
      : [];
    const drafts = Array.isArray(body.drafts) ? body.drafts.slice(0, MAX_DRAFTS) : [];
    const existing = Array.isArray(body.existingTasks) ? body.existingTasks.slice(0, 60) : [];

    const weekday = new Date(`${today}T12:00:00`).toLocaleDateString('ru-RU', { weekday: 'long' });

    const context =
      `Сегодня: ${today} (${weekday}). Часовой пояс пользователя: ${timezone}.\n` +
      `Открытый в планере день: ${selectedDate}. Если пользователь не назвал дату — ставь этот день.\n` +
      (drafts.length
        ? `Уже подготовленные черновики (их можно править):\n${JSON.stringify(drafts)}\n`
        : 'Подготовленных черновиков пока нет.\n') +
      (existing.length
        ? `Уже запланированные дела пользователя (для проверки пересечений):\n${JSON.stringify(existing)}\n`
        : '');

    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: 'claude-opus-5',
      max_tokens: 4000,
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: PLANNER_SCHEMA },
      },
      system: trainxSystem(PLANNER_MODULE),
      messages: [
        ...history.map(m => ({
          role: m.role === 'user' ? 'user' as const : 'assistant' as const,
          content: m.text.slice(0, 2000),
        })),
        { role: 'user', content: `${context}\nСообщение пользователя:\n${message}` },
      ],
    });

    if (response.stop_reason === 'refusal') {
      return NextResponse.json({ error: 'Не могу обработать это сообщение.' }, { status: 502 });
    }

    const textBlock = response.content.find(b => b.type === 'text');
    const parsed = textBlock
      ? JSON.parse(textBlock.text) as {
          reply: string;
          needsClarification: boolean;
          tasks: { title: string; date: string; time: string; category: string; duration: number | null; note: string }[];
        }
      : { reply: '', needsClarification: false, tasks: [] };

    // Чистим то, что вернула модель: календарь пишется по этим данным,
    // поэтому кривые даты и длительности до клиента не доходят.
    const CATS = new Set(['workout', 'health', 'personal']);
    const tasks = (parsed.tasks || [])
      .filter(t => t?.title && /^\d{4}-\d{2}-\d{2}$/.test(t.date))
      .slice(0, MAX_DRAFTS)
      .map(t => {
        const duration = Number(t.duration);
        return {
          title: String(t.title).trim().slice(0, 140),
          date: t.date,
          time: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(t.time)) ? String(t.time) : '',
          category: CATS.has(t.category) ? t.category : 'personal',
          duration: Number.isFinite(duration) && duration >= 1 && duration <= 1440 ? Math.round(duration) : null,
          note: String(t.note || '').slice(0, 700),
        };
      })
      .filter(t => Number.isFinite(new Date(`${t.date}T12:00:00`).getTime()));

    return NextResponse.json({
      success: true,
      reply: String(parsed.reply || '').slice(0, 1200),
      needsClarification: !!parsed.needsClarification,
      tasks,
    });
  } catch (error) {
    console.error('planner plan error:', error);
    return NextResponse.json({ error: 'Не удалось разобрать сообщение.' }, { status: 500 });
  }
}
