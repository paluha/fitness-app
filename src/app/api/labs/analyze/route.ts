import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { trackError, trackLatency } from '@/lib/monitor';
import Anthropic from '@anthropic-ai/sdk';

// Анализ фото/скана результата анализа крови. Извлекаем показатели через
// Claude vision и возвращаем структурированный JSON, который юзер подтверждает
// перед сохранением. Паттерн как у /api/food/analyze.
export const maxDuration = 40;

const LAB_SYSTEM = `You read laboratory blood/lab test result documents (photos, scans,
or PDF pages rendered as images) and extract the measured markers.

Rules:
- Extract EVERY numeric marker you can read: name, value, unit, and the reference
  range (low/high) if printed.
- Use the exact marker names as printed (e.g. "Glucose", "Total Cholesterol",
  "Vitamin D, 25-Hydroxy", "TSH", "Hemoglobin A1c").
- value: numeric only (no unit). If a value is a "<" or ">" bound, use the number.
- unit: as printed (e.g. "mg/dL", "ng/mL", "%", "mIU/L"). Empty string if none.
- refLow / refHigh: numbers from the reference range if present, else null.
- flag: "low" if value < refLow, "high" if value > refHigh, else "normal".
  If no reference range, use "normal".
- panelName: the panel/test name if shown (e.g. "Comprehensive Metabolic Panel",
  "Lipid Panel"), else a short best-guess label.
- lab: the lab name if visible (e.g. "Quest Diagnostics", "LabCorp"), else "".
- collectedAt: the specimen collection date in YYYY-MM-DD if visible, else "".

Return ONLY a JSON object matching the requested schema. Do not invent markers
that are not in the document. If the image is not a lab report, return an empty
markers array.`;

const LAB_SCHEMA = {
  type: 'object',
  properties: {
    panelName: { type: 'string' },
    lab: { type: 'string' },
    collectedAt: { type: 'string' }, // YYYY-MM-DD или ""
    markers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          value: { type: 'number' },
          unit: { type: 'string' },
          refLow: { type: ['number', 'null'] },
          refHigh: { type: ['number', 'null'] },
          flag: { type: 'string', enum: ['low', 'normal', 'high'] },
        },
        required: ['name', 'value', 'unit', 'flag'],
        additionalProperties: false,
      },
    },
  },
  required: ['markers'],
  additionalProperties: false,
} as const;

type AllowedMime = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

function detectMime(image: string): { mime: AllowedMime; data: string } | null {
  let mime = 'image/jpeg';
  let data = image;
  if (image.startsWith('data:')) {
    const m = image.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return null;
    mime = m[1];
    data = m[2];
  }
  if (mime !== 'image/jpeg' && mime !== 'image/png' && mime !== 'image/gif' && mime !== 'image/webp') {
    return null;
  }
  return { mime: mime as AllowedMime, data };
}

export async function POST(request: Request) {
  const startTime = Date.now();
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { image } = await request.json();
    if (!image) {
      return NextResponse.json({ error: 'No image provided' }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Anthropic API key not configured' }, { status: 500 });
    }

    const decoded = detectMime(image);
    if (!decoded) {
      return NextResponse.json(
        { error: 'Unsupported image format. Use JPEG, PNG, GIF, or WebP.' },
        { status: 400 }
      );
    }

    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: [{ type: 'text', text: LAB_SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: { format: { type: 'json_schema', schema: LAB_SCHEMA } },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: decoded.mime, data: decoded.data } },
            { type: 'text', text: 'Извлеки все показатели из этого результата анализа.' },
          ],
        },
      ],
    });

    if (response.stop_reason === 'refusal') {
      await trackError({ route: '/api/labs/analyze', method: 'POST', error: 'Model refused image', userId: session.user.id });
      return NextResponse.json({ error: 'The image could not be analyzed.' }, { status: 422 });
    }

    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
    if (!textBlock) {
      return NextResponse.json({ error: 'No response from AI' }, { status: 500 });
    }

    let parsed: { panelName?: string; lab?: string; collectedAt?: string; markers?: unknown[] };
    try {
      parsed = JSON.parse(textBlock.text);
    } catch {
      return NextResponse.json({ error: 'Failed to parse AI response', raw: textBlock.text }, { status: 500 });
    }

    const markers = Array.isArray(parsed.markers) ? parsed.markers : [];
    if (markers.length === 0) {
      return NextResponse.json(
        { error: 'Не удалось распознать показатели. Загрузите более чёткое фото результата.' },
        { status: 422 }
      );
    }

    const duration = await trackLatency('/api/labs/analyze', startTime);
    console.log(`[MONITOR] /api/labs/analyze OK ${duration}ms user=${session.user.id} markers=${markers.length}`);

    return NextResponse.json({
      success: true,
      data: {
        panelName: parsed.panelName || '',
        lab: parsed.lab || '',
        collectedAt: parsed.collectedAt || '',
        markers,
      },
    });
  } catch (error) {
    const duration = await trackLatency('/api/labs/analyze', startTime);
    if (error instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: 'Rate limited — please retry in a moment.' }, { status: 429 });
    }
    await trackError({
      route: '/api/labs/analyze', method: 'POST',
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error),
      duration,
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
