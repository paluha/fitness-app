import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { OURA_AUTH_URL, OURA_SCOPES, ouraConfigured, ouraRedirectUri, ouraState } from '@/lib/oura';

/** Старт подключения: уводим пользователя на страницу согласия Oura. */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
  if (!ouraConfigured()) {
    return new Response(JSON.stringify({ error: 'not_configured' }), { status: 503 });
  }

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.OURA_CLIENT_ID || '',
    redirect_uri: ouraRedirectUri(),
    scope: OURA_SCOPES,
    // Защита от подделки запроса: на возврате сверяем id пользователя.
    state: ouraState(session.user.id),
  });
  return Response.redirect(`${OURA_AUTH_URL}?${params}`, 302);
}
