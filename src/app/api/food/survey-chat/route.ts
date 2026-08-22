import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import Anthropic from '@anthropic-ai/sdk';

// Опрос-диалог: ИИ сам ведёт короткое интервью о питании и здоровье —
// по одному вопросу за раз, с вариантами быстрых ответов. Когда картина
// ясна (5-8 вопросов), возвращает done=true и собранный профиль, который
// клиент сохраняет как nutritionProfile.

export const maxDuration = 60;

const TURN_SCHEMA = {
  type: 'object' as const,
  properties: {
    done: { type: 'boolean' as const, description: 'true — картина собрана, интервью завершено' },
    message: { type: 'string' as const, description: 'Следующий вопрос (один!) или, если done — короткое дружелюбное резюме того, что понял' },
    options: {
      type: 'array' as const,
      description: 'Варианты быстрых ответов на вопрос (2-5 коротких), пусто если ответ свободный или done',
      items: { type: 'string' as const },
    },
    profile: {
      anyOf: [
        {
          type: 'object' as const,
          properties: {
            conditions: { type: 'array' as const, items: { type: 'string' as const }, description: 'Состояния здоровья по-русски (пусто если нет)' },
            intolerances: { type: 'array' as const, items: { type: 'string' as const } },
            mealsPerDay: { type: 'number' as const },
            snacking: { type: 'string' as const },
            trainingTime: { type: 'string' as const },
            dietStyle: { type: 'string' as const },
            dislikes: { type: 'string' as const },
            notes: { type: 'string' as const, description: 'Всё важное, что не легло в поля выше — своими словами' },
          },
          required: ['conditions', 'intolerances', 'mealsPerDay', 'snacking', 'trainingTime', 'dietStyle', 'dislikes', 'notes'],
          additionalProperties: false,
        },
        { type: 'null' as const },
      ],
      description: 'Заполняется ТОЛЬКО когда done=true, иначе null',
    },
  },
  required: ['done', 'message', 'options', 'profile'],
  additionalProperties: false,
};

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 503 });
    }

    const body = await request.json().catch(() => ({}));
    const history: { role: 'user' | 'assistant'; content: string }[] = Array.isArray(body.messages)
      ? (body.messages as unknown[])
          .filter((m): m is { role: 'user' | 'assistant'; content: string } =>
            !!m && typeof m === 'object' &&
            ((m as { role?: string }).role === 'user' || (m as { role?: string }).role === 'assistant') &&
            typeof (m as { content?: unknown }).content === 'string')
          .slice(-30)
      : [];

    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: 'claude-opus-5',
      // Thinking у модели входит в этот же лимит: длинный ответ пользователя →
      // больше размышлений → при 2000 JSON обрезался и парс падал. Даём запас.
      max_tokens: 8000,
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: TURN_SCHEMA },
      },
      system:
        'Ты — дружелюбный нутрициолог-ассистент в фитнес-приложении. Ведёшь короткое интервью, ' +
        'чтобы собрать картину для персональных рекомендаций по питанию. Правила: ' +
        'задавай СТРОГО ПО ОДНОМУ короткому вопросу за раз, простым разговорным языком, без медицинского жаргона; ' +
        'к каждому вопросу давай 2-5 коротких вариантов быстрых ответов (options), но пользователь может ответить и своими словами; ' +
        'что нужно выяснить: особенности здоровья (диабет/инсулинорезистентность, ЖКТ, холестерин, щитовидка — спрашивай простыми словами), ' +
        'аллергии и непереносимости, сколько приёмов пищи удобно и как с перекусами, когда тренировки, ' +
        'стиль питания (вегетарианство и т.п.), продукты которые не ест. ' +
        'Если ответ пользователя раскрывает что-то важное — задай ОДИН уточняющий вопрос, не допрашивай. ' +
        'Всего 5-8 вопросов, не больше. Когда картина ясна — done=true, message = короткое тёплое резюме ' +
        '(«Понял: …») в 2-3 предложения, и заполни profile. В notes сложи всё важное своими словами. ' +
        'Первое сообщение (когда истории нет) — коротко поздоровайся одной фразой и сразу задай первый вопрос.',
      // История с клиента начинается с приветствия АССИСТЕНТА, а API требует,
      // чтобы первым было сообщение user — всегда подставляем стартовую реплику.
      messages: [{ role: 'user' as const, content: 'Начни интервью.' }, ...history],
    });

    if (response.stop_reason === 'refusal') {
      return NextResponse.json({ error: 'model refused' }, { status: 502 });
    }
    if (response.stop_reason === 'max_tokens') {
      return NextResponse.json({ error: 'truncated' }, { status: 502 });
    }
    const textBlock = response.content.find(b => b.type === 'text');
    interface SurveyTurn {
      done: boolean; message: string; options: string[];
      profile: { conditions: string[]; intolerances: string[]; mealsPerDay: number; snacking: string; trainingTime: string; dietStyle: string; dislikes: string; notes: string } | null;
    }
    let parsed: SurveyTurn | null = null;
    try { parsed = textBlock ? JSON.parse(textBlock.text) as SurveyTurn : null; } catch { parsed = null; }

    if (!parsed || typeof parsed.message !== 'string') {
      return NextResponse.json({ error: 'bad turn' }, { status: 502 });
    }
    return NextResponse.json({
      success: true,
      done: !!parsed.done,
      message: parsed.message,
      options: Array.isArray(parsed.options) ? parsed.options.slice(0, 5).map(o => String(o).slice(0, 60)) : [],
      profile: parsed.done && parsed.profile ? parsed.profile : null,
    });
  } catch (error) {
    console.error('survey chat error:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
