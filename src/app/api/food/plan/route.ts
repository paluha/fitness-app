import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import Anthropic from '@anthropic-ai/sdk';

// Персональный план «когда и что есть» на день — генерируется ИИ под цель
// пользователя (похудение/поддержание/набор), его макро-цели и его же
// продукты из истории. Заменяет статичные тексты в блоке «Когда есть».
// Клиент кэширует результат на день, так что вызов ~раз в сутки.

export const maxDuration = 30;

const GOAL_LABELS: Record<string, string> = {
  lose: 'ПОХУДЕНИЕ (дефицит калорий)',
  maintain: 'ПОДДЕРЖАНИЕ ВЕСА',
  gain: 'НАБОР МАССЫ (профицит калорий)',
  recomp: 'РЕКОМПОЗИЦИЯ — атлетическое телосложение (рост мышц + сжигание жира одновременно: калории около поддержания, белок повышенный 2+ г/кг веса, углеводы преимущественно вокруг тренировок)',
};

const PLAN_SCHEMA = {
  type: 'object' as const,
  properties: {
    items: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          emoji: { type: 'string' as const, description: 'Один эмодзи для приёма пищи' },
          title: { type: 'string' as const, description: 'Короткий заголовок: время/приём, например «Утро», «После тренировки»' },
          description: { type: 'string' as const, description: '1-2 предложения: что именно есть и почему, с конкретными продуктами' },
          color: { type: 'string' as const, enum: ['yellow', 'green', 'blue', 'red', 'purple'] },
        },
        required: ['emoji', 'title', 'description', 'color'],
        additionalProperties: false,
      },
    },
    products: {
      type: 'array' as const,
      description: 'Рекомендуемые (разрешённые) продукты под цель, 25-40 штук по категориям',
      items: {
        type: 'object' as const,
        properties: {
          name: { type: 'string' as const, description: 'Название продукта, кратко, по-русски' },
          category: { type: 'string' as const, enum: ['protein', 'carbs', 'vegetables', 'dairy', 'fats', 'fruits'] },
        },
        required: ['name', 'category'],
        additionalProperties: false,
      },
    },
  },
  required: ['items', 'products'],
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
    const language: string = body.language === 'en' ? 'en' : 'ru';
    const targets = body.targetMacros && typeof body.targetMacros === 'object'
      ? body.targetMacros as { protein?: number; fat?: number; carbs?: number; calories?: number }
      : {};
    const history: string[] = Array.isArray(body.foodHistory)
      ? (body.foodHistory as unknown[]).filter((n): n is string => typeof n === 'string').slice(0, 30)
      : [];

    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: 'claude-opus-5',
      max_tokens: 8000,
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: PLAN_SCHEMA },
      },
      system:
        'Ты — тренер по питанию. Составляешь: (1) короткий план питания на день — 4-6 пунктов ' +
        '(утро, день, до/после тренировки, вечер), каждый пункт — когда есть и ЧТО именно, ' +
        'с конкретными продуктами и краткой причиной под цель пользователя; ' +
        '(2) список рекомендуемых («разрешённых») продуктов под эту цель — 25-40 штук ' +
        'по категориям: protein (мясо/рыба/яйца), carbs (крупы/гарниры), vegetables (овощи), ' +
        'dairy (молочное), fats (жиры/орехи), fruits (фрукты/ягоды). ' +
        'Обязательно предпочитай продукты из истории пользователя, если они подходят под цель. ' +
        (language === 'en' ? 'Answer in English.' : 'Отвечай по-русски, кратко и по делу.'),
      messages: [
        {
          role: 'user',
          content:
            `Цель: ${GOAL_LABELS[goal] || GOAL_LABELS.maintain}\n` +
            `Дневная цель: белок ${targets.protein ?? 200} г, жиры ${targets.fat ?? 90} г, углеводы ${targets.carbs ?? 200} г, ${targets.calories ?? 2400} ккал\n` +
            (history.length ? `Продукты, которые пользователь обычно ест: ${history.join(', ')}\n` : '') +
            'Составь план «когда и что есть» на день.',
        },
      ],
    });

    if (response.stop_reason === 'refusal') {
      return NextResponse.json({ error: 'model refused' }, { status: 502 });
    }

    const textBlock = response.content.find(b => b.type === 'text');
    const parsed = textBlock
      ? JSON.parse(textBlock.text) as {
          items: { emoji: string; title: string; description: string; color: string }[];
          products?: { name: string; category: string }[];
        }
      : { items: [], products: [] };
    const items = (parsed.items || []).slice(0, 6).map((it, i) => ({
      id: `ai-${i + 1}`,
      emoji: it.emoji || '🍽️',
      title: it.title,
      description: it.description,
      color: it.color || 'yellow',
    }));
    const CATS = new Set(['protein', 'carbs', 'vegetables', 'dairy', 'fats', 'fruits']);
    const products = (parsed.products || [])
      .filter(p => p?.name && CATS.has(p.category))
      .slice(0, 50)
      .map((p, i) => ({ id: `aip-${i + 1}`, name: p.name, category: p.category }));

    if (items.length === 0) {
      return NextResponse.json({ error: 'empty plan' }, { status: 502 });
    }
    return NextResponse.json({ success: true, items, products });
  } catch (error) {
    console.error('food plan error:', error);
    return NextResponse.json({ error: 'Failed to generate plan' }, { status: 500 });
  }
}
