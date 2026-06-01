import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { trackError, trackLatency } from '@/lib/monitor';
import Anthropic from '@anthropic-ai/sdk';

// Allow up to 30s for AI recommendations
export const maxDuration = 30;

interface NutritionRec {
  title: string;
  description: string;
}

interface FoodItem {
  name: string;
  protein: number;
  fat: number;
  carbs: number;
  calories: number;
  isFavorite?: boolean;
}

// Stable across every request — perfect for the cache. The dynamic per-user
// state (current macros, remaining macros, food history, trainer notes) goes
// in the user message AFTER the cache breakpoint so it does not invalidate
// this prefix.
const RECOMMEND_SYSTEM = `Ты — умный помощник по питанию. Помогаешь пользователю выбрать следующий приём пищи на основе его текущих макросов, истории еды, времени суток, цели и рекомендаций тренера.

ЛОГИКА РЕКОМЕНДАЦИЙ (применяй в порядке приоритета):
1. ПРИОРИТЕТ №1: Если рекомендуешь продукт из истории пользователя — используй ТОЧНОЕ название как у пользователя.
2. ПРИОРИТЕТ №2: Учитывай рекомендации тренера (если есть) — там указаны разрешённые продукты и время.
3. ПРИОРИТЕТ №3: Смотри на текущий прогресс — что нужно добрать больше всего (белок / жиры / углеводы / калории).
4. ПРИОРИТЕТ №4: Учитывай время суток — утром можно углеводы, вечером меньше.
5. ПРИОРИТЕТ №5: Учитывай цель — при похудении меньше углеводов вечером, при наборе можно больше.
6. Если цель близка к выполнению (>90% по калориям) — предложи лёгкий перекус или сообщи, что можно не есть.
7. Предпочитай продукты из истории пользователя (❤️ = любимые).

КОНТЕКСТ ВРЕМЕНИ СУТОК:
- 🌅 УТРО — хорошо: каши, яйца, творог, хлебцы. Белок + сложные углеводы для энергии на день.
- ☀️ ДЕНЬ — основной приём пищи. Можно всё: мясо, рыба, гарнир, овощи.
- 🌙 ВЕЧЕР — лёгкий белок + овощи. Меньше углеводов. Творог, рыба, курица.
- 🌑 НОЧЬ — только лёгкий белок если голодно. Творог, казеин. Минимум углеводов.
- 💪 ДО ТРЕНИРОВКИ (1-2 часа) — углеводы + немного белка. Рис, картофель, банан.
- 🏋️ ПОСЛЕ ТРЕНИРОВКИ (до 1 часа) — быстрые углеводы + белок. Whey + банан, рисовые хлебцы.

КОНТЕКСТ ЦЕЛИ:
- ПОХУДЕНИЕ — дефицит калорий, больше белка, меньше углеводов вечером.
- НАБОР МАССЫ — профицит калорий, много белка и углеводов.
- ПОДДЕРЖАНИЕ ВЕСА — сбалансированное питание.

ФОРМАТ ОТВЕТА:
Предложи 2-3 варианта еды, подходящих именно сейчас. Поле analysis — краткий анализ (2-3 предложения): что съедено, чего не хватает, что лучше сейчас. Поле tip — один практический совет. Поле warning — предупреждение если что-то не так (переедание, неподходящее время и т.д.) или null.`;

const RECOMMEND_SCHEMA = {
  type: 'object',
  properties: {
    analysis: { type: 'string' },
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          protein: { type: 'number' },
          fat: { type: 'number' },
          carbs: { type: 'number' },
          calories: { type: 'number' },
          isFavorite: { type: 'boolean' },
          reason: { type: 'string' },
        },
        required: ['name', 'description', 'protein', 'fat', 'carbs', 'calories', 'reason'],
        additionalProperties: false,
      },
    },
    tip: { type: 'string' },
    warning: { type: ['string', 'null'] },
  },
  required: ['analysis', 'suggestions', 'tip'],
  additionalProperties: false,
} as const;

const MEAL_TIME_LABELS: Record<string, string> = {
  morning: '🌅 УТРО',
  day: '☀️ ДЕНЬ',
  evening: '🌙 ВЕЧЕР',
  night: '🌑 НОЧЬ',
  pre_workout: '💪 ДО ТРЕНИРОВКИ',
  post_workout: '🏋️ ПОСЛЕ ТРЕНИРОВКИ',
};

const GOAL_LABELS: Record<string, string> = {
  lose_weight: 'ПОХУДЕНИЕ',
  gain_mass: 'НАБОР МАССЫ',
  maintain: 'ПОДДЕРЖАНИЕ ВЕСА',
};

