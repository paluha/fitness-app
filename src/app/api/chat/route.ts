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
- Опирайся на ДАННЫЕ ПОЛЬЗОВАТЕЛЯ, которые тебе передают ниже (цели, дневные логи, замеры тела, тренировки, анализы). Говори про КОНКРЕТНОГО человека, а не вообще.
- Про АНАЛИЗЫ: можешь объяснять, что означает показатель, в норме ли он, как динамика менялась со временем, и как образ жизни/питание/тренировки могут на него влиять. Но это образовательная информация, НЕ диагноз.
- Если данных не хватает для точного ответа — скажи об этом и спроси, либо дай общую рекомендацию с оговоркой.

ПРАВИЛА:
- Пиши на языке пользователя (по умолчанию русский).
- Будь конкретным и практичным. Без воды.
- Не ставь медицинских диагнозов и не назначай лечение/препараты. Для интерпретации анализов и тревожных симптомов — рекомендуй обратиться к врачу.
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

type DayEntry = { exercises?: { name?: string; completed?: boolean }[] };

// Человекочитаемая история ТРЕНИРОВОК по всем дневным логам:
// дата + название + сколько упражнений выполнено. Это надёжнее, чем заставлять
// модель парсить сырой JSON, и даёт ей ответ на «когда я тренировался».
function buildWorkoutHistory(dayLogs: unknown, maxLines = 60): string {
  if (!dayLogs || typeof dayLogs !== 'object' || Array.isArray(dayLogs)) return '—';
  const rows: { date: string; line: string }[] = [];
  for (const [date, raw] of Object.entries(dayLogs as Record<string, unknown>)) {
    const day = raw as { workoutSnapshot?: DayEntry & { workoutName?: string }; workoutDraft?: DayEntry & { workoutName?: string } } | null;
    const src = day?.workoutSnapshot ?? day?.workoutDraft;
    const ex = src?.exercises ?? [];
    if (!Array.isArray(ex) || ex.length === 0) continue;
    const done = ex.filter(e => e?.completed).length;
    if (done === 0) continue; // день без выполненных упражнений = отдых, пропускаем
    const name = (src as { workoutName?: string })?.workoutName || 'Тренировка';
    const doneNames = ex.filter(e => e?.completed).map(e => e?.name).filter(Boolean).slice(0, 8).join(', ');
    rows.push({ date, line: `${date}: ${name} — ${done}/${ex.length} упр.${doneNames ? ` (${doneNames})` : ''}` });
  }
  if (rows.length === 0) return 'Нет записанных тренировок.';
  // новые сверху, ограничиваем число строк
  rows.sort((a, b) => (a.date < b.date ? 1 : -1));
  const total = rows.length;
  const shown = rows.slice(0, maxLines).map(r => r.line);
  const head = `Всего дней с тренировками: ${total}. Список (новые сверху):`;
  return head + '\n' + shown.join('\n') + (total > maxLines ? `\n…и ещё ${total - maxLines} дней` : '');
}

type LabMarker = { name?: string; value?: number; unit?: string; refLow?: number | null; refHigh?: number | null; flag?: string };
type LabRow = { panelName?: string | null; lab?: string | null; collectedAt: Date; markers: unknown };

