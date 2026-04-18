/* eslint-disable @typescript-eslint/no-explicit-any */
import { getLocalDB, getClientId, getLastSyncTs, setLastSyncTs, type LocalWorkoutLog, type LocalDayLog, type PendingOp } from './local-db';

// ---------- Writes: local first, then queue a pending op ----------
//
// These helpers are what components call instead of fetch()-ing directly.
// They update Dexie immediately so the UI reflects the change on the next
// render, then push an op into the outbox. If online, the flush loop will
// pick it up within ~1s. If offline, it sits in the queue until online.

export async function upsertWorkoutLog(input: {
  date: string;
  exerciseId: string;
  workoutId?: string | null;
  completed?: boolean;
  actualSets?: unknown[] | null;
  notes?: string | null;
}): Promise<void> {
  const db = getLocalDB();
  const clientId = await getClientId();
  const id = `${input.date}::${input.exerciseId}`;
  const now = new Date().toISOString();

  const existing = await db.workoutLogs.get(id);
  const merged: LocalWorkoutLog = {
    id,
    date: input.date,
    exerciseId: input.exerciseId,
    workoutId: input.workoutId ?? existing?.workoutId ?? null,
    completed: input.completed ?? existing?.completed ?? false,
    actualSets: input.actualSets !== undefined ? input.actualSets : existing?.actualSets ?? null,
    notes: input.notes !== undefined ? input.notes : existing?.notes ?? null,
    clientUpdatedAt: now,
    serverUpdatedAt: existing?.serverUpdatedAt,
  };
  await db.workoutLogs.put(merged);

  await db.pendingOps.add({
    endpoint: 'workout-log',
    payload: {
      date: merged.date,
      exerciseId: merged.exerciseId,
      workoutId: merged.workoutId,
      completed: merged.completed,
      actualSets: merged.actualSets,
      notes: merged.notes,
      clientId,
      clientUpdatedAt: now,
    },
    createdAt: now,
    attempts: 0,
  });
  scheduleFlush();
}

export async function upsertDayLog(input: { date: string; kind: string; payload: unknown }): Promise<void> {
  const db = getLocalDB();
  const clientId = await getClientId();
  const id = `${input.date}::${input.kind}`;
  const now = new Date().toISOString();

  const merged: LocalDayLog = {
    id,
    date: input.date,
    kind: input.kind,
    payload: input.payload,
    clientUpdatedAt: now,
  };
  await db.dayLogs.put(merged);

  await db.pendingOps.add({
    endpoint: 'day-log',
    payload: {
      date: merged.date,
      kind: merged.kind,
      payload: merged.payload,
      clientId,
      clientUpdatedAt: now,
    },
    createdAt: now,
    attempts: 0,
  });
  scheduleFlush();
}

// ---------- Outbox flush loop ----------

let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushInFlight = false;

// Debounced: coalesce a burst of edits into a single flush cycle.
export function scheduleFlush(delayMs = 800): void {
  if (typeof window === 'undefined') return;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => { flushTimer = null; flushNow(); }, delayMs);
}

