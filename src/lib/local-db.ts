import Dexie, { Table } from 'dexie';

// Offline-first local database. Everything lives here FIRST — server is a
// mirror. When offline, edits queue up in `pendingOps` and flush when back
// online. When online, edits still go into the local tables immediately so
// the UI never blocks on the network, then a separate sync loop pushes.

export interface LocalWorkoutLog {
  // Composite key: `${date}::${exerciseId}` — Dexie doesn't do compound primary
  // keys cleanly, so we stitch our own.
  id: string;
  date: string;           // YYYY-MM-DD
  exerciseId: string;
  workoutId: string | null;
  completed: boolean;
  actualSets: unknown[] | null;
  notes: string | null;
  clientUpdatedAt: string; // ISO
  serverUpdatedAt?: string; // ISO — filled when the row arrives from server
  deletedAt?: string | null;
}

export interface LocalDayLog {
  id: string;            // `${date}::${kind}`
  date: string;
  kind: string;          // 'meals' | 'steps' | 'mood' | 'notes' | 'dayClosed' | ...
  payload: unknown;
  clientUpdatedAt: string;
  serverUpdatedAt?: string;
  deletedAt?: string | null;
}

// A pending write that hasn't made it to the server yet. Either because the
// network was down, or the request failed, or we just haven't flushed yet.
// Kept forever (no TTL) so we never drop user data.
export interface PendingOp {
  id?: number;                       // auto-increment
  endpoint: 'workout-log' | 'day-log';
  payload: Record<string, unknown>;  // shape matches the endpoint's PATCH body item
  createdAt: string;                 // ISO
  attempts: number;
  lastAttemptAt?: string;
  lastError?: string;
}

// Small key/value store for sync state — last sync timestamp, clientId, etc.
export interface MetaRow {
  key: string;
  value: unknown;
}

class LocalDB extends Dexie {
  workoutLogs!: Table<LocalWorkoutLog, string>;
  dayLogs!: Table<LocalDayLog, string>;
  pendingOps!: Table<PendingOp, number>;
  meta!: Table<MetaRow, string>;

  constructor() {
    super('fitness_local_v1');
    this.version(1).stores({
      workoutLogs: 'id, date, [date+exerciseId], serverUpdatedAt',
      dayLogs: 'id, date, kind, [date+kind], serverUpdatedAt',
      pendingOps: '++id, endpoint, createdAt',
      meta: 'key',
    });
  }
}

// Singleton — in Next.js SSR this file must only load on the client.
// We guard by checking for `window`. During SSR the db object is null and
// any caller that tries to use it will hit an explicit error instead of
// silently failing.
let dbInstance: LocalDB | null = null;

export function getLocalDB(): LocalDB {
  if (typeof window === 'undefined') {
    throw new Error('LocalDB is client-side only');
  }
  if (!dbInstance) dbInstance = new LocalDB();
  return dbInstance;
}

// Stable device ID so the server can tell writes apart. Persisted in the
// meta table on first read.
export async function getClientId(): Promise<string> {
  const db = getLocalDB();
  const row = await db.meta.get('clientId');
  if (row && typeof row.value === 'string') return row.value as string;
  const id = 'c_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now().toString(36);
  await db.meta.put({ key: 'clientId', value: id });
  return id;
}

// Last time we pulled diff from the server. Separate per endpoint so one
// failing doesn't block the other.
export async function getLastSyncTs(key: 'workout-log' | 'day-log'): Promise<string | null> {
  const db = getLocalDB();
  const row = await db.meta.get('lastSync:' + key);
  return (row?.value as string) ?? null;
}

export async function setLastSyncTs(key: 'workout-log' | 'day-log', iso: string): Promise<void> {
  const db = getLocalDB();
  await db.meta.put({ key: 'lastSync:' + key, value: iso });
}
