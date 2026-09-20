import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import Anthropic from '@anthropic-ai/sdk';
import { trainxSystem } from '@/lib/trainx-ai';

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
      description: 'Приёмы пищи по порядку дня: когда, что именно и сколько',
      items: {
        type: 'object' as const,
        properties: {
          time: { type: 'string' as const, description: 'Время приёма в формате ЧЧ:ММ, например «08:00»' },
          label: { type: 'string' as const, description: 'Название приёма: Завтрак, Обед, Перекус, Ужин, После тренировки' },
          dish: { type: 'string' as const, description: 'Конкретное блюдо, которое нужно съесть, например «Гречка с курицей и овощами»' },
          portions: { type: 'number' as const, description: 'Сколько порций съесть, от 0.25 до 10, обычно 1' },
          protein: { type: 'number' as const, description: 'Белки ОДНОЙ порции блюда, г' },
          fat: { type: 'number' as const, description: 'Жиры ОДНОЙ порции блюда, г' },
          carbs: { type: 'number' as const, description: 'Углеводы ОДНОЙ порции блюда, г' },
          calories: { type: 'number' as const, description: 'Калории ОДНОЙ порции блюда, ккал' },
          emoji: { type: 'string' as const, description: 'Один эмодзи для приёма пищи' },
          note: { type: 'string' as const, description: 'Одно короткое предложение: почему именно это и сейчас' },
        },
        required: ['time', 'label', 'dish', 'portions', 'protein', 'fat', 'carbs', 'calories', 'emoji', 'note'],
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
    const profile = body.profile && typeof body.profile === 'object' ? body.profile as {
      conditions?: string[]; intolerances?: string[]; mealsPerDay?: number;
      snacking?: string; trainingTime?: string; dietStyle?: string; dislikes?: string; notes?: string;
    } : null;
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
      system: trainxSystem(
        'Ты — нутрициолог и тренер по питанию. Составляешь персональный план с учётом здоровья. ' +
        'МЕДИЦИНСКИЕ ПРАВИЛА (применяй только если состояние указано в анкете): ' +
        'инсулинорезистентность/преддиабет — БЕЗ перекусов, 3 плотных приёма, низкий гликемический индекс, ' +
        'в каждом приёме белок+клетчатка, углеводы преимущественно после тренировки, минимум сахара и фруктозы; ' +
        'диабет 2 типа — то же строже, ровный сахар в течение дня; ' +
        'проблемы ЖКТ — мягкая обработка (тушёное/варёное), осторожно с сырыми овощами и острым; ' +
        'повышенный холестерин — меньше насыщенных жиров, больше рыбы и клетчатки; ' +
        'гипотиреоз — достаточно йода/селена, не злоупотреблять соей и сырой капустой. ' +
        'Аллергии и непереносимости — строгое исключение. Нелюбимые продукты не предлагать. ' +
        'Число приёмов подстрой под анкету, но медицинские правила ВАЖНЕЕ привычек — если привычка вредна ' +
        '(например перекусы при инсулинорезистентности), мягко объясни это прямо в описании пункта плана. ' +
        'Список products должен ЛОГИЧЕСКИ следовать из плана: только продукты, совместимые с ограничениями и упомянутыми приёмами. ' +
        'Составляешь: (1) план «когда и что есть» на день — 3-5 приёмов пищи по порядку. ' +
        'Для КАЖДОГО приёма обязательно: время в формате ЧЧ:ММ, название приёма, ОДНО конкретное ' +
        'блюдо с составом в названии, число порций и КБЖУ ОДНОЙ порции этого блюда. ' +
        'Сумма (КБЖУ × порции) по всем приёмам должна сходиться с дневной целью в пределах 5%. ' +
        'Значения КБЖУ должны быть реалистичны для описанного блюда — не подгоняй их произвольно. ' +
        'Число приёмов бери из анкеты (сколько удобно), но не меньше 3 и не больше 5; ' +
        '(2) список рекомендуемых («разрешённых») продуктов под эту цель — 25-40 штук ' +
        'по категориям: protein (мясо/рыба/яйца), carbs (крупы/гарниры), vegetables (овощи), ' +
        'dairy (молочное), fats (жиры/орехи), fruits (фрукты/ягоды). ' +
        'Обязательно предпочитай продукты из истории пользователя, если они подходят под цель. ' +
        (language === 'en' ? 'Answer in English.' : 'Отвечай по-русски, кратко и по делу.')
      ),
      messages: [
        {
          role: 'user',
          content:
            `Цель: ${GOAL_LABELS[goal] || GOAL_LABELS.maintain}\n` +
            `Дневная цель: белок ${targets.protein ?? 200} г, жиры ${targets.fat ?? 90} г, углеводы ${targets.carbs ?? 200} г, ${targets.calories ?? 2400} ккал\n` +
            (profile
              ? 'АНКЕТА ЗДОРОВЬЯ:\n' +
                `- Состояния: ${(profile.conditions || []).join(', ') || 'нет'}\n` +
                `- Непереносимости/аллергии: ${(profile.intolerances || []).join(', ') || 'нет'}\n` +
                `- Удобно приёмов в день: ${profile.mealsPerDay || 3}\n` +
                `- Перекусы: ${profile.snacking || 'по ситуации'}\n` +
                `- Тренировки: ${profile.trainingTime || 'по-разному'}\n` +
                `- Стиль питания: ${profile.dietStyle || 'обычное'}\n` +
                (profile.dislikes ? `- Не ест/не любит: ${profile.dislikes}\n` : '') +
                (profile.notes ? `- Дополнительно: ${profile.notes}\n` : '')
              : 'Анкета здоровья не заполнена — дай универсальный безопасный план.\n') +
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
          items: {
            time: string; label: string; dish: string; portions: number;
            protein: number; fat: number; carbs: number; calories: number;
            emoji: string; note: string;
          }[];
          products?: { name: string; category: string }[];
        }
      : { items: [], products: [] };
    // Время приводим к ЧЧ:ММ и сортируем день по возрастанию: модель иногда
    // возвращает «8:00» или переставляет перекус вперёд завтрака.
    const normTime = (value: unknown) => {
      const m = /^\s*(\d{1,2})[:.](\d{2})/.exec(String(value ?? ''));
      if (!m) return null;
      const h = Number(m[1]), min = Number(m[2]);
      if (h > 23 || min > 59) return null;
      return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    };
    const num = (value: unknown, max: number) => {
      const n = Number(value);
      return Number.isFinite(n) && n >= 0 ? Math.min(Math.round(n), max) : 0;
    };
    const items = (parsed.items || [])
      .map(it => ({ it, time: normTime(it?.time) }))
      .filter((row): row is { it: typeof row.it; time: string } => !!row.time && !!row.it?.dish)
      .sort((a, b) => a.time.localeCompare(b.time))
      .slice(0, 5)
      .map((row, i) => {
        const portions = Number(row.it.portions);
        return {
          id: `ai-${i + 1}`,
          time: row.time,
          label: String(row.it.label || 'Приём пищи').slice(0, 40),
          dish: String(row.it.dish).slice(0, 180),
          // Порции ИИ иногда даёт нулём или дробью вне шага 0.25 — приводим
          // к тому же диапазону, что и ручной выбор в плане.
          portions: Number.isFinite(portions) && portions > 0
            ? Math.min(10, Math.max(0.25, Math.round(portions * 4) / 4))
            : 1,
          protein: num(row.it.protein, 400),
          fat: num(row.it.fat, 400),
          carbs: num(row.it.carbs, 800),
          calories: num(row.it.calories, 4000),
          emoji: String(row.it.emoji || '🍽️').slice(0, 8),
          note: String(row.it.note || '').slice(0, 240),
        };
      });
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
