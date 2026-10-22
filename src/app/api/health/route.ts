import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// Проверка живости сервиса.
//
// Публично отдаём только статус («healthy»/«degraded») — без текстов ошибок
// и без замеров задержки. Сообщения Prisma содержат адрес базы, имена
// таблиц и колонок, а ответы Google — идентификаторы проекта и квот;
// для внешнего наблюдателя это подсказка, куда давить.
//
// Подробности видит только тот, кто знает HEALTH_SECRET: заголовок
// `Authorization: Bearer <секрет>` или `?key=<секрет>` для внешних
// мониторингов, которые не умеют ставить заголовки.
//
// Проверка Gemini стоит реального вызова модели, поэтому она только в
// подробном режиме: иначе роут в цикле жёг бы квоту бесплатно для атакующего.
export async function GET(request: Request) {
  const secret = process.env.HEALTH_SECRET;
  const auth = request.headers.get('authorization');
  const key = new URL(request.url).searchParams.get('key');
  const detailed = !!secret && (auth === `Bearer ${secret}` || key === secret);

  const checks: Record<string, { status: string; latency?: number; error?: string }> = {};

  // 1. Database check
  const dbStart = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { status: 'ok', ...(detailed ? { latency: Date.now() - dbStart } : {}) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown';
    console.error('[health] database:', msg);
    checks.database = {
      status: 'error',
      ...(detailed ? { latency: Date.now() - dbStart, error: msg } : {}),
    };
  }

  // 2. Gemini AI check — только в подробном режиме (стоит вызова модели)
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!detailed) {
    checks.gemini = { status: apiKey ? 'skipped' : 'not configured' };
  } else if (!apiKey) {
    checks.gemini = { status: 'error', error: 'API key not configured' };
  } else {
    const aiStart = Date.now();
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'Reply with just "ok"' }] }],
            generationConfig: { maxOutputTokens: 5 }
          })
        }
      );
      if (res.ok) {
        checks.gemini = { status: 'ok', latency: Date.now() - aiStart };
      } else {
        const err = await res.json().catch(() => null);
        checks.gemini = {
          status: 'error',
          latency: Date.now() - aiStart,
          error: err?.error?.message || `HTTP ${res.status}`,
        };
      }
    } catch (e) {
      checks.gemini = {
        status: 'error',
        latency: Date.now() - aiStart,
        error: e instanceof Error ? e.message : 'Unknown',
      };
    }
  }

  // 3. Email alerts check
  checks.alerts = {
    status: process.env.RESEND_API_KEY && process.env.ALERT_EMAIL ? 'ok' : 'not configured',
  };

  // «skipped» и «not configured» не считаем падением: это не сбой сервиса.
  const allOk = Object.values(checks).every(c => c.status !== 'error');

  return NextResponse.json({
    status: allOk ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    checks,
  }, { status: allOk ? 200 : 503 });
}
