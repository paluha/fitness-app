import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import Anthropic from '@anthropic-ai/sdk';
import { trainxSystem } from '@/lib/trainx-ai';

// ИИ-генерация новой программы тренировок на основе текущей программы,
// статистики (веса, частота), цели пользователя и его пожеланий.
// Старая программа при принятии уходит в programArchive на клиенте.

export const maxDuration = 60;

const GOAL_LABELS: Record<string, string> = {
  lose: 'похудение (дефицит калорий, сохранить мышцы)',
  maintain: 'поддержание формы',
  gain: 'набор мышечной массы',
  recomp: 'рекомпозиция — атлетическое телосложение (рост мышц + сжигание жира)',
};

const PROGRAM_SCHEMA = {
  type: 'object' as const,
  properties: {
    rationale: {
      type: 'string' as const,
      description: 'Короткое объяснение (3-5 предложений): что за сплит, чем отличается от старой программы и почему это качественный следующий шаг',
    },
    workouts: {
      type: 'array' as const,
      description: 'Тренировки новой программы, по числу дней в неделю',
      items: {
        type: 'object' as const,
        properties: {
          focus: { type: 'string' as const, description: 'Фокус дня кратко: «Грудь + трицепс», «Ноги», «Спина + бицепс»…' },
          exercises: {
            type: 'array' as const,
            items: {
              type: 'object' as const,
              properties: {
                name: { type: 'string' as const, description: 'Название упражнения по-русски, как принято в зале' },
                plannedSets: { type: 'string' as const, description: 'План: вес и подходы, например «40кг 3x10-12» или «3x15»; вес опирайся на текущие рабочие веса пользователя' },
                restTime: { type: 'string' as const, description: 'Отдых, например «2-3 мин»' },
                notes: { type: 'string' as const, description: 'Короткая приписка: группа мышц или техника' },
              },
              required: ['name', 'plannedSets', 'restTime', 'notes'],
              additionalProperties: false,
            },
          },
        },
        required: ['focus', 'exercises'],
        additionalProperties: false,
      },
    },
  },
  required: ['rationale', 'workouts'],
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
    const goal: string = typeof body.goal === 'string' ? body.goal : 'maintain';
    const wishes: string = typeof body.wishes === 'string' ? body.wishes.slice(0, 1500) : '';
    const daysPerWeek: number = Math.min(7, Math.max(2, Number(body.daysPerWeek) || 4));
    const currentProgram = Array.isArray(body.currentProgram) ? body.currentProgram : [];
    const stats: string[] = Array.isArray(body.stats)
      ? (body.stats as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 80)
      : [];

    const programText = currentProgram.map((w: { name?: string; exercises?: { name?: string; plannedSets?: string }[] }, i: number) =>
      `${w.name || 'Тренировка ' + (i + 1)}:\n` +
      (w.exercises || []).map(e => `  - ${e.name} (${e.plannedSets || 'план не указан'})`).join('\n')
    ).join('\n');

    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: 'claude-opus-5',
      max_tokens: 16000,
      output_config: {
        format: { type: 'json_schema', schema: PROGRAM_SCHEMA },
      },
      system: trainxSystem(
        'Ты — опытный тренер по силовым тренировкам. Составляешь пользователю НОВУЮ программу ' +
        'на замену текущей: качественный следующий шаг, а не случайный набор упражнений. Принципы: ' +
        'прогрессия от текущих рабочих весов (не сбрасывай и не завышай), разумный сплит под число дней, ' +
        'знакомые пользователю движения как база + 30-50% новых для свежего стимула, ' +
        'большие многосуставные в начале тренировки, изоляция после, реалистичный объём (5-8 упражнений на день). ' +
        'Учитывай пожелания пользователя как приоритет. Названия упражнений — по-русски, как принято в зале.'
      ),
      messages: [
        {
          role: 'user',
          content:
            `Цель: ${GOAL_LABELS[goal] || GOAL_LABELS.maintain}\n` +
            `Дней в неделю: ${daysPerWeek}\n` +
            (wishes ? `Пожелания: ${wishes}\n` : '') +
            `\nТЕКУЩАЯ ПРОГРАММА (давно без изменений):\n${programText || '—'}\n` +
            (stats.length ? `\nСТАТИСТИКА (последние рабочие веса и частота):\n${stats.join('\n')}\n` : '') +
            `\nСоставь новую программу на ${daysPerWeek} тренировок в неделю.`,
        },
      ],
    });

    if (response.stop_reason === 'refusal') {
      return NextResponse.json({ error: 'model refused' }, { status: 502 });
    }
    const textBlock = response.content.find(b => b.type === 'text');
    const parsed = textBlock
      ? JSON.parse(textBlock.text) as { rationale: string; workouts: { focus: string; exercises: { name: string; plannedSets: string; restTime: string; notes: string }[] }[] }
      : null;
    if (!parsed || !Array.isArray(parsed.workouts) || parsed.workouts.length === 0) {
      return NextResponse.json({ error: 'empty program' }, { status: 502 });
    }

    return NextResponse.json({
      success: true,
      rationale: parsed.rationale || '',
      workouts: parsed.workouts.slice(0, 7).map(w => ({
        focus: String(w.focus || '').slice(0, 60),
        exercises: (w.exercises || []).slice(0, 10).map(e => ({
          name: String(e.name || '').slice(0, 120),
          plannedSets: String(e.plannedSets || '').slice(0, 60),
          restTime: String(e.restTime || '2-3 мин').slice(0, 20),
          notes: String(e.notes || '').slice(0, 80),
        })),
      })),
    });
  } catch (error) {
    console.error('program generation error:', error);
    return NextResponse.json({ error: 'Failed to generate program' }, { status: 500 });
  }
}
