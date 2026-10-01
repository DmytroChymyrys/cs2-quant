import "server-only";

/**
 * TEMPORARY production instrumentation for `readMarketDataset`.
 *
 * Added to find where ~1.1-2.2s per market page is spent. It measures only;
 * it changes no query, no contract and no result. Delete this file, the
 * `stages` calls in `server.ts`, and `app/api/internal/perf/route.ts` to
 * remove the instrumentation completely.
 *
 * Timings go to the log as one structured line per dataset read — which is
 * once per request, since `readMarketDataset` is React-cached — so the real
 * /screener, /terminal, /cs2-skins and /asset traffic is measured rather than
 * a synthetic approximation of it.
 */

export type Stage = {
  name: string;
  ms: number;
  rows?: number;
  bytes?: number;
};

export type StageRecorder = {
  /** Times `work`, records it under `name`, and returns its result. */
  step<T>(name: string, work: () => Promise<T>): Promise<T>;
  /** Records a stage that was timed by hand. */
  mark(name: string, ms: number, extra?: { rows?: number; bytes?: number }): void;
  /** Attaches row/byte counts to an already-recorded stage. */
  size(name: string, extra: { rows?: number; bytes?: number }): void;
  stages(): Stage[];
  totalMs(): number;
  /** One structured line, and the breakdown for a caller that wants it. */
  report(event: string, extra?: Record<string, unknown>): Stage[];
};

export function recorder(): StageRecorder {
  const started = performance.now();
  const stages: Stage[] = [];
  const find = (name: string) => stages.find((s) => s.name === name);
  return {
    async step(name, work) {
      const at = performance.now();
      try {
        return await work();
      } finally {
        // Recorded even when the stage throws: a slow failure is a finding.
        stages.push({ name, ms: round(performance.now() - at) });
      }
    },
    mark(name, ms, extra) {
      stages.push({ name, ms: round(ms), ...extra });
    },
    size(name, extra) {
      const stage = find(name);
      if (stage) Object.assign(stage, extra);
    },
    stages: () => stages,
    totalMs: () => round(performance.now() - started),
    report(event, extra) {
      const total = round(performance.now() - started);
      // Nothing here names a database, a host or a credential: stage names,
      // durations and counts only.
      console.log(
        JSON.stringify({
          event,
          totalMs: total,
          // Work not attributable to a measured stage.
          unmeasuredMs: round(total - stages.reduce((n, s) => n + s.ms, 0)),
          stages,
          ...extra,
        }),
      );
      return stages;
    },
  };
}

const round = (ms: number) => Math.round(ms * 10) / 10;

/** A Server-Timing header value, for a route that can set one. */
export function serverTiming(stages: Stage[], totalMs: number): string {
  return [
    `total;dur=${totalMs}`,
    ...stages.map((s) => `${s.name.replace(/[^a-zA-Z0-9_]/g, "_")};dur=${s.ms}`),
  ].join(", ");
}

/**
 * Byte size of a result, measured separately so the measurement does not
 * land inside the stage it is describing.
 */
export function measureBytes(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return -1;
  }
}
