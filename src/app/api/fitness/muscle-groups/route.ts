import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import Anthropic from '@anthropic-ai/sdk';
import { authOptions } from '@/lib/auth';

// ИИ-определение группы мышц по названию упражнения. Клиент присылает пачку
// названий, которых ещё нет в его локальном кэше, получает словарь
// { название: группа } и кэширует у себя (localStorage) — повторных
// обращений за теми же упражнениями не будет.

const OUTPUT_SCHEMA = {
  type: 'object' as const,
  properties: {
    items: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          name: { type: 'string' as const, description: 'Название упражнения ровно как во входном списке' },
          muscle: { type: 'string' as const, description: 'Основная группа мышц, кратко, по-русски, в нижнем регистре' },
        },
        required: ['name', 'muscle'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const names: string[] = Array.isArray(body?.names)
      ? [...new Set((body.names as unknown[]).filter((n): n is string => typeof n === 'string' && n.trim().length > 0).map(n => n.trim()))].slice(0, 100)
      : [];
    if (names.length === 0) {
      return NextResponse.json({ groups: {} });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured', groups: {} }, { status: 503 });
    }

    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: 'claude-opus-5',
      max_tokens: 8000,
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: OUTPUT_SCHEMA },
      },
      system:
        'Ты определяешь основную группу мышц для упражнений из зала. ' +
        'Отвечай кратко по-русски в нижнем регистре, как пишут тренеры: ' +
        '«грудь», «спина», «широчайшие», «передняя дельта», «средняя дельта», «задняя дельта», ' +
        '«бицепс», «трицепс», «квадрицепс», «бицепс бедра», «ягодицы», «икры», «пресс», «трапеция», «предплечья», «кардио». ' +
        'Если упражнение задействует несколько групп, назови главную (максимум две через запятую). ' +
        'Верни каждое название ровно в том виде, в каком оно пришло.',
      messages: [
        { role: 'user', content: 'Определи группу мышц для каждого упражнения:\n' + names.map(n => `- ${n}`).join('\n') },
      ],
    });

    if (response.stop_reason === 'refusal') {
      return NextResponse.json({ error: 'model refused', groups: {} }, { status: 502 });
    }

    const textBlock = response.content.find(b => b.type === 'text');
    const parsed = textBlock ? JSON.parse(textBlock.text) as { items: { name: string; muscle: string }[] } : { items: [] };

    const groups: Record<string, string> = {};
    for (const item of parsed.items || []) {
      if (item?.name && item?.muscle) {
        groups[item.name.trim().toLowerCase()] = item.muscle.trim().toLowerCase();
      }
    }
    return NextResponse.json({ groups });
  } catch (error) {
    console.error('muscle-groups error:', error);
    return NextResponse.json({ error: 'Failed to classify', groups: {} }, { status: 500 });
  }
}
