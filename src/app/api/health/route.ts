import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET() {
  const checks: Record<string, { status: string; latency?: number; error?: string }> = {};

  // 1. Database check
  const dbStart = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { status: 'ok', latency: Date.now() - dbStart };
  } catch (e) {
    checks.database = { status: 'error', latency: Date.now() - dbStart, error: e instanceof Error ? e.message : 'Unknown' };
  }

  // 2. Gemini AI check
  const aiStart = Date.now();
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    checks.gemini = { status: 'error', error: 'API key not configured' };
  } else {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
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
        const err = await res.json();
        checks.gemini = { status: 'error', latency: Date.now() - aiStart, error: err?.error?.message || `HTTP ${res.status}` };
      }
    } catch (e) {
      checks.gemini = { status: 'error', latency: Date.now() - aiStart, error: e instanceof Error ? e.message : 'Unknown' };
    }
  }

  // 3. Email alerts check
  checks.alerts = {
    status: process.env.RESEND_API_KEY && process.env.ALERT_EMAIL ? 'ok' : 'not configured',
  };

  const allOk = Object.values(checks).every(c => c.status === 'ok');

  return NextResponse.json({
    status: allOk ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    checks,
  }, { status: allOk ? 200 : 503 });
}
