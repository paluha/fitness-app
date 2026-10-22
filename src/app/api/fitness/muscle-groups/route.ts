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


/**
 * Частые движения — отвечаем без обращения к модели.
 *
 * Группа мышц у «жима лёжа» не меняется, а запрос стоил денег при каждом
 * новом упражнении в программе: кэш у клиента локальный и теряется при
 * смене устройства или очистке браузера.
 *
 * Ключ — кусок названия в нижнем регистре; совпадение по вхождению,
 * поэтому «Жим штанги лёжа широким хватом» тоже найдётся.
 */
const KNOWN_MUSCLES: [string, string][] = [
  ['жим лёжа', 'грудь'], ['жим лежа', 'грудь'], ['жим гантелей лёжа', 'грудь'],
  ['жим гантелей лежа', 'грудь'], ['разводка', 'грудь'], ['сведение', 'грудь'],
  ['бабочка', 'грудь'], ['отжимания на брусьях', 'грудь'], ['отжимания', 'грудь'],
  ['горизонтальный жим', 'грудь'], ['жим на наклонной', 'грудь'],
  ['жим гантелей на наклонной', 'грудь'], ['наклонной скамье', 'грудь'],

  ['подтягивания', 'спина'], ['тяга верхнего блока', 'спина'],
  ['вертикальная тяга', 'спина'], ['горизонтальная тяга', 'спина'],
  ['тяга блока', 'спина'], ['тяга штанги', 'спина'], ['тяга гантели', 'спина'],
  ['пуловер', 'спина'], ['гиперэкстензия', 'спина'], ['шраги', 'спина'],

  ['приседания', 'ноги'], ['жим ногами', 'ноги'], ['выпады', 'ноги'],
  ['разгибания ног', 'ноги'], ['сгибания ног', 'ноги'], ['румынская тяга', 'ноги'],
  ['становая', 'ноги'], ['болгарский', 'ноги'], ['ягодичный мост', 'ноги'],
  ['подъем на носки', 'ноги'],

  ['жим сидя', 'плечи'], ['жим стоя', 'плечи'], ['вертикальный жим', 'плечи'],
  ['отведения', 'плечи'], ['махи', 'плечи'], ['протяжка', 'плечи'],
  ['подъем штанги перед собой', 'плечи'], ['военный жим', 'плечи'],
  ['перед собой', 'плечи'],

  ['бицепс', 'бицепс'], ['сгибание рук', 'бицепс'], ['молотков', 'бицепс'],
  ['подъем гантелей на бицепс', 'бицепс'], ['подъем на бицепс', 'бицепс'],

  ['трицепс', 'трицепс'], ['французский жим', 'трицепс'],
  ['разгибание рук', 'трицепс'], ['разгибания на трицепс', 'трицепс'],
  ['из-за головы', 'трицепс'],

  ['пресс', 'пресс'], ['скручивания', 'пресс'], ['планка', 'пресс'],
  ['подъем ног', 'пресс'], ['велосипед', 'пресс'],
];

/** Ищем группу по словарю: самое длинное совпадение точнее. */
function knownMuscle(name: string): string | null {
  // «ё» → «е»: иначе «подъём» и «подъем» не совпадают со словарём.
  const n = name.toLowerCase().replace(/ё/g, 'е');
  let best: string | null = null;
  let bestLen = 0;
  for (const [key, muscle] of KNOWN_MUSCLES) {
    if (n.includes(key) && key.length > bestLen) { best = muscle; bestLen = key.length; }
  }
  return best;
}

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

    // Что знаем сами — отвечаем сразу, к модели идём только за остальным.
    const groups: Record<string, string> = {};
    const unknown: string[] = [];
    for (const n of names) {
      const hit = knownMuscle(n);
      if (hit) groups[n.toLowerCase()] = hit;
      else unknown.push(n);
    }
    if (unknown.length === 0) {
      return NextResponse.json({ groups });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured', groups: {} }, { status: 503 });
    }

    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      // Справочная задача: «жим лёжа → грудь», Opus тут не нужен.
      model: 'claude-haiku-4-5',
      max_tokens: 2000,
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

    // Дополняем тем, что уже нашли по словарю, а не заменяем.
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
