import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

// Allow up to 60s for AI image analysis
export const maxDuration = 60;

// POST - Analyze food image using Gemini Flash
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { image, type, hint } = await request.json();

    // image should be base64 encoded
    // type: 'nutrition_label' | 'food_photo'
    // hint: optional user hint to help identify food (e.g., "жареная курица")

    if (!image) {
      return NextResponse.json({ error: 'No image provided' }, { status: 400 });
    }

    const GOOGLE_AI_API_KEY = process.env.GOOGLE_AI_API_KEY;

    if (!GOOGLE_AI_API_KEY) {
      return NextResponse.json({ error: 'Google AI API key not configured' }, { status: 500 });
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
${hint ? `\nUSER HINT: The user says this is "${hint}". Use this information to better identify the food and its preparation method (e.g., fried, boiled, with sauce, etc.).\n` : ''}
IMPORTANT: If you see a kitchen scale with a digital display showing weight in grams, READ THE EXACT WEIGHT from the display and use it for precise calculation. Look for numbers on any electronic scale display.

Steps:
1. Identify the food item(s)${hint ? ' (consider the user hint)' : ''}
2. Check if there's a scale with visible weight reading
3. If weight is visible - calculate KBJU based on exact weight
4. If no scale - estimate portion size visually

Respond ONLY with a JSON object in this exact format:
{
  "name": "название блюда на русском",
  "calories": number (kcal),
  "protein": number (grams),
  "fat": number (grams),
  "carbs": number (grams),
  "weight": number or null (grams from scale if visible),
  "confidence": "high" | "medium" | "low",
  "notes": "brief note in Russian (mention if weight was read from scale)"
}

If scale weight is visible, confidence should be "high".
Be realistic with estimates. Do not include any explanation, only the JSON.`;

    // Extract base64 data from data URL if needed
    let base64Data = image;
    let mimeType = 'image/jpeg';

    if (image.startsWith('data:')) {
      const matches = image.match(/^data:([^;]+);base64,(.+)$/);
      if (matches) {
        mimeType = matches[1];
        base64Data = matches[2];
      }
    }

    // Call Gemini API
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
              parts: [
                { text: prompt },
                {
                  inline_data: {
                    mime_type: mimeType,
                    data: base64Data
                  }
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 500
          }
        })
      }
    );

    if (!response.ok) {
      const error = await response.json();
      console.error('Gemini API error:', error);
      return NextResponse.json({ error: 'Failed to analyze image' }, { status: 500 });
    }

    const data = await response.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;

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
