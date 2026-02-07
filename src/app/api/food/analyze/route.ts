import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

// POST - Analyze food image using OpenAI Vision
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { image, type } = await request.json();

    // image should be base64 encoded
    // type: 'nutrition_label' | 'food_photo'

    if (!image) {
      return NextResponse.json({ error: 'No image provided' }, { status: 400 });
    }

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

    if (!OPENAI_API_KEY) {
      return NextResponse.json({ error: 'OpenAI API key not configured' }, { status: 500 });
    }

    const isNutritionLabel = type === 'nutrition_label';

    const prompt = isNutritionLabel
      ? `Analyze this nutrition facts label. Extract the following values per serving:
- Name of the product (if visible)
- Calories (kcal)
- Protein (grams)
- Fat (grams)
- Carbohydrates (grams)
- Serving size

Respond ONLY with a JSON object in this exact format:
{
  "name": "product name or 'Продукт'",
  "calories": number,
  "protein": number,
  "fat": number,
  "carbs": number,
  "serving": "serving size description"
}

If you cannot read some values, use 0. Do not include any explanation, only the JSON.`
      : `Analyze this photo of food/meal. Estimate the nutritional content based on what you see.
Consider the portion size visible in the image.

Respond ONLY with a JSON object in this exact format:
{
  "name": "название блюда на русском",
  "calories": number (estimated kcal),
  "protein": number (estimated grams),
  "fat": number (estimated grams),
  "carbs": number (estimated grams),
  "confidence": "high" | "medium" | "low",
  "notes": "brief note about the estimation in Russian"
}

Be realistic with your estimates. If unsure, err on the side of caution.
Do not include any explanation, only the JSON.`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: prompt
              },
              {
                type: 'image_url',
                image_url: {
                  url: image.startsWith('data:') ? image : `data:image/jpeg;base64,${image}`,
                  detail: 'high'
                }
              }
            ]
          }
        ],
        max_tokens: 500,
        temperature: 0.3
      })
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('OpenAI API error:', error);
      return NextResponse.json({ error: 'Failed to analyze image' }, { status: 500 });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return NextResponse.json({ error: 'No response from AI' }, { status: 500 });
    }

    // Parse the JSON response
    try {
      // Clean up the response - remove markdown code blocks if present
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
        type: isNutritionLabel ? 'nutrition_label' : 'food_photo',
        data: {
          name: result.name || 'Еда',
          calories: Math.round(Number(result.calories) || 0),
          protein: Math.round(Number(result.protein) || 0),
          fat: Math.round(Number(result.fat) || 0),
          carbs: Math.round(Number(result.carbs) || 0),
          serving: result.serving,
          confidence: result.confidence,
          notes: result.notes
        }
      });
    } catch (parseError) {
      console.error('Failed to parse AI response:', content);
      return NextResponse.json({
        error: 'Failed to parse AI response',
        raw: content
      }, { status: 500 });
    }
  } catch (error) {
    console.error('Error analyzing food image:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
