import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

interface NutritionRec {
  title: string;
  description: string;
}

// POST - Get AI food recommendations based on context
export async function POST(request: Request) {
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
      language,
      mealTime,
      nutritionRecommendations,
      goal
    } = await request.json();

    // remainingMacros: { protein, fat, carbs, calories } - что осталось добрать
    // currentMacros: { protein, fat, carbs, calories } - уже съедено за день
    // targetMacros: { protein, fat, carbs, calories } - цель на день
    // userFoodHistory: array of { name, protein, fat, carbs, calories, isFavorite } - история еды пользователя
    // language: 'ru' | 'en'
    // mealTime: 'morning' | 'day' | 'evening' | 'night' | 'pre_workout' | 'post_workout'
    // nutritionRecommendations: array of { title, description } - рекомендации тренера
    // goal: 'lose_weight' | 'gain_mass' | 'maintain' | null

    const GOOGLE_AI_API_KEY = process.env.GOOGLE_AI_API_KEY;

    if (!GOOGLE_AI_API_KEY) {
      return NextResponse.json({ error: 'Google AI API key not configured' }, { status: 500 });
    }

    // Build user food history context - AI should use these exact names
    interface FoodItem {
      name: string;
      protein: number;
      fat: number;
      carbs: number;
      calories: number;
      isFavorite?: boolean;
    }

    const userFoodsContext = userFoodHistory && userFoodHistory.length > 0
      ? `\n\n📋 ПРОДУКТЫ ПОЛЬЗОВАТЕЛЯ (используй ТОЧНО эти названия если рекомендуешь их!):\n${userFoodHistory.map((m: FoodItem) =>
          `- ${m.isFavorite ? '❤️ ' : ''}${m.name}: Б${m.protein} Ж${m.fat} У${m.carbs} = ${m.calories} ккал`
        ).join('\n')}\n\nВАЖНО: Если рекомендуешь продукт из этого списка - используй ТОЧНОЕ название как у пользователя!`
      : '';

    // Build trainer recommendations context
    const trainerContext = nutritionRecommendations && nutritionRecommendations.length > 0
      ? `\n\n🎯 РЕКОМЕНДАЦИИ ТРЕНЕРА (ВАЖНО - следуй этим указаниям!):\n${nutritionRecommendations.map((r: NutritionRec) =>
          `- ${r.title}: ${r.description}`
        ).join('\n')}`
      : '';

    // Build goal context
    const goalText = goal === 'lose_weight' ? 'ПОХУДЕНИЕ (дефицит калорий, больше белка, меньше углеводов вечером)'
      : goal === 'gain_mass' ? 'НАБОР МАССЫ (профицит калорий, много белка и углеводов)'
      : goal === 'maintain' ? 'ПОДДЕРЖАНИЕ ВЕСА (сбалансированное питание)'
      : 'Не указана';

    // Build meal time context
    const mealTimeMap: Record<string, string> = {
      morning: '🌅 УТРО - Хорошо: каши, яйца, творог, хлебцы. Белок + сложные углеводы для энергии на день.',
      day: '☀️ ДЕНЬ - Основной приём пищи. Можно всё: мясо, рыба, гарнир, овощи.',
      evening: '🌙 ВЕЧЕР - Лёгкий белок + овощи. Меньше углеводов. Творог, рыба, курица.',
      night: '🌑 НОЧЬ - Только лёгкий белок если голодно. Творог, казеин. Минимум углеводов!',
      pre_workout: '💪 ДО ТРЕНИРОВКИ (1-2 часа) - Углеводы + немного белка. Рис, картофель, банан.',
      post_workout: '🏋️ ПОСЛЕ ТРЕНИРОВКИ (до 1 часа) - Быстрые углеводы + белок. Whey + банан, рисовые хлебцы.'
    };
    const mealTimeContext = mealTime ? mealTimeMap[mealTime] || '' : '';

    // Calculate what's most needed
    const proteinPct = currentMacros ? (currentMacros.protein / targetMacros.protein * 100).toFixed(0) : '?';
    const fatPct = currentMacros ? (currentMacros.fat / targetMacros.fat * 100).toFixed(0) : '?';
    const carbsPct = currentMacros ? (currentMacros.carbs / targetMacros.carbs * 100).toFixed(0) : '?';
    const caloriesPct = currentMacros ? (currentMacros.calories / targetMacros.calories * 100).toFixed(0) : '?';

    const prompt = `Ты - умный помощник по питанию. Помоги пользователю выбрать следующий приём пищи.

📊 ТЕКУЩИЙ ПРОГРЕСС ЗА ДЕНЬ:
- Белок: ${currentMacros?.protein || 0}г из ${targetMacros?.protein || 200}г (${proteinPct}%)
- Жиры: ${currentMacros?.fat || 0}г из ${targetMacros?.fat || 90}г (${fatPct}%)
- Углеводы: ${currentMacros?.carbs || 0}г из ${targetMacros?.carbs || 200}г (${carbsPct}%)
- Калории: ${currentMacros?.calories || 0} из ${targetMacros?.calories || 2400} ккал (${caloriesPct}%)

⏰ ОСТАЛОСЬ ДОБРАТЬ:
- Белок: ${remainingMacros.protein}г
- Жиры: ${remainingMacros.fat}г
- Углеводы: ${remainingMacros.carbs}г
- Калории: ${remainingMacros.calories} ккал

🎯 ЦЕЛЬ ПОЛЬЗОВАТЕЛЯ: ${goalText}

⏰ ВРЕМЯ ПРИЁМА ПИЩИ: ${mealTimeContext || 'Не указано'}
${trainerContext}
${userFoodsContext}

ЛОГИКА РЕКОМЕНДАЦИЙ:
1. ПРИОРИТЕТ №1: Если рекомендуешь продукт из истории пользователя - используй ТОЧНОЕ название!
2. ПРИОРИТЕТ №2: Учитывай рекомендации тренера (если есть) - там указаны разрешённые продукты и время
3. ПРИОРИТЕТ №3: Смотри на текущий прогресс - что нужно добрать больше всего
4. ПРИОРИТЕТ №4: Учитывай время суток - утром можно углеводы, вечером меньше
5. ПРИОРИТЕТ №5: Учитывай цель - при похудении меньше углеводов вечером, при наборе можно больше
6. Если цель близка к выполнению (>90%) - предложи лёгкий перекус или сообщи что можно не есть
7. Предпочитай продукты из истории пользователя (❤️ = любимые)

Предложи 2-3 варианта еды, подходящих именно сейчас.

Ответь ТОЛЬКО JSON в формате:
{
  "analysis": "Краткий анализ: что съедено, чего не хватает, что лучше сейчас (2-3 предложения)",
  "suggestions": [
    {
      "name": "название блюда",
      "description": "описание с размером порции",
      "protein": число,
      "fat": число,
      "carbs": число,
      "calories": число,
      "isFavorite": boolean,
      "reason": "почему именно это блюдо подходит сейчас"
    }
  ],
  "tip": "Один практический совет",
  "warning": "Предупреждение если что-то не так (переедание, неподходящее время и т.д.) или null"
}`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_AI_API_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }]
            }
          ],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1000
          }
        })
      }
    );

    if (!response.ok) {
      const error = await response.json();
      console.error('Gemini API error:', error);
      return NextResponse.json({ error: 'Failed to get recommendations' }, { status: 500 });
    }

    const data = await response.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!content) {
      return NextResponse.json({ error: 'No response from AI' }, { status: 500 });
    }

    // Parse the JSON response
    try {
      let jsonStr = content.trim();
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.slice(7);
      }
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.slice(3);
      }
      if (jsonStr.endsWith('```')) {
        jsonStr = jsonStr.slice(0, -3);
      }
      jsonStr = jsonStr.trim();

      const result = JSON.parse(jsonStr);

      return NextResponse.json({
        success: true,
        data: result
      });
    } catch (parseError) {
      console.error('Failed to parse AI response:', content);
      return NextResponse.json({
        error: 'Failed to parse AI response',
        raw: content
      }, { status: 500 });
    }
  } catch (error) {
    console.error('Error getting food recommendations:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
