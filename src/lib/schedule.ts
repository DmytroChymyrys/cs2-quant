import { WINDOW_MS } from './config';

// Count closed five-minute windows only: the current bucket may still be running.
export function scheduledInterval(now: Date, startedAt = process.env.COLLECTION_SCHEDULE_STARTED_AT) {
  if (!startedAt) return null;
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start) || start % WINDOW_MS !== 0) throw new Error('INVALID_SCHEDULE_START');
  const through = Math.floor(now.getTime() / WINDOW_MS) * WINDOW_MS;
  const from = Math.max(start, through - 86400000);
  return { startedAt: new Date(start).toISOString(), from: new Date(from).toISOString(),
    throughExclusive: new Date(through).toISOString(), expectedWindows: Math.max(0, (through - from) / WINDOW_MS) };
}
