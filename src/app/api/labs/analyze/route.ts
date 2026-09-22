import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { trackError, trackLatency } from '@/lib/monitor';
import Anthropic from '@anthropic-ai/sdk';

// Анализ фото/скана результата анализа крови. Извлекаем показатели через
// Claude vision и возвращаем структурированный JSON, который юзер подтверждает
// перед сохранением. Паттерн как у /api/food/analyze.
// Платформа рвёт функцию на 30 секундах — держим то же значение,
// чтобы не обещать больше, чем есть.
export const maxDuration = 30;

const LAB_SYSTEM = `You read laboratory blood/lab test result documents (photos, scans,
or PDF pages rendered as images) and extract the measured markers.

Rules:
- Extract EVERY numeric marker you can read: name, value, unit, and the reference
  range (low/high) if printed.
- Use the exact marker names as printed (e.g. "Glucose", "Total Cholesterol",
  "Vitamin D, 25-Hydroxy", "TSH", "Hemoglobin A1c").
- key: a stable snake_case identifier for the ANALYTE, not the printed spelling.
  The same analyte must get the same key across different labs and languages:
  "Glucose"/"Глюкоза натощак"/"Fasting glucose" -> "fasting_glucose";
  "LDL"/"Холестерин ЛПНП"/"LDL-C" -> "ldl_cholesterol";
  "Vitamin D, 25-Hydroxy" -> "vitamin_d_25oh"; "Hemoglobin" -> "haemoglobin";
  "TSH" -> "tsh"; "HbA1c" -> "hba1c". Use a descriptive snake_case key when the
  analyte is not in this list. Different assays of the same substance get
  different keys (e.g. "insulin_fasting" vs "insulin_2h").
- value: numeric only (no unit). Decimal comma means decimal point: "5,9" -> 5.9.
- rawValue: the value EXACTLY as printed, including "<", ">", comma, or text
  ("<5", "5,9", "Negative", "Not detected"). Never normalise it.
- bound: "below" for "<5", "above" for ">100", otherwise "exact". A bound is NOT
  an exact measurement - value carries the number, bound carries the relation.
- unit: as printed (e.g. "mg/dL", "ng/mL", "%", "mIU/L"). Empty string if none.
- refLow / refHigh: numbers from the reference range if present, else null.
  One-sided ranges are normal: "> 39" -> refLow 39, refHigh null; "< 90" ->
  refLow null, refHigh 90. Never invent the missing side.
- specimen: the biomaterial if stated ("serum", "plasma", "whole blood", "urine"),
  else "". Do not guess it from the analyte name.
- method: the assay/method if printed ("LC-MS/MS", "immunoassay", "calculated"),
  else "". The same substance measured by different methods is not interchangeable.
- page: 1-based page number the value was read from, or null if unclear.
- group: the section heading it appears under ("Lipids", "Thyroid", "CBC"), or "".
- needsReview: true when you are NOT confident - blurred or cut-off text, an
  ambiguous unit, a date you had to infer, or a value you could not read cleanly.
  Prefer flagging over guessing. A flagged value is shown to the user for checking.
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
          key: { type: 'string' },
          name: { type: 'string' },
          value: { type: 'number' },
          unit: { type: 'string' },
          refLow: { type: ['number', 'null'] },
          refHigh: { type: ['number', 'null'] },
          flag: { type: 'string', enum: ['low', 'normal', 'high'] },
          rawValue: { type: 'string' },
          specimen: { type: 'string' },
          method: { type: 'string' },
          bound: { type: 'string', enum: ['exact', 'below', 'above'] },
          page: { type: ['number', 'null'] },
          group: { type: 'string' },
          needsReview: { type: 'boolean' },
        },
        required: ['key', 'name', 'value', 'unit', 'flag', 'rawValue', 'specimen', 'method', 'bound', 'page', 'group', 'needsReview'],
        additionalProperties: false,
      },
    },
  },
  required: ['markers'],
  additionalProperties: false,
} as const;

type AllowedImage = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
const PDF_MIME = 'application/pdf';

type Decoded =
  | { kind: 'image'; mime: AllowedImage; data: string }
  | { kind: 'pdf'; data: string };

/**
 * Бланки из лаборатории чаще приходят PDF, а не фото: модель читает их
 * напрямую документом, конвертировать в картинку не нужно.
 */
function detectSource(input: string): Decoded | null {
  let mime = 'image/jpeg';
  let data = input;
  if (input.startsWith('data:')) {
    const m = input.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return null;
    mime = m[1];
    data = m[2];
  }
  if (mime === PDF_MIME) return { kind: 'pdf', data };
  if (mime === 'image/jpeg' || mime === 'image/png' || mime === 'image/gif' || mime === 'image/webp') {
    return { kind: 'image', mime, data };
  }
  return null;
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

    const decoded = detectSource(image);
    if (!decoded) {
      return NextResponse.json(
        { error: 'Поддерживаются PDF и фото JPEG, PNG, GIF или WebP.' },
        { status: 400 }
      );
    }

    // У PDF из лаборатории почти всегда есть текстовый слой. Вытащить его
    // — это десятки миллисекунд против десятков секунд на зрение, и
    // страницы перестают упираться в 30-секундный лимит платформы.
    // Зрение остаётся для сканов и фото, где текста в файле нет.
    let pdfText: string | null = null;
    if (decoded.kind === 'pdf') {
      try {
        const { extractText, getDocumentProxy } = await import('unpdf');
        const bytes = new Uint8Array(Buffer.from(decoded.data, 'base64'));
        const doc = await getDocumentProxy(bytes);
        const { text } = await extractText(doc, { mergePages: true });
        const clean = String(text || '').replace(/\u0000/g, '').trim();
        // Короткий результат — признак скана: там текста нет, только картинка.
        if (clean.length >= 200) pdfText = clean.slice(0, 120_000);
      } catch (e) {
        console.warn('[labs] не удалось извлечь текст из PDF, читаем зрением:', e instanceof Error ? e.message : e);
      }
    }

    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      // Разложить готовый текст бланка по схеме — простая задача, и
      // генерация 40+ записей JSON упиралась в лимит платформы на более
      // тяжёлой модели. Скан без текстового слоя всё ещё требует зрения,
      // поэтому модель одна на оба пути.
      model: 'claude-haiku-4-5',
      // Бланк на 130-500 показателей с полями сопоставления — это
      // десятки тысяч токенов. Берём с запасом; если ответ всё же
      // упрётся в потолок, ниже показываем это явно, а не режем молча.
      max_tokens: 32000,
      output_config: { format: { type: 'json_schema', schema: LAB_SCHEMA } },
      system: [{ type: 'text', text: LAB_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [
        {
          role: 'user',
          content: pdfText
            // Текст из PDF: модели не нужно «смотреть» страницы.
            ? [{ type: 'text' as const, text: `Текст бланка анализов:\n\n${pdfText}\n\nИзвлеки все показатели из этого результата анализа.` }]
            : [
                decoded.kind === 'pdf'
                  ? { type: 'document' as const, source: { type: 'base64' as const, media_type: PDF_MIME as 'application/pdf', data: decoded.data } }
                  : { type: 'image' as const, source: { type: 'base64' as const, media_type: decoded.mime, data: decoded.data } },
                { type: 'text' as const, text: 'Извлеки все показатели из этого результата анализа.' },
              ],
        },
      ],
    });

    if (response.stop_reason === 'refusal') {
      await trackError({ route: '/api/labs/analyze', method: 'POST', error: 'Model refused image', userId: session.user.id });
      return NextResponse.json({ error: 'The image could not be analyzed.' }, { status: 422 });
    }

    if (response.stop_reason === 'max_tokens') {
      return NextResponse.json(
        { error: 'В бланке слишком много показателей для одного разбора. Загрузи страницы по отдельности.' },
        { status: 422 }
      );
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
    console.log(`[MONITOR] /api/labs/analyze OK ${duration}ms user=${session.user.id} markers=${markers.length} src=${pdfText ? 'pdf-text' : decoded.kind}`);

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