// Человекочитаемая сводка анализов: дата, панель, показатели с пометкой
// отклонений (↓/↑). Чтобы AI мог отвечать «какой у меня холестерин»,
// «что изменилось» и связывать с тренировками/едой.
function buildLabSummary(labs: LabRow[]): string {
  if (!labs || labs.length === 0) return 'Анализы не загружены.';
  const blocks: string[] = [];
  for (const r of labs) {
    const date = r.collectedAt instanceof Date ? r.collectedAt.toISOString().slice(0, 10) : String(r.collectedAt).slice(0, 10);
    const markers = Array.isArray(r.markers) ? (r.markers as LabMarker[]) : [];
    const lines = markers.slice(0, 40).map(m => {
      const ref = (m.refLow != null || m.refHigh != null) ? ` [реф: ${m.refLow ?? '—'}–${m.refHigh ?? '—'}]` : '';
      const mark = m.flag === 'high' ? ' ↑' : m.flag === 'low' ? ' ↓' : '';
      return `  • ${m.name}: ${m.value} ${m.unit || ''}${ref}${mark}`.trimEnd();
    });
    const title = [date, r.panelName, r.lab].filter(Boolean).join(' · ');
    blocks.push(`${title}\n${lines.join('\n')}`);
  }
  return blocks.join('\n\n');
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

  const { message, image } = await request.json();
  // Картинка прикладывается опционально (vision). Без неё нужен текст.
  const hasImage = typeof image === 'string' && image.startsWith('data:image/');
  if ((!message || typeof message !== 'string' || !message.trim()) && !hasImage) {
    return new Response(JSON.stringify({ error: 'no_message' }), { status: 400 });
  }
  const text = (typeof message === 'string' ? message.trim() : '') || (hasImage ? 'Посмотри на это фото.' : '');

  // Разбираем data-URL картинки на media_type + base64 для Claude.
  let imgBlock: Anthropic.ImageBlockParam | null = null;
  if (hasImage) {
    const m = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,(.+)$/i.exec(image);
    if (m) {
      const mediaType = (m[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : m[1].toLowerCase()) as
        'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
      imgBlock = { type: 'image', source: { type: 'base64', media_type: mediaType, data: m[2] } };
    }
  }

  // --- собираем данные пользователя + историю чата + анализы ---
  const [user, fitness, history, labs] = await Promise.all([
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
    prisma.labResult.findMany({
      where: { userId },
      orderBy: { collectedAt: 'desc' },
      take: 12, // последние результаты анализов
      select: { panelName: true, lab: true, collectedAt: true, markers: true },
    }),
  ]);

  const displayName = user?.name || [user?.firstName, user?.lastName].filter(Boolean).join(' ') || 'Пользователь';

  // Компактная сводка данных юзера для модели.
  const todayIso = new Date().toISOString().slice(0, 10);
  const userContext = `ДАННЫЕ ПОЛЬЗОВАТЕЛЯ (${displayName})
СЕГОДНЯ: ${todayIso} (используй для подсчётов «сколько дней назад», «на этой неделе» и т.п.)

🎯 ЦЕЛИ ПО МАКРОСАМ (в день):
- Белок: ${user?.goalProtein ?? '—'} г
- Жиры: ${user?.goalFat ?? '—'} г
- Углеводы: ${user?.goalCarbs ?? '—'} г
- Калории: ${user?.goalCalories ?? '—'} ккал

🏋️ ИСТОРИЯ ТРЕНИРОВОК (когда и что делал, по всем дням):
${buildWorkoutHistory(fitness?.dayLogs, 60)}

📋 ШАБЛОНЫ ТРЕНИРОВОК (план T1–T7):
${compactJson(fitness?.workouts, 2000)}

📅 ПОСЛЕДНИЕ ДНИ (еда, шаги, детали — последние 5 дней):
${compactJson(recentByDate(fitness?.dayLogs, 5), 3500)}

📈 ПРОГРЕСС ПО УПРАЖНЕНИЯМ:
${compactJson(fitness?.progressHistory, 1500)}

📏 ЗАМЕРЫ ТЕЛА (вес, талия и т.д.):
${compactJson(fitness?.bodyMeasurements, 1500)}

✅ ПРИВЫЧКИ:
${compactJson(fitness?.habits, 800)}

🎯 РЕКОМЕНДАЦИИ ТРЕНЕРА:
${compactJson(user?.program?.nutritionRecommendations, 1500)}

🩸 АНАЛИЗЫ (последние результаты; ↓ ниже нормы, ↑ выше нормы):
${buildLabSummary(labs as LabRow[])}`;

  // Сохраняем сообщение пользователя сразу. Картинку в историю не пишем
  // (тяжёлая), помечаем текстом, что было фото.
  const savedContent = hasImage ? (text + '\n📎 [фото]').trim() : text;
  await prisma.chatMessage.create({ data: { userId, role: 'user', content: savedContent } });

  // Новое сообщение: текст + (опционально) картинка для vision.
  const lastContent: Anthropic.ContentBlockParam[] = [];
  if (imgBlock) lastContent.push(imgBlock);
  lastContent.push({ type: 'text', text });

  // Собираем messages: контекст данных + история + новое сообщение.
  // Кэшируем system; данные/история идут после, не инвалидируя кэш.
  const messages: Anthropic.MessageParam[] = [
    // Свежий контекст данных как первое user-сообщение (не кэшируем — меняется).
    { role: 'user', content: `[Контекст моих данных на сейчас]\n${userContext}` },
    { role: 'assistant', content: 'Понял, я вижу твои данные. Чем помочь?' },
    ...history.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user', content: lastContent },
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
