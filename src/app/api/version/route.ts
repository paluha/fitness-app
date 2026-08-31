import { NextResponse } from 'next/server';

// Версия текущего деплоя. Клиент сверяет её со своей вшитой при сборке
// (NEXT_PUBLIC_BUILD_SHA) и перезагружает WebView, если вышла новая —
// iOS-приложение живёт в фоне днями и само страницу не перезагружает.
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    { sha: process.env.VERCEL_GIT_COMMIT_SHA || 'dev' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
