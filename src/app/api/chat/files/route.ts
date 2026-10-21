import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * Файлы, присланные в чат.
 *
 * Список отдаём БЕЗ содержимого: data-URL весит сотни килобайт, и
 * тянуть их все ради списка незачем. Сам файл — отдельным запросом по id.
 */
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const url = new URL(request.url);
  const id = url.searchParams.get('id');

  if (id) {
    const file = await prisma.chatAttachment.findFirst({
      // userId в условии обязателен: иначе по чужому id можно было бы
      // вытащить файл другого пользователя.
      where: { id, userId: session.user.id },
      select: { name: true, mimeType: true, data: true },
    });
    if (!file) {
      return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
    }
    return new Response(JSON.stringify(file), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const files = await prisma.chatAttachment.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: { id: true, name: true, mimeType: true, size: true, createdAt: true },
  });
  return new Response(JSON.stringify({ files }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Удалить файл из хранилища чата. */
export async function DELETE(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return new Response(JSON.stringify({ error: 'no_id' }), { status: 400 });

  const r = await prisma.chatAttachment.deleteMany({
    where: { id, userId: session.user.id },
  });
  return new Response(JSON.stringify({ deleted: r.count }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
