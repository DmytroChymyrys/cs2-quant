import { and, eq, isNull, ne } from 'drizzle-orm';
import { database } from './index';
import { assets, observations, runs } from './schema';
export type Run = typeof runs.$inferInsert;
export type Observation = typeof observations.$inferInsert;
export type CollectorStore = ReturnType<typeof collectorStore>;
export function collectorStore(db = database()) {
  return {
    async claim(run: Run) {
      const inserted = await db.insert(runs).values(run).onConflictDoNothing({ target: runs.claimKey }).returning({ id: runs.id });
      return inserted.length === 1;
    },
    async audit(run: Run) { await db.insert(runs).values(run); },
    async read(id: string) { return (await db.select().from(runs).where(eq(runs.id, id)).limit(1))[0] as Run | undefined; },
    async tracked() { return db.select({ id: assets.id, marketHashName: assets.marketHashName }).from(assets).where(eq(assets.isTracked, true)); },
    async completeTiming(id: string, timing: { finishedAt: Date; durationMs: number }) {
      // Stamp only after the observation/status transaction has been acknowledged.
      // A retry must never move an already recorded completion time.
      await db.update(runs).set(timing).where(and(eq(runs.id, id), ne(runs.status, 'RUNNING'), isNull(runs.finishedAt)));
    },
    async finish(id: string, values: Partial<Run>, rows: Observation[]) {
      const update = db.update(runs).set(values).where(and(eq(runs.id, id), eq(runs.status, 'RUNNING')));
      // Neon HTTP batch executes atomically. No transaction spans external requests.
      if (rows.length) await db.batch([db.insert(observations).values(rows), update]);
      else await update;
    },
  };
}
