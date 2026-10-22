import { prisma } from '@/lib/prisma';

// Лимиты на платные ИИ-роуты.
//
// Зачем: каждый вызов ИИ стоит денег, и счёт приходит владельцу приложения,
// а не пользователю. Один кривой клиент в цикле (или просто забытая вкладка
// с ретраями) способен сжечь месячный бюджет за час. Лимит ограничивает
// ущерб, не мешая живому человеку: нормальный пользователь в эти границы
// не упирается.
//
// Счётчик в БД, а не в памяти: на Vercel соседние запросы уходят в разные
// инстансы функции, и переменная модуля там не общая — лимит бы просто
// не работал.

export type RouteLimit = {
  /** Сколько вызовов разрешено в минуту (защита от циклов). */
  perMinute: number;
  /** Сколько в сутки (защита бюджета). */
  perDay: number;
};

/**
 * Границы подобраны по живому использованию: активный пользователь делает
 * ~150 сообщений в чат и ~90 фото еды в месяц, то есть 5 и 3 в день.
 * Суточный лимит выше реального потребления в несколько раз — человек его
 * не заметит, а цикл остановится.
 */
export const AI_LIMITS: Record<string, RouteLimit> = {
  // Диалог: пишут сериями, поэтому минутный лимит щедрый.
  'chat': { perMinute: 12, perDay: 120 },
  // Фото еды: 4 приёма пищи в день, с пересъёмками — 30 с запасом.
  'food-analyze': { perMinute: 6, perDay: 30 },
  // Самое дорогое (Opus, ~6000 токенов выхода). Программу меняют раз в месяц.
  'program': { perMinute: 2, perDay: 8 },
  'food-plan': { perMinute: 2, perDay: 8 },
  // Анализы: загрузка PDF, пачкой раз в несколько месяцев.
  'labs-analyze': { perMinute: 3, perDay: 15 },
  'food-recommend': { perMinute: 6, perDay: 40 },
  'food-recipe': { perMinute: 5, perDay: 25 },
  'food-survey': { perMinute: 10, perDay: 60 },
  'planner': { perMinute: 4, perDay: 20 },
  'muscle-groups': { perMinute: 10, perDay: 50 },
};

export type RateVerdict =
  | { ok: true }
  | { ok: false; retryAfterSec: number; scope: 'min' | 'day'; limit: number };

/** Начало текущего окна: минута или сутки (UTC). */
function windowStart(kind: 'min' | 'day', now: Date): Date {
  const d = new Date(now);
  d.setUTCSeconds(0, 0);
  if (kind === 'day') {
    d.setUTCHours(0, 0, 0, 0);
  }
  return d;
}

/**
 * Проверить и сразу учесть обращение.
 *
 * Инкремент атомарный (upsert + increment), поэтому параллельные запросы
 * одного пользователя не «проскакивают» мимо лимита.
 *
 * Если БД недоступна — пропускаем запрос. Лимитер защищает от перерасхода,
 * но не должен ронять работающее приложение: отказать живому пользователю
 * из-за сбоя счётчика хуже, чем пропустить лишний вызов.
 */
export async function rateLimit(userId: string, route: string): Promise<RateVerdict> {
  const limits = AI_LIMITS[route];
  if (!limits) return { ok: true };

  const now = new Date();

  try {
    for (const kind of ['min', 'day'] as const) {
      const start = windowStart(kind, now);
      const cap = kind === 'min' ? limits.perMinute : limits.perDay;

      const row = await prisma.aiUsage.upsert({
        where: { userId_route_windowKind_windowStart: { userId, route, windowKind: kind, windowStart: start } },
        update: { count: { increment: 1 } },
        create: { userId, route, windowKind: kind, windowStart: start, count: 1 },
        select: { count: true },
      });

      if (row.count > cap) {
        const retryAfterSec = kind === 'min'
          ? 60 - now.getUTCSeconds()
          : Math.ceil((start.getTime() + 86_400_000 - now.getTime()) / 1000);
        return { ok: false, retryAfterSec, scope: kind, limit: cap };
      }
    }
  } catch (e) {
    console.error('rateLimit failed open:', e);
    return { ok: true };
  }

  // Подчищаем мусор: окна старше двух суток уже никому не нужны.
  // Раз в ~100 запросов, чтобы не ходить в БД лишний раз.
  if (Math.random() < 0.01) {
    prisma.aiUsage
      .deleteMany({ where: { windowStart: { lt: new Date(now.getTime() - 2 * 86_400_000) } } })
      .catch(() => { /* не критично */ });
  }

  return { ok: true };
}

/** Готовый ответ 429 с человекочитаемым текстом. */
export function rateLimitResponse(v: Extract<RateVerdict, { ok: false }>): Response {
  const msg = v.scope === 'min'
    ? `Слишком много запросов подряд. Подождите ${v.retryAfterSec} сек.`
    : `Исчерпан дневной лимит (${v.limit}). Попробуйте завтра.`;
  return new Response(JSON.stringify({ error: msg, rateLimited: true, scope: v.scope }), {
    status: 429,
    headers: { 'Content-Type': 'application/json', 'Retry-After': String(v.retryAfterSec) },
  });
}
