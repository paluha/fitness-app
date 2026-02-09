import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

// POST - Get AI food recommendations based on remaining macros
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { remainingMacros, favoriteMeals, language } = await request.json();

    // remainingMacros: { protein: number, fat: number, carbs: number, calories: number }
    // favoriteMeals: array of { name, protein, fat, carbs, calories }
    // language: 'ru' | 'en'

    const GOOGLE_AI_API_KEY = process.env.GOOGLE_AI_API_KEY;

    if (!GOOGLE_AI_API_KEY) {
      return NextResponse.json({ error: 'Google AI API key not configured' }, { status: 500 });
    }

    const isRussian = language === 'ru';

    // Build favorites context
    const favoritesContext = favoriteMeals && favoriteMeals.length > 0
      ? `\n\nUser's favorite meals (prefer these when appropriate):\n${favoriteMeals.map((m: { name: string; protein: number; fat: number; carbs: number; calories: number }) =>
          `- ${m.name}: ${m.protein}g protein, ${m.fat}g fat, ${m.carbs}g carbs, ${m.calories} kcal`
        ).join('\n')}`
      : '';

    const prompt = `You are a nutrition assistant. The user needs to eat more to reach their daily macro goals.

Remaining macros needed:
- Protein: ${remainingMacros.protein}g
- Fat: ${remainingMacros.fat}g
- Carbs: ${remainingMacros.carbs}g
- Calories: ${remainingMacros.calories} kcal
${favoritesContext}

Suggest 2-3 meal options that would help them reach these goals. Consider:
1. If user has favorites that fit - suggest those first
2. Suggest practical, common foods
3. Include portion sizes
4. Focus on what's most needed (if low protein - suggest protein-rich foods, etc.)

Respond in ${isRussian ? 'Russian' : 'English'} with JSON format:
{
  "analysis": "Brief analysis of what macros are most needed (1-2 sentences)",
  "suggestions": [
    {
      "name": "meal name",
      "description": "brief description with portion size",
      "protein": number,
      "fat": number,
      "carbs": number,
      "calories": number,
      "isFavorite": boolean
    }
  ],
  "tip": "One practical tip for the user"
}

Only respond with JSON, no markdown.`;

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
            maxOutputTokens: 800
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
