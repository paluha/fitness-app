import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { trackError, trackLatency } from '@/lib/monitor';

// Allow up to 30s for AI image analysis
export const maxDuration = 30;

// POST - Analyze food image using Gemini Flash
export async function POST(request: Request) {
  const startTime = Date.now();

  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { image, type, hint } = await request.json();

    if (!image) {
      return NextResponse.json({ error: 'No image provided' }, { status: 400 });
    }

    const GOOGLE_AI_API_KEY = process.env.GOOGLE_AI_API_KEY;

    if (!GOOGLE_AI_API_KEY) {
      await trackError({ route: '/api/food/analyze', method: 'POST', error: 'GOOGLE_AI_API_KEY not configured', userId: session.user.id });
      return NextResponse.json({ error: 'Google AI API key not configured' }, { status: 500 });
    }

    const isNutritionLabel = type === 'nutrition_label';

    const prompt = isNutritionLabel
      ? `Read this nutrition label. Return JSON only:
{"name":"product name","calories":number,"protein":number,"fat":number,"carbs":number,"serving":"size"}
Use 0 for unreadable values.`
      : `Food photo analysis.${hint ? ` Hint: "${hint}".` : ''} If scale visible, read exact weight.
Return JSON only:
{"name":"название на русском","calories":number,"protein":number,"fat":number,"carbs":number,"weight":number|null,"confidence":"high"|"medium"|"low","notes":"кратко"}`;


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

    // Call Gemini API — use flash-lite for speed on food photos, flash for nutrition labels (need OCR precision)
    const model = isNutritionLabel ? 'gemini-2.0-flash' : 'gemini-2.0-flash-lite';
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GOOGLE_AI_API_KEY}`,
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
            temperature: 0.2,
            maxOutputTokens: 200
          }
        })
      }
    );

    if (!response.ok) {
      const error = await response.json();
      const duration = await trackLatency('/api/food/analyze', startTime);
      await trackError({
        route: '/api/food/analyze', method: 'POST',
        error: `Gemini API ${response.status}`,
        details: JSON.stringify(error),
        userId: session.user.id, duration
      });
      return NextResponse.json({ error: 'Failed to analyze image' }, { status: 500 });
    }

    const data = await response.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!content) {
      const duration = await trackLatency('/api/food/analyze', startTime);
      await trackError({
        route: '/api/food/analyze', method: 'POST',
        error: 'Empty AI response',
        details: JSON.stringify(data),
        userId: session.user.id, duration
      });
      return NextResponse.json({ error: 'No response from AI' }, { status: 500 });
    }

    // Parse the JSON response
    try {
      let jsonStr = content.trim();
      if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7);
      if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3);
      if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3);
      jsonStr = jsonStr.trim();

      const result = JSON.parse(jsonStr);
      const duration = await trackLatency('/api/food/analyze', startTime);
      console.log(`[MONITOR] /api/food/analyze OK ${duration}ms user=${session.user.id}`);

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
      const duration = await trackLatency('/api/food/analyze', startTime);
      await trackError({
        route: '/api/food/analyze', method: 'POST',
        error: 'Failed to parse AI JSON',
        details: content.slice(0, 500),
        userId: session.user.id, duration
      });
      return NextResponse.json({ error: 'Failed to parse AI response', raw: content }, { status: 500 });
    }
  } catch (error) {
    const duration = await trackLatency('/api/food/analyze', startTime);
    await trackError({
      route: '/api/food/analyze', method: 'POST',
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error),
      duration
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
