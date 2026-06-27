import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { trackError } from '@/lib/monitor';
import Anthropic from '@anthropic-ai/sdk';

// AI-чат с фитнес-ассистентом, который "цепляет" данные пользователя.
// Паттерн как у /api/food/recommend: стабильный system-промпт кэшируется,
// а персональные данные + история чата идут в messages ПОСЛЕ кэш-брейкпоинта,
// поэтому не инвалидируют кэш.
export const maxDuration = 60;

const CHAT_SYSTEM = `Ты — персональный AI-ассистент в фитнес-приложении. Ты помогаешь пользователю с тренировками, питанием, восстановлением и прогрессом.

ТВОЯ РОЛЬ:
- Отвечай на вопросы про тренировки, питание, технику, восстановление, мотивацию.
- Опирайся на ДАННЫЕ ПОЛЬЗОВАТЕЛЯ, которые тебе передают ниже (цели, дневные логи, замеры тела, тренировки). Говори про КОНКРЕТНОГО человека, а не вообще.
- Если данных не хватает для точного ответа — скажи об этом и спроси, либо дай общую рекомендацию с оговоркой.

ПРАВИЛА:
- Пиши на языке пользователя (по умолчанию русский).
- Будь конкретным и практичным. Без воды.
- Не ставь медицинских диагнозов и не заменяй врача. При тревожных симптомах — рекомендуй обратиться к специалисту.
- Не выдумывай данные пользователя, которых нет в контексте.
- Форматируй ответ читабельно: короткие абзацы, списки где уместно.`;

// Безопасно сериализуем JSON-поле, обрезая по размеру, чтобы не раздувать
// контекст (и счёт за токены). Берём последние записи, если это объект по датам.
function compactJson(value: unknown, maxChars: number): string {
  if (value == null) return '—';
  try {
    let s = JSON.stringify(value);
    if (s.length > maxChars) s = s.slice(0, maxChars) + '…(обрезано)';
    return s;
  } catch {
    return '—';
  }
}

// Последние N ключей объекта-по-датам (dayLogs: { "2026-06-20": {...} }).
function recentByDate(value: unknown, n: number): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>);
    // ключи-даты сортируем по убыванию, берём последние n
    entries.sort((a, b) => (a[0] < b[0] ? 1 : -1));
    return Object.fromEntries(entries.slice(0, n));
  }
  return value;
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
  const userId = session.user.id;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Anthropic API key not configured' }), { status: 500 });
  }

  const { message } = await request.json();
  if (!message || typeof message !== 'string' || !message.trim()) {
    return new Response(JSON.stringify({ error: 'no_message' }), { status: 400 });
  }

  // --- собираем данные пользователя + историю чата ---
  const [user, fitness, history] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        firstName: true, lastName: true, name: true, language: true,
        goalProtein: true, goalFat: true, goalCarbs: true, goalCalories: true,
        program: { select: { nutritionRecommendations: true } },
      },
    }),
    prisma.fitnessData.findUnique({
      where: { userId },
      select: {
        workouts: true, dayLogs: true, progressHistory: true,
        bodyMeasurements: true, habits: true,
      },
    }),
    prisma.chatMessage.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      take: 30, // последние сообщения как контекст диалога
      select: { role: true, content: true },
    }),
  ]);

  const displayName = user?.name || [user?.firstName, user?.lastName].filter(Boolean).join(' ') || 'Пользователь';

  // Компактная сводка данных юзера для модели.
  const userContext = `ДАННЫЕ ПОЛЬЗОВАТЕЛЯ (${displayName})

🎯 ЦЕЛИ ПО МАКРОСАМ (в день):
- Белок: ${user?.goalProtein ?? '—'} г
- Жиры: ${user?.goalFat ?? '—'} г
- Углеводы: ${user?.goalCarbs ?? '—'} г
- Калории: ${user?.goalCalories ?? '—'} ккал

🏋️ ТРЕНИРОВКИ:
${compactJson(fitness?.workouts, 2500)}

📅 ДНЕВНЫЕ ЛОГИ (последние 7 дней — еда, шаги, выполненные тренировки):
${compactJson(recentByDate(fitness?.dayLogs, 7), 4000)}

📈 ПРОГРЕСС ПО УПРАЖНЕНИЯМ:
${compactJson(fitness?.progressHistory, 1500)}

📏 ЗАМЕРЫ ТЕЛА (вес, талия и т.д.):
${compactJson(fitness?.bodyMeasurements, 1500)}

✅ ПРИВЫЧКИ:
${compactJson(fitness?.habits, 800)}

🎯 РЕКОМЕНДАЦИИ ТРЕНЕРА:
${compactJson(user?.program?.nutritionRecommendations, 1500)}`;

  // Сохраняем сообщение пользователя сразу.
  await prisma.chatMessage.create({ data: { userId, role: 'user', content: message.trim() } });

  // Собираем messages: контекст данных + история + новое сообщение.
  // Кэшируем system; данные/история идут после, не инвалидируя кэш.
  const messages: Anthropic.MessageParam[] = [
    // Свежий контекст данных как первое user-сообщение (не кэшируем — меняется).
    { role: 'user', content: `[Контекст моих данных на сейчас]\n${userContext}` },
    { role: 'assistant', content: 'Понял, я вижу твои данные. Чем помочь?' },
    ...history.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user', content: message.trim() },
  ];

  const client = new Anthropic({ apiKey });
  const encoder = new TextEncoder();
  let assistantText = '';

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const llmStream = client.messages.stream({
          model: 'claude-sonnet-4-6',
          max_tokens: 1500,
          system: [{ type: 'text', text: CHAT_SYSTEM, cache_control: { type: 'ephemeral' } }],
          messages,
        });

        for await (const event of llmStream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            const chunk = event.delta.text;
            assistantText += chunk;
            controller.enqueue(encoder.encode(chunk));
          }
        }

        const final = await llmStream.finalMessage();
        if (final.stop_reason === 'refusal') {
          const note = '\n\n(Не могу ответить на этот запрос.)';
          assistantText += note;
          controller.enqueue(encoder.encode(note));
        }
      } catch (err) {
        await trackError({
          route: '/api/chat', method: 'POST',
          error: 'AI chat failed',
          details: err instanceof Error ? err.message : String(err),
          userId,
        });
        const note = '\n\n(Произошла ошибка, попробуйте ещё раз.)';
        assistantText += note;
        controller.enqueue(encoder.encode(note));
      } finally {
        // Сохраняем ответ ассистента в историю.
        if (assistantText.trim()) {
          await prisma.chatMessage.create({ data: { userId, role: 'assistant', content: assistantText } });
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

// Загрузка истории чата для UI.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  const messages = await prisma.chatMessage.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'asc' },
    take: 200,
    select: { id: true, role: true, content: true, createdAt: true },
  });
  return new Response(JSON.stringify({ messages }), { headers: { 'Content-Type': 'application/json' } });
}
