import { Resend } from 'resend';

// Rate limit: max 1 alert per error type per hour
const alertCooldowns = new Map<string, number>();
const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

interface ErrorContext {
  route: string;
  method: string;
  error: string;
  details?: string;
  userId?: string;
  duration?: number;
}

export async function trackError(ctx: ErrorContext) {
  const key = `${ctx.route}:${ctx.error}`;
  const now = Date.now();
  const lastAlert = alertCooldowns.get(key) || 0;

  // Always log
  console.error(`[MONITOR] ${ctx.route} ${ctx.method} ERROR: ${ctx.error}`, {
    details: ctx.details,
    userId: ctx.userId,
    duration: ctx.duration ? `${ctx.duration}ms` : undefined,
  });

  // Rate limit alerts
  if (now - lastAlert < COOLDOWN_MS) return;
  alertCooldowns.set(key, now);

  // Send email alert
  const apiKey = process.env.RESEND_API_KEY;
  const alertEmail = process.env.ALERT_EMAIL;
  if (!apiKey || !alertEmail) return;

  try {
    const resend = new Resend(apiKey);
    await resend.emails.send({
      from: 'Trainx Alerts <onboarding@resend.dev>',
      to: alertEmail,
      subject: `[Trainx] ${ctx.route} — ${ctx.error}`,
      html: `
        <div style="font-family: system-ui, sans-serif; max-width: 500px;">
          <h2 style="color: #ff4d6a;">Trainx API Error</h2>
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tr><td style="padding: 6px 0; color: #888;">Route</td><td style="padding: 6px 0;"><strong>${ctx.route}</strong></td></tr>
            <tr><td style="padding: 6px 0; color: #888;">Method</td><td style="padding: 6px 0;">${ctx.method}</td></tr>
            <tr><td style="padding: 6px 0; color: #888;">Error</td><td style="padding: 6px 0; color: #ff4d6a;">${ctx.error}</td></tr>
            ${ctx.details ? `<tr><td style="padding: 6px 0; color: #888;">Details</td><td style="padding: 6px 0; font-size: 12px;">${ctx.details.slice(0, 500)}</td></tr>` : ''}
            ${ctx.duration ? `<tr><td style="padding: 6px 0; color: #888;">Duration</td><td style="padding: 6px 0;">${ctx.duration}ms</td></tr>` : ''}
            ${ctx.userId ? `<tr><td style="padding: 6px 0; color: #888;">User</td><td style="padding: 6px 0;">${ctx.userId}</td></tr>` : ''}
            <tr><td style="padding: 6px 0; color: #888;">Time</td><td style="padding: 6px 0;">${new Date().toISOString()}</td></tr>
          </table>
          <p style="color: #888; font-size: 12px; margin-top: 16px;">Next alert for this error type in 1 hour.</p>
        </div>
      `,
    });
  } catch (e) {
    console.error('[MONITOR] Failed to send alert email:', e);
  }
}

export async function trackLatency(route: string, startTime: number) {
  const duration = Date.now() - startTime;
  if (duration > 15000) {
    console.warn(`[MONITOR] SLOW ${route}: ${duration}ms`);
  }
  return duration;
}
