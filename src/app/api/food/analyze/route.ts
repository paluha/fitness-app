import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { trackError, trackLatency } from '@/lib/monitor';
import Anthropic from '@anthropic-ai/sdk';

// Allow up to 30s for AI image analysis
export const maxDuration = 30;

// System prompts are stable across requests — cache them so we only pay full
// price on the first call per ~5-minute window. The user message (the image +
// optional hint) varies and is NOT cached.
const FOOD_PHOTO_SYSTEM = `You analyze food photos and return nutrition information.

Look at the image and identify the food. If a kitchen scale is visible in the
photo, read the exact weight from it. Otherwise estimate the portion size.

Return ONLY a JSON object matching the requested schema. All numbers should be
realistic per-serving values:
- calories: kcal
- protein, fat, carbs: grams
- weight: grams (null if not visible / not applicable)
- name: in Russian
- confidence: "high" if scale-read or unambiguous food, "medium" if estimating
  a clearly identifiable food, "low" if unsure
- notes: short Russian note (assumptions, what was hard to see, etc.)`;

const NUTRITION_LABEL_SYSTEM = `You read nutrition labels from product packaging
photos and return the values exactly as printed on the label.

Return ONLY a JSON object matching the requested schema:
- name: product name from the label
- calories, protein, fat, carbs: numbers from the label (use 0 if a value is
  not readable)
- serving: serving size string from the label (e.g. "100 г", "1 порция (30 г)")`;

// Output schemas — Claude validates these and guarantees parseable JSON.
const FOOD_PHOTO_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    calories: { type: 'number' },
    protein: { type: 'number' },
    fat: { type: 'number' },
    carbs: { type: 'number' },
    weight: { type: ['number', 'null'] },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    notes: { type: 'string' },
  },
  required: ['name', 'calories', 'protein', 'fat', 'carbs', 'confidence'],
  additionalProperties: false,
} as const;

const NUTRITION_LABEL_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    calories: { type: 'number' },
    protein: { type: 'number' },
    fat: { type: 'number' },
    carbs: { type: 'number' },
    serving: { type: 'string' },
  },
  required: ['name', 'calories', 'protein', 'fat', 'carbs'],
  additionalProperties: false,
} as const;

type AllowedMime = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

function detectMime(image: string): { mime: AllowedMime; data: string } | null {
  let mime: string = 'image/jpeg';
  let data = image;
  if (image.startsWith('data:')) {
    const m = image.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return null;
    mime = m[1];
    data = m[2];
  }
  if (
    mime !== 'image/jpeg' &&
    mime !== 'image/png' &&
    mime !== 'image/gif' &&
    mime !== 'image/webp'
  ) {
    return null;
  }
  return { mime, data };
}

// POST - Analyze food image using Claude Sonnet 4.6 vision
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

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      await trackError({
        route: '/api/food/analyze',
        method: 'POST',
        error: 'ANTHROPIC_API_KEY not configured',
        userId: session.user.id,
      });
      return NextResponse.json({ error: 'Anthropic API key not configured' }, { status: 500 });
    }

    const isNutritionLabel = type === 'nutrition_label';
    const systemPrompt = isNutritionLabel ? NUTRITION_LABEL_SYSTEM : FOOD_PHOTO_SYSTEM;
    const schema = isNutritionLabel ? NUTRITION_LABEL_SCHEMA : FOOD_PHOTO_SCHEMA;

    const decoded = detectMime(image);
    if (!decoded) {
      return NextResponse.json(
        { error: 'Unsupported image format. Use JPEG, PNG, GIF, or WebP.' },
        { status: 400 }
      );
    }

    const userText = isNutritionLabel
      ? 'Прочитай состав с этикетки на фото и верни данные.'
      : hint
        ? `Проанализируй еду на фото. Подсказка от пользователя: "${hint}".`
        : 'Проанализируй еду на фото.';

    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      system: [
        {
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ],
      output_config: {
        format: {
          type: 'json_schema',
          schema,
        },
      },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: decoded.mime,
                data: decoded.data,
              },
            },
            { type: 'text', text: userText },
          ],
        },
      ],
    });

    // Surface refusals as a 422 — these are explicit model refusals, not
    // server errors. The client should show the user a friendly message and
    // not retry the same image.
    if (response.stop_reason === 'refusal') {
      const duration = await trackLatency('/api/food/analyze', startTime);
      await trackError({
        route: '/api/food/analyze',
        method: 'POST',
        error: 'Model refused image',
        details: JSON.stringify({ stop_reason: response.stop_reason }),
        userId: session.user.id,
        duration,
      });
      return NextResponse.json(
        { error: 'The image could not be analyzed.' },
        { status: 422 }
      );
    }

    // With output_config.format.json_schema, Claude returns a single text
    // block whose content is the schema-validated JSON object (as a string).
    const textBlock = response.content.find(
      (b): b is Anthropic.TextBlock => b.type === 'text'
    );
    if (!textBlock) {
      const duration = await trackLatency('/api/food/analyze', startTime);
      await trackError({
        route: '/api/food/analyze',
        method: 'POST',
        error: 'Empty AI response',
        details: JSON.stringify({ stop_reason: response.stop_reason }),
        userId: session.user.id,
        duration,
      });
      return NextResponse.json({ error: 'No response from AI' }, { status: 500 });
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(textBlock.text);
    } catch (e) {
      const duration = await trackLatency('/api/food/analyze', startTime);
      await trackError({
        route: '/api/food/analyze',
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

    const duration = await trackLatency('/api/food/analyze', startTime);
    const cacheRead = response.usage.cache_read_input_tokens ?? 0;
    const cacheWrite = response.usage.cache_creation_input_tokens ?? 0;
    console.log(
      `[MONITOR] /api/food/analyze OK ${duration}ms user=${session.user.id} ` +
        `in=${response.usage.input_tokens} out=${response.usage.output_tokens} ` +
        `cache_read=${cacheRead} cache_write=${cacheWrite}`
    );

    return NextResponse.json({
      success: true,
      type: isNutritionLabel ? 'nutrition_label' : 'food_photo',
      data: {
        name: (parsed.name as string) || 'Еда',
        calories: Math.round(Number(parsed.calories) || 0),
        protein: Math.round(Number(parsed.protein) || 0),
        fat: Math.round(Number(parsed.fat) || 0),
        carbs: Math.round(Number(parsed.carbs) || 0),
        serving: parsed.serving as string | undefined,
        confidence: parsed.confidence as string | undefined,
        notes: parsed.notes as string | undefined,
      },
    });
  } catch (error) {
    const duration = await trackLatency('/api/food/analyze', startTime);

    if (error instanceof Anthropic.RateLimitError) {
      await trackError({
        route: '/api/food/analyze',
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
        route: '/api/food/analyze',
        method: 'POST',
        error: `Anthropic API ${error.status}`,
        details: error.message,
        duration,
      });
      return NextResponse.json({ error: 'Failed to analyze image' }, { status: 500 });
    }

    await trackError({
      route: '/api/food/analyze',
      method: 'POST',
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error),
      duration,
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
