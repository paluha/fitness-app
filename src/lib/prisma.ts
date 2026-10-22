import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Ограничиваем пул соединений на инстанс.
 *
 * По умолчанию Prisma берёт пул в (ядра × 2 + 1) на каждый процесс. На Vercel
 * процессов столько, сколько одновременных запросов: при наплыве каждый
 * открывает свой пул, и соединения к Postgres кончаются — приложение отдаёт
 * 500, хотя база живая. Railway даёт 500 соединений, поэтому 5 на инстанс
 * позволяет ~90 параллельных функций с запасом на миграции и psql.
 *
 * connect_timeout поднят: при холодном старте Railway отвечает не сразу,
 * и дефолтные 5 секунд иногда срезали первый запрос пользователя.
 */
function urlWithPool(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  try {
    const u = new URL(raw);
    if (!u.searchParams.has('connection_limit')) u.searchParams.set('connection_limit', '5');
    if (!u.searchParams.has('pool_timeout')) u.searchParams.set('pool_timeout', '15');
    if (!u.searchParams.has('connect_timeout')) u.searchParams.set('connect_timeout', '15');
    return u.toString();
  } catch {
    // Строка не парсится как URL — отдаём как есть, пусть Prisma сама ругается.
    return raw;
  }
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: { db: { url: urlWithPool(process.env.DATABASE_URL) } },
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
