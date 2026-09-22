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

    const body = await request.json();
    const image: string | undefined = typeof body.image === 'string' ? body.image : undefined;
    // Клиент умеет сам достать текст из PDF и прислать только его: тогда
    // тяжёлый файл не идёт по сети и не упирается в лимит запроса.
    const clientText: string | undefined = typeof body.pdfText === 'string' ? body.pdfText : undefined;

    if (!image && !clientText) {
      return NextResponse.json({ error: 'No image provided' }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Anthropic API key not configured' }, { status: 500 });
    }

    // Текст пришёл готовым — файл разбирать не нужно.
    let decoded: Decoded | null = null;
    let pdfText: string | null = null;

    if (clientText) {
      const clean = clientText.replace(/\u0000/g, '').trim();
      if (clean.length < 20) {
        return NextResponse.json(
          { error: 'В присланном тексте бланка почти ничего нет. Попробуй загрузить файл ещё раз.' },
          { status: 400 },
        );
      }
      pdfText = clean.slice(0, 200_000);
    } else {
      decoded = detectSource(image as string);
      if (!decoded) {
        return NextResponse.json(
          { error: 'Поддерживаются PDF и фото JPEG, PNG, GIF или WebP.' },
          { status: 400 }
        );
      }

      // Запасной путь для старых клиентов: PDF пришёл файлом, текст
      // достаём здесь. Это всё равно на порядки быстрее зрения.
      if (decoded.kind === 'pdf') {
        try {
          const { extractText, getDocumentProxy } = await import('unpdf');
          const bytes = new Uint8Array(Buffer.from(decoded.data, 'base64'));
          const doc = await getDocumentProxy(bytes);
          const { text } = await extractText(doc, { mergePages: true });
          const clean = String(text || '').replace(/\u0000/g, '').trim();
          // Короткий результат — признак скана: текста нет, только картинка.
          if (clean.length >= 200) pdfText = clean.slice(0, 200_000);
        } catch (e) {
          console.warn('[labs] не удалось извлечь текст из PDF, читаем зрением:', e instanceof Error ? e.message : e);
        }
      }
    }

    const client = new Anthropic({ apiKey });

    /**
     * Один запрос к модели. Стрим обязателен: при большом max_tokens SDK
     * отказывается делать обычный запрос и падает ещё до обращения к модели.
     */
    const askModel = async (content: Anthropic.MessageParam['content']) => {
      const stream = client.messages.stream({
        model: 'claude-haiku-4-5',
        // Потолок на ОДИН запрос. Замеры на проде: ~280 токенов/с, то есть
        // за 30 секунд платформы успевает около 8000 токенов ≈ 100
        // показателей. Большой бланк ниже режется на части, поэтому в один
        // запрос столько и не попадает.
        max_tokens: 8000,
        output_config: { format: { type: 'json_schema', schema: LAB_SCHEMA } },
        system: [{ type: 'text', text: LAB_SYSTEM, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content }],
      });
      return stream.finalMessage();
    };

    type Parsed = { panelName?: string; lab?: string; collectedAt?: string; markers?: unknown[] };
    const readJson = (r: Anthropic.Message): Parsed | null => {
      const block = r.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
      if (!block) return null;
      try { return JSON.parse(block.text) as Parsed; } catch { return null; }
    };

    /**
     * Длинный бланк режем на части по строкам и разбираем их параллельно.
     *
     * Раньше такой бланк не укладывался в 30 секунд платформы, и
     * пользователю предлагали «загрузить страницы по отдельности» — то есть
     * делать руками то, что должно делаться само. Части идут одновременно,
     * поэтому общее время примерно равно самой долгой из них.
     *
     * Шапку (название, лаборатория, дата) повторяем в каждой части: без неё
     * модель не увидит контекст, а строки показателей ничего о бланке не
     * говорят.
     */
    // 3000 символов — это максимум ~84 строки показателей, что заведомо
    // укладывается в 8000 токенов ответа. При 5000 в часть попадало до 139
    // показателей, и ответ обрывался на середине.
    const CHUNK_CHARS = 3000;
    const splitText = (text: string) => {
      if (text.length <= CHUNK_CHARS) return [text];
      const NL = String.fromCharCode(10);
      const all = text.split(NL);
      // Первые строки бланка — почти всегда шапка с датой и лабораторией.
      const head = all.slice(0, 8).join(NL);

      // Части делаем РАВНЫМИ, а не «по CHUNK_CHARS подряд».
      //
      // При нарезке подряд почти весь бланк попадал в первую часть, а во
      // вторую — хвост в пару строк. Части идут параллельно, поэтому общее
      // время равно самой долгой: перекос сводил всю выгоду на нет
      // (82 показателя — 23 секунды при лимите 30).
      const count = Math.ceil(text.length / CHUNK_CHARS);
      const perPart = Math.ceil(all.length / count);
      const parts: string[] = [];
      for (let i = 0; i < all.length; i += perPart) {
        parts.push(all.slice(i, i + perPart).join(NL));
      }
      // Со второй части добавляем шапку, чтобы дата и лаборатория читались.
      return parts.map((p, i) => i === 0 ? p : `${head}${NL}${NL}${p}`);
    };

    let parsed: Parsed | null = null;
    let chunks = 1;

    if (pdfText && pdfText.length > CHUNK_CHARS) {
      const parts = splitText(pdfText);
      chunks = parts.length;
      const results = await Promise.all(parts.map((part, i) => askModel([{
        type: 'text' as const,
        text: `Текст бланка анализов (часть ${i + 1} из ${parts.length}):\n\n${part}\n\nИзвлеки все показатели из этой части.`,
      }])));
      // Отказ или обрыв хотя бы в одной части — честно сообщаем, а не
      // отдаём половину бланка как полный результат.
      const refused = results.find(r => r.stop_reason === 'refusal');
      if (refused) {
        await trackError({ route: '/api/labs/analyze', method: 'POST', error: 'Model refused image', userId: session.user.id });
        return NextResponse.json({ error: 'The image could not be analyzed.' }, { status: 422 });
      }
      if (results.some(r => r.stop_reason === 'max_tokens')) {
        return NextResponse.json(
          { error: 'В бланке слишком много показателей для одного разбора. Загрузи страницы по отдельности.' },
          { status: 422 },
        );
      }
      const pieces = results.map(readJson).filter((x): x is Parsed => !!x);
      if (!pieces.length) {
        return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 });
      }
      // Один и тот же показатель мог попасть в стык двух частей.
      const seen = new Set<string>();
      const merged: unknown[] = [];
      for (const piece of pieces) {
        for (const m of (piece.markers || [])) {
          const mm = m as { key?: string; name?: string; unit?: string; value?: number };
          const id = `${mm.key || mm.name}|${mm.unit}|${mm.value}`;
          if (seen.has(id)) continue;
          seen.add(id);
          merged.push(m);
        }
      }
      // Шапку берём из первой части, где она заведомо есть.
      parsed = {
        panelName: pieces.find(p => p.panelName)?.panelName || '',
        lab: pieces.find(p => p.lab)?.lab || '',
        collectedAt: pieces.find(p => p.collectedAt)?.collectedAt || '',
        markers: merged,
      };
    } else {
      const response = await askModel(pdfText
        // Текст из PDF: модели не нужно «смотреть» страницы.
        ? [{ type: 'text' as const, text: `Текст бланка анализов:\n\n${pdfText}\n\nИзвлеки все показатели из этого результата анализа.` }]
        : [
            decoded && decoded.kind === 'pdf'
              ? { type: 'document' as const, source: { type: 'base64' as const, media_type: PDF_MIME as 'application/pdf', data: decoded.data } }
              : { type: 'image' as const, source: { type: 'base64' as const, media_type: (decoded as Extract<Decoded, { kind: 'image' }>).mime, data: (decoded as Decoded).data } },
            { type: 'text' as const, text: 'Извлеки все показатели из этого результата анализа.' },
          ]);

      if (response.stop_reason === 'refusal') {
        await trackError({ route: '/api/labs/analyze', method: 'POST', error: 'Model refused image', userId: session.user.id });
        return NextResponse.json({ error: 'The image could not be analyzed.' }, { status: 422 });
      }
      if (response.stop_reason === 'max_tokens') {
        return NextResponse.json(
          { error: 'В бланке слишком много показателей для одного разбора. Загрузи страницы по отдельности.' },
          { status: 422 },
        );
      }
      parsed = readJson(response);
      if (!parsed) {
        return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 });
      }
    }

    const markers = Array.isArray(parsed.markers) ? parsed.markers : [];
    if (markers.length === 0) {
      return NextResponse.json(
        { error: 'Не удалось распознать показатели. Загрузите более чёткое фото результата.' },
        { status: 422 }
      );
    }

    const duration = await trackLatency('/api/labs/analyze', startTime);
    console.log(`[MONITOR] /api/labs/analyze OK ${duration}ms user=${session.user.id} markers=${markers.length} src=${clientText ? 'client-text' : pdfText ? 'pdf-text' : decoded?.kind} chunks=${chunks}`);

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
