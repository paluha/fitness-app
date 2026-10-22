import crypto from 'crypto';
import { prisma } from '@/lib/prisma';

/**
 * Подключение кольца Oura: OAuth и выгрузка дневных показателей.
 *
 * Ключи приложения заводятся на cloud.ouraring.com/oauth/applications и
 * кладутся в OURA_CLIENT_ID / OURA_CLIENT_SECRET. Пока их нет, раздел
 * подключения просто не показывается.
 */
export const OURA_AUTH_URL = 'https://cloud.ouraring.com/oauth/authorize';
export const OURA_TOKEN_URL = 'https://api.ouraring.com/oauth/token';
export const OURA_API = 'https://api.ouraring.com/v2/usercollection';

/** Что запрашиваем: сон, готовность, активность и пульс. */
export const OURA_SCOPES = 'daily heartrate personal';

export const ouraConfigured = () =>
  !!process.env.OURA_CLIENT_ID && !!process.env.OURA_CLIENT_SECRET;

/** Адрес возврата. Должен совпадать с указанным в настройках приложения Oura. */
export const ouraRedirectUri = () => {
  const base = process.env.NEXTAUTH_URL || 'https://trainx.club';
  return `${base.replace(/\/$/, '')}/api/oura/callback`;
};

/**
 * Подписанный state для OAuth: защищает от подделки возврата.
 *
 * Просто id пользователя сюда класть нельзя — его видно в адресной
 * строке и можно подставить чужой, привязав кольцо не к тому аккаунту.
 */
export function ouraState(userId: string): string {
  const payload = `${userId}.${Date.now()}`;
  const sig = crypto
    .createHmac('sha256', process.env.NEXTAUTH_SECRET || 'dev')
    .update(payload)
    .digest('hex')
    .slice(0, 32);
  return `${payload}.${sig}`;
}

/** Проверить подпись и срок (10 минут). Возвращает id или null. */
export function ouraStateUser(state: string): string | null {
  const parts = (state || '').split('.');
  if (parts.length !== 3) return null;
  const [userId, ts, sig] = parts;
  const expected = crypto
    .createHmac('sha256', process.env.NEXTAUTH_SECRET || 'dev')
    .update(`${userId}.${ts}`)
    .digest('hex')
    .slice(0, 32);
  if (sig !== expected) return null;
  if (Date.now() - Number(ts) > 600_000) return null;
  return userId;
}

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
};

/** Обменять код авторизации или refresh-токен на свежую пару токенов. */
export async function ouraToken(params: Record<string, string>): Promise<TokenResponse | null> {
  const body = new URLSearchParams({
    client_id: process.env.OURA_CLIENT_ID || '',
    client_secret: process.env.OURA_CLIENT_SECRET || '',
    ...params,
  });
  const r = await fetch(OURA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!r.ok) return null;
  return (await r.json()) as TokenResponse;
}

/**
 * Действующий токен пользователя. Протухший обновляем заранее — за
 * минуту до истечения, чтобы не ловить 401 посреди выгрузки.
 */
export async function ouraAccessToken(userId: string): Promise<string | null> {
  const conn = await prisma.ouraConnection.findUnique({ where: { userId } });
  if (!conn) return null;

  if (conn.expiresAt.getTime() - Date.now() > 60_000) return conn.accessToken;

  const fresh = await ouraToken({
    grant_type: 'refresh_token',
    refresh_token: conn.refreshToken,
  });
  if (!fresh) return null;

  await prisma.ouraConnection.update({
    where: { userId },
    data: {
      accessToken: fresh.access_token,
      refreshToken: fresh.refresh_token || conn.refreshToken,
      expiresAt: new Date(Date.now() + (fresh.expires_in || 86400) * 1000),
    },
  });
  return fresh.access_token;
}

/** Запрос к Oura за период. Пустой ответ при ошибке — выгрузка не падает целиком. */
async function ouraGet(token: string, path: string, start: string, end: string) {
  const url = `${OURA_API}/${path}?start_date=${start}&end_date=${end}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return [] as Record<string, unknown>[];
  const j = await r.json().catch(() => null);
  return Array.isArray(j?.data) ? (j.data as Record<string, unknown>[]) : [];
}

const asInt = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);
const minutes = (sec: unknown) => (typeof sec === 'number' && Number.isFinite(sec) ? Math.round(sec / 60) : null);

/**
 * Выгрузить показатели за период и сложить в OuraDaily.
 *
 * Сон, готовность и активность приходят тремя разными запросами — у
 * каждого своя строка на день; сводим их по дате в одну запись.
 */
export async function ouraSync(userId: string, days = 30) {
  const token = await ouraAccessToken(userId);
  if (!token) return { ok: false as const, reason: 'not_connected' };

  const end = new Date();
  const start = new Date(end.getTime() - days * 86400_000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const [sleep, readiness, activity] = await Promise.all([
    ouraGet(token, 'daily_sleep', fmt(start), fmt(end)),
    ouraGet(token, 'daily_readiness', fmt(start), fmt(end)),
    ouraGet(token, 'daily_activity', fmt(start), fmt(end)),
  ]);
  // Подробности сна (фазы, пульс, ВСР) лежат в отдельной коллекции.
  const sleepDetail = await ouraGet(token, 'sleep', fmt(start), fmt(end));

  const byDate = new Map<string, Record<string, unknown>>();
  const put = (day: unknown, patch: Record<string, unknown>) => {
    if (typeof day !== 'string') return;
    byDate.set(day, { ...(byDate.get(day) || {}), ...patch });
  };

  for (const r of sleep) put(r.day, { sleepScore: asInt(r.score) });
  for (const r of readiness) {
    const c = (r.contributors || {}) as Record<string, unknown>;
    put(r.day, {
      readinessScore: asInt(r.score),
      bodyTempDelta: typeof r.temperature_deviation === 'number' ? r.temperature_deviation : null,
      restingHr: asInt(c.resting_heart_rate) === null ? null : asInt(c.resting_heart_rate),
    });
  }
  for (const r of activity) {
    put(r.day, {
      activityScore: asInt(r.score),
      steps: asInt(r.steps),
      activeCalories: asInt(r.active_calories),
    });
  }
  // Из подробностей сна берём длительности и физиологию — там они точнее.
  for (const r of sleepDetail) {
    if (r.type === 'deleted') continue;
    put(r.day, {
      totalSleepMin: minutes(r.total_sleep_duration),
      deepSleepMin: minutes(r.deep_sleep_duration),
      remSleepMin: minutes(r.rem_sleep_duration),
      sleepEfficiency: asInt(r.efficiency),
      bedtimeStart: typeof r.bedtime_start === 'string' ? new Date(r.bedtime_start) : null,
      restingHr: asInt(r.lowest_heart_rate),
      hrvMs: asInt(r.average_hrv),
    });
  }

  let saved = 0;
  for (const [date, data] of byDate) {
    // Пустые дни не пишем: Oura отдаёт их, пока кольцо не носили.
    if (Object.values(data).every(v => v === null || v === undefined)) continue;
    await prisma.ouraDaily.upsert({
      where: { userId_date: { userId, date } },
      create: { userId, date, ...data },
      update: data,
    });
    saved++;
  }

  await prisma.ouraConnection.update({
    where: { userId },
    data: { lastSyncAt: new Date() },
  }).catch(() => { /* связь могли отключить параллельно */ });

  return { ok: true as const, days: saved };
}
