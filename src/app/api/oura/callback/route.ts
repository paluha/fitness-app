import { prisma } from '@/lib/prisma';
import { ouraStateUser, ouraToken, ouraRedirectUri, ouraSync } from '@/lib/oura';

/**
 * Возврат из Oura после согласия пользователя.
 *
 * Сессии здесь может не быть (переход пришёл со стороннего домена),
 * поэтому владельца берём из подписанного state, а не из cookie.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state') || '';
  const error = url.searchParams.get('error');

  const back = (status: string) =>
    Response.redirect(`${(process.env.NEXTAUTH_URL || 'https://trainx.club').replace(/\/$/, '')}/?oura=${status}`, 302);

  if (error) return back('denied');
  if (!code) return back('error');

  const userId = ouraStateUser(state);
  if (!userId) return back('error');

  const token = await ouraToken({
    grant_type: 'authorization_code',
    code,
    redirect_uri: ouraRedirectUri(),
  });
  if (!token?.access_token) return back('error');

  await prisma.ouraConnection.upsert({
    where: { userId },
    create: {
      userId,
      accessToken: token.access_token,
      refreshToken: token.refresh_token || '',
      expiresAt: new Date(Date.now() + (token.expires_in || 86400) * 1000),
      scope: token.scope || null,
    },
    update: {
      accessToken: token.access_token,
      refreshToken: token.refresh_token || '',
      expiresAt: new Date(Date.now() + (token.expires_in || 86400) * 1000),
      scope: token.scope || null,
    },
  });

  // Сразу тянем историю, чтобы данные были видны без лишнего действия.
  // Ошибка выгрузки не должна рушить подключение — его уже сохранили.
  await ouraSync(userId, 60).catch(() => null);

  return back('connected');
}