export async function flushNow(): Promise<{ sent: number; failed: number }> {
  if (typeof window === 'undefined') return { sent: 0, failed: 0 };
  if (flushInFlight) return { sent: 0, failed: 0 };
  if (!navigator.onLine) return { sent: 0, failed: 0 };
  flushInFlight = true;
  try {
    const db = getLocalDB();
    // Batch per endpoint for efficiency.
    const ops = await db.pendingOps.orderBy('createdAt').limit(200).toArray();
    if (ops.length === 0) return { sent: 0, failed: 0 };

    const byEndpoint: Record<string, PendingOp[]> = { 'workout-log': [], 'day-log': [] };
    for (const op of ops) byEndpoint[op.endpoint]?.push(op);

    let sent = 0;
    let failed = 0;

    for (const ep of Object.keys(byEndpoint) as Array<'workout-log' | 'day-log'>) {
      const group = byEndpoint[ep];
      if (group.length === 0) continue;
      try {
        const res = await fetch(`/api/fitness/${ep}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: group.map(o => o.payload) }),
          keepalive: true,
        });
        if (res.ok) {
          const ids = group.map(o => o.id!).filter(Boolean);
          await db.pendingOps.bulkDelete(ids);
          sent += group.length;
        } else {
          // Mark attempts so we have diagnostics if something is wedging the queue
          const text = await res.text().catch(() => '');
          for (const o of group) {
            await db.pendingOps.update(o.id!, {
              attempts: (o.attempts || 0) + 1,
              lastAttemptAt: new Date().toISOString(),
              lastError: `${res.status}: ${text.slice(0, 200)}`,
            });
          }
          failed += group.length;
        }
      } catch (e: any) {
        for (const o of group) {
          await db.pendingOps.update(o.id!, {
            attempts: (o.attempts || 0) + 1,
            lastAttemptAt: new Date().toISOString(),
            lastError: String(e?.message || e),
          });
        }
        failed += group.length;
      }
    }
    return { sent, failed };
  } finally {
    flushInFlight = false;
  }
}

// ---------- Pull diffs from server (polling) ----------
//
// Called by the background poller. For each endpoint, fetches only rows
// changed after our last-seen timestamp and merges them into Dexie. The
// key merge rule: an incoming row only overwrites the local copy if the
// server's clientUpdatedAt is newer than ours. Otherwise our unsynced
// edit stays put (it'll flush and win on the server next time).

export async function pullDiff(): Promise<{ workoutRows: number; dayRows: number }> {
  if (typeof window === 'undefined') return { workoutRows: 0, dayRows: 0 };
  if (!navigator.onLine) return { workoutRows: 0, dayRows: 0 };
  const db = getLocalDB();
  let workoutRows = 0;
  let dayRows = 0;

  // workout-log
  try {
    const since = await getLastSyncTs('workout-log');
    const url = '/api/fitness/workout-log' + (since ? `?since=${encodeURIComponent(since)}` : '');
    const res = await fetch(url);
    if (res.ok) {
      const { rows, serverTime } = await res.json() as { rows: Array<any>; serverTime: string };
      for (const r of rows) {
        const local = await db.workoutLogs.get(`${r.date}::${r.exerciseId}`);
        const localAt = local?.clientUpdatedAt ? new Date(local.clientUpdatedAt).getTime() : 0;
        const remoteAt = r.clientUpdatedAt ? new Date(r.clientUpdatedAt).getTime() : 0;
        if (local && localAt >= remoteAt) continue; // our local is newer
        await db.workoutLogs.put({
          id: `${r.date}::${r.exerciseId}`,
          date: r.date,
          exerciseId: r.exerciseId,
          workoutId: r.workoutId ?? null,
          completed: !!r.completed,
          actualSets: r.actualSets ?? null,
          notes: r.notes ?? null,
          clientUpdatedAt: r.clientUpdatedAt,
          serverUpdatedAt: r.serverUpdatedAt,
          deletedAt: r.deletedAt ?? null,
        });
        workoutRows++;
      }
      await setLastSyncTs('workout-log', serverTime);
    }
  } catch { /* offline or transient — try again next tick */ }

  // day-log
  try {
    const since = await getLastSyncTs('day-log');
    const url = '/api/fitness/day-log' + (since ? `?since=${encodeURIComponent(since)}` : '');
    const res = await fetch(url);
    if (res.ok) {
      const { rows, serverTime } = await res.json() as { rows: Array<any>; serverTime: string };
      for (const r of rows) {
        const local = await db.dayLogs.get(`${r.date}::${r.kind}`);
        const localAt = local?.clientUpdatedAt ? new Date(local.clientUpdatedAt).getTime() : 0;
        const remoteAt = r.clientUpdatedAt ? new Date(r.clientUpdatedAt).getTime() : 0;
        if (local && localAt >= remoteAt) continue;
        await db.dayLogs.put({
          id: `${r.date}::${r.kind}`,
          date: r.date,
          kind: r.kind,
          payload: r.payload,
          clientUpdatedAt: r.clientUpdatedAt,
          serverUpdatedAt: r.serverUpdatedAt,
          deletedAt: r.deletedAt ?? null,
        });
        dayRows++;
      }
      await setLastSyncTs('day-log', serverTime);
    }
  } catch { /* ignore */ }

  return { workoutRows, dayRows };
}

// ---------- Lifecycle helpers used by the UI layer ----------

let poller: ReturnType<typeof setInterval> | null = null;
let onlineListenerAttached = false;

export function startSyncLoop(pollMs = 5000): void {
  if (typeof window === 'undefined') return;
  if (!onlineListenerAttached) {
    window.addEventListener('online', () => { flushNow(); pullDiff(); });
    window.addEventListener('beforeunload', () => { flushNow(); });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') { flushNow(); pullDiff(); }
      else { flushNow(); }
    });
    onlineListenerAttached = true;
  }
  if (poller) return;
  // Initial kick
  flushNow(); pullDiff();
  poller = setInterval(() => { flushNow(); pullDiff(); }, pollMs);
}

export function stopSyncLoop(): void {
  if (poller) { clearInterval(poller); poller = null; }
}

// Snapshot helpers for the UI: how many ops still need to flush.
export async function getPendingOpsCount(): Promise<number> {
  if (typeof window === 'undefined') return 0;
  return getLocalDB().pendingOps.count();
}