// POST - Get AI food recommendations based on context
export async function POST(request: Request) {
  const startTime = Date.now();

  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const {
      remainingMacros,
      currentMacros,
      targetMacros,
      userFoodHistory,
      mealTime,
      nutritionRecommendations,
      goal,
    } = await request.json();

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      await trackError({
        route: '/api/food/recommend',
        method: 'POST',
        error: 'ANTHROPIC_API_KEY not configured',
        userId: session.user.id,
      });
      return NextResponse.json({ error: 'Anthropic API key not configured' }, { status: 500 });
    }

    // Build the dynamic per-request user message. All this varies, so it sits
    // AFTER the cached system prompt and does not invalidate the cache.
    const proteinPct = currentMacros
      ? ((currentMacros.protein / targetMacros.protein) * 100).toFixed(0)
      : '?';
    const fatPct = currentMacros
      ? ((currentMacros.fat / targetMacros.fat) * 100).toFixed(0)
      : '?';
    const carbsPct = currentMacros
      ? ((currentMacros.carbs / targetMacros.carbs) * 100).toFixed(0)
      : '?';
    const caloriesPct = currentMacros
      ? ((currentMacros.calories / targetMacros.calories) * 100).toFixed(0)
      : '?';

    const userFoodsContext =
      userFoodHistory && userFoodHistory.length > 0
        ? `\n\n📋 ПРОДУКТЫ ПОЛЬЗОВАТЕЛЯ (используй ТОЧНО эти названия если рекомендуешь их):\n${(userFoodHistory as FoodItem[])
            .map(
              (m) =>
                `- ${m.isFavorite ? '❤️ ' : ''}${m.name}: Б${m.protein} Ж${m.fat} У${m.carbs} = ${m.calories} ккал`
            )
            .join('\n')}`
        : '';

    const trainerContext =
      nutritionRecommendations && nutritionRecommendations.length > 0
        ? `\n\n🎯 РЕКОМЕНДАЦИИ ТРЕНЕРА:\n${(nutritionRecommendations as NutritionRec[])
            .map((r) => `- ${r.title}: ${r.description}`)
            .join('\n')}`
        : '';

    const userMessage = `📊 ТЕКУЩИЙ ПРОГРЕСС ЗА ДЕНЬ:
- Белок: ${currentMacros?.protein || 0}г из ${targetMacros?.protein || 200}г (${proteinPct}%)
- Жиры: ${currentMacros?.fat || 0}г из ${targetMacros?.fat || 90}г (${fatPct}%)
- Углеводы: ${currentMacros?.carbs || 0}г из ${targetMacros?.carbs || 200}г (${carbsPct}%)
- Калории: ${currentMacros?.calories || 0} из ${targetMacros?.calories || 2400} ккал (${caloriesPct}%)

⏰ ОСТАЛОСЬ ДОБРАТЬ:
- Белок: ${remainingMacros.protein}г
- Жиры: ${remainingMacros.fat}г
- Углеводы: ${remainingMacros.carbs}г
- Калории: ${remainingMacros.calories} ккал

🎯 ЦЕЛЬ: ${GOAL_LABELS[goal] || 'Не указана'}
⏰ ВРЕМЯ ПРИЁМА ПИЩИ: ${mealTime ? MEAL_TIME_LABELS[mealTime] || mealTime : 'Не указано'}${trainerContext}${userFoodsContext}

Подбери 2-3 варианта еды на сейчас.`;

    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      system: [
        {
          type: 'text',
          text: RECOMMEND_SYSTEM,
          cache_control: { type: 'ephemeral' },
        },
      ],
      output_config: {
        format: {
          type: 'json_schema',
          schema: RECOMMEND_SCHEMA,
        },
      },
      messages: [{ role: 'user', content: userMessage }],
    });

    if (response.stop_reason === 'refusal') {
      const duration = await trackLatency('/api/food/recommend', startTime);
      await trackError({
        route: '/api/food/recommend',
        method: 'POST',
        error: 'Model refused recommendation',
        details: JSON.stringify({ stop_reason: response.stop_reason }),
        userId: session.user.id,
        duration,
      });
      return NextResponse.json(
        { error: 'The recommendation request could not be processed.' },
        { status: 422 }
      );
    }

    const textBlock = response.content.find(
      (b): b is Anthropic.TextBlock => b.type === 'text'
    );
    if (!textBlock) {
      const duration = await trackLatency('/api/food/recommend', startTime);
      await trackError({
        route: '/api/food/recommend',
        method: 'POST',
        error: 'Empty AI response',
        details: JSON.stringify({ stop_reason: response.stop_reason }),
        userId: session.user.id,
        duration,
      });
      return NextResponse.json({ error: 'No response from AI' }, { status: 500 });
    }

    let result: Record<string, unknown>;
    try {
      result = JSON.parse(textBlock.text);
    } catch (e) {
      const duration = await trackLatency('/api/food/recommend', startTime);
      await trackError({
        route: '/api/food/recommend',
        method: 'POST',
        error: 'Failed to parse AI JSON',
        details: textBlock.text.slice(0, 500),
        userId: session.user.id,
        duration,
      });
      return NextResponse.json(
        { error: 'Failed to parse AI response', raw: textBlock.text },
        { status: 500 }
      );
    }

    const duration = await trackLatency('/api/food/recommend', startTime);
    const cacheRead = response.usage.cache_read_input_tokens ?? 0;
    const cacheWrite = response.usage.cache_creation_input_tokens ?? 0;
    console.log(
      `[MONITOR] /api/food/recommend OK ${duration}ms user=${session.user.id} ` +
        `in=${response.usage.input_tokens} out=${response.usage.output_tokens} ` +
        `cache_read=${cacheRead} cache_write=${cacheWrite}`
    );

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    const duration = await trackLatency('/api/food/recommend', startTime);

    if (error instanceof Anthropic.RateLimitError) {
      await trackError({
        route: '/api/food/recommend',
        method: 'POST',
        error: 'Anthropic rate limit',
        details: error.message,
        duration,
      });
      return NextResponse.json(
        { error: 'Rate limited — please retry in a moment.' },
        { status: 429 }
      );
    }
    if (error instanceof Anthropic.APIError) {
      await trackError({
        route: '/api/food/recommend',
        method: 'POST',
        error: `Anthropic API ${error.status}`,
        details: error.message,
        duration,
      });
      return NextResponse.json({ error: 'Failed to get recommendations' }, { status: 500 });
    }

    await trackError({
      route: '/api/food/recommend',
      method: 'POST',
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error),
      duration,
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
