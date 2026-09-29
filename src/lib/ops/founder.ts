import "server-only";
import { sql } from "drizzle-orm";
import { requireAdmin } from "./auth";
import { productDatabase } from "../product/db";
import { database } from "../db";
import { readMarketDataset } from "../product/intelligence/server";
import { WINDOW_MS } from "../config";

/**
 * Founder Operations overview.
 *
 * Every value here is read from a production source. Where no source exists,
 * the field is `null` and the page renders "Unavailable" — it is never
 * defaulted to zero, because "nobody did this" and "we do not measure this"
 * are different facts and a founder console that blurs them is worse than one
 * that admits the gap.
 *
 * ## What cannot be measured here, and why
 *
 * **Visitors, page views, most-inspected assets, screener query counts.**
 * These exist only in GA4, which this application writes to from the browser.
 * There is no Data API credential and no server-side analytics client, so the
 * server genuinely cannot read them. They are reported as unavailable rather
 * than approximated from something else.
 *
 * **No product event log exists.** Nothing persists "user viewed asset X".
 * Recent activity is therefore built from rows that do exist — registrations,
 * sessions, watchlist, holdings, alert rules — not from invented events.
 */

export type Stat = { value: number | null; note?: string };

/**
 * A timestamp as it actually arrives.
 *
 * The Neon HTTP driver serialises timestamps to strings, while node-postgres
 * returns Date objects. Typing these as Date compiled cleanly and then threw
 * at runtime on `.toISOString()`, so the type says what the value is.
 */
export type Timestamp = string | Date | null;

export type FounderOverview = {
  funnel: {
    visitors: Stat;
    signups: Stat;
    activated: Stat;
    returning: Stat;
    windowDays: number;
  };
  authMethods: { credential: number; google: number } | null;
  engagement: {
    watchlistEntries: Stat;
    watchlistUsers: Stat;
    alertRules: Stat;
    alertEvents24h: Stat;
    alertsDelivered24h: Stat;
    holdings: Stat;
    portfolioUsers: Stat;
    savedScreens: Stat;
    assetViews: Stat;
    screenerQueries: Stat;
  };
  provider: {
    cadenceMs: number;
    lastRunAt: Timestamp;
    assetsReceived: number | null;
    assetsMapped: number | null;
    assetsUnmapped: number | null;
    changed: number | null;
    unchanged: number | null;
    disappeared: number | null;
    reappeared: number | null;
    transformFailures: number | null;
    knownAssets: number | null;
    historyRows: number | null;
    historyBytes: number | null;
    runs24h: number | null;
    collectorVersion: string | null;
    normalizationVersion: string | null;
  } | null;
  intelligence: {
    trackedAssets: number | null;
    intelligenceReady: number | null;
    method: string | null;
    snapshotId: string | null;
    evidence: string | null;
    observedAt: string | null;
    computedAt: string | null;
    error: string | null;
  } | null;
  collector: {
    runs24h: number | null;
    failures24h: number | null;
    lastRunAt: Timestamp;
    lastStatus: string | null;
  } | null;
  activity: {
    at: Timestamp;
    kind: string;
    detail: string;
  }[];
  /*
   * The last few persisted collection runs, newest first. Same table the
   * provider block already summarises — this reads more than one row of it so
   * the console can show the recent sequence rather than only the latest
   * state. No new telemetry, no new source.
   */
  recentRuns: {
    id: string;
    at: Timestamp;
    changed: number | null;
    unchanged: number | null;
    disappeared: number | null;
    failures: number | null;
    status: string | null;
  }[];
};

/** How many recent runs the overview lists. */
const RECENT_RUNS = 4;

const stat = (value: number | null | undefined, note?: string): Stat => ({
  value: value ?? null,
  ...(note ? { note } : {}),
});

/** A source that cannot be read must not take the page down with it. */
async function attempt<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch {
    return null;
  }
}

const rowsOf = <T,>(result: unknown) =>
  ((result as { rows?: T[] }).rows ?? []) as T[];

export async function readFounderOverview(
  windowDays = 7,
): Promise<FounderOverview> {
  await requireAdmin();

  const product = await attempt(async () => {
    const db = productDatabase();
    const [counts] = rowsOf<{
      signups: number;
      activated: number;
      returning: number;
      credential: number;
      google: number;
      watchlist_entries: number;
      watchlist_users: number;
      alert_rules: number;
      alert_events_24h: number;
      alerts_delivered_24h: number;
      holdings: number;
      portfolio_users: number;
      saved_screens: number;
    }>(
      await db.execute(sql`
        select
          (select count(*) from auth_users
             where created_at >= now() - ${windowDays} * interval '1 day')::int as signups,
          /*
           * Activated: a registered user who has taken a core product action —
           * watched an asset, recorded a holding, configured an alert, or
           * saved a screen. Defined from behaviour that is actually persisted,
           * not chosen to make the number look good.
           */
          (select count(distinct p.id) from app_users p
             where exists (select 1 from watchlist_entries w where w.user_id = p.id)
                or exists (select 1 from portfolio_holdings h where h.user_id = p.id)
                or exists (select 1 from alert_rules r where r.user_id = p.id)
                or exists (select 1 from saved_screens s where s.user_id = p.id))::int as activated,
          /*
           * Returning: a user with a session created at least a day after the
           * account itself. Sessions are persisted, so this is a real repeat
           * visit rather than an inferred one.
           */
          (select count(distinct s.user_id) from auth_sessions s
             join auth_users u on u.id = s.user_id
             where s.created_at > u.created_at + interval '1 day')::int as returning,
          (select count(*) from auth_accounts where provider_id = 'credential')::int as credential,
          (select count(*) from auth_accounts where provider_id = 'google')::int as google,
          (select count(*) from watchlist_entries)::int as watchlist_entries,
          (select count(distinct user_id) from watchlist_entries)::int as watchlist_users,
          (select count(*) from alert_rules)::int as alert_rules,
          (select count(*) from alert_events
             where created_at >= now() - interval '24 hours')::int as alert_events_24h,
          (select count(*) from alert_events
             where created_at >= now() - interval '24 hours'
               and email_state = 'SENT')::int as alerts_delivered_24h,
          (select count(*) from portfolio_holdings)::int as holdings,
          (select count(distinct user_id) from portfolio_holdings)::int as portfolio_users,
          (select count(*) from saved_screens)::int as saved_screens
      `),
    );
    return counts;
  });

  const activity = (await attempt(async () => {
    /*
     * Real rows only. Without a product event log this is registrations,
     * sign-ins and the durable objects users create — which is what the
     * system genuinely knows, rather than a fabricated feed.
     */
    const rows = rowsOf<{ at: Timestamp; kind: string; detail: string }>(
      await productDatabase().execute(sql`
        (select u.created_at as at, 'REGISTERED' as kind, u.email as detail
           from auth_users u order by u.created_at desc limit 10)
        union all
        (select s.created_at, 'SIGNED_IN', u.email
           from auth_sessions s join auth_users u on u.id = s.user_id
           order by s.created_at desc limit 10)
        union all
        (select w.created_at, 'WATCHLIST_ADD', a.market_hash_name
           from watchlist_entries w join assets a on a.id = w.asset_id
           order by w.created_at desc limit 10)
        union all
        (select h.created_at, 'HOLDING_ADDED', a.market_hash_name
           from portfolio_holdings h join assets a on a.id = h.asset_id
           order by h.created_at desc limit 10)
        union all
        (select r.created_at, 'ALERT_CONFIGURED', r.name
           from alert_rules r order by r.created_at desc limit 10)
        order by at desc limit 12
      `),
    );
    return rows;
  })) ?? [];

  const provider = await attempt(async () => {
    const db = database();
    const [run] = rowsOf<{
      observed_at: Timestamp;
      assets_received: number;
      assets_mapped: number;
      assets_unmapped: number;
      states_changed: number;
      states_unchanged: number;
      disappeared: number;
      reappeared: number;
      transform_failures: number;
      collector_version: string;
      normalization_version: string;
    }>(
      await db.execute(sql`
        select observed_at, assets_received, assets_mapped, assets_unmapped,
               states_changed, states_unchanged, disappeared, reappeared,
               transform_failures, collector_version, normalization_version
        from provider_collection_runs order by observed_at desc limit 1
      `),
    );
    const [totals] = rowsOf<{
      known: number;
      history_rows: number;
      history_bytes: number;
      runs_24h: number;
    }>(
      await db.execute(sql`
        select (select count(*) from provider_assets)::int as known,
               (select count(*) from provider_asset_state_history)::int as history_rows,
               pg_total_relation_size('provider_asset_state_history')::bigint as history_bytes,
               (select count(*) from provider_collection_runs
                  where observed_at >= now() - interval '24 hours')::int as runs_24h
      `),
    );
    return { run, totals };
  });

  const recentRuns =
    (await attempt(async () => {
      const rows = rowsOf<{
        id: string;
        at: Timestamp;
        changed: number;
        unchanged: number;
        disappeared: number;
        failures: number;
        status: string | null;
      }>(
        await database().execute(sql`
          select r.collector_run_id::text as id,
                 r.observed_at as at,
                 r.states_changed as changed,
                 r.states_unchanged as unchanged,
                 r.disappeared as disappeared,
                 r.transform_failures as failures,
                 c.status as status
          from provider_collection_runs r
          left join collector_runs c on c.id = r.collector_run_id
          order by r.observed_at desc
          limit ${RECENT_RUNS}
        `),
      );
      return rows;
    })) ?? [];

  const collector = await attempt(async () => {
    const [row] = rowsOf<{
      runs_24h: number;
      failures_24h: number;
      last_at: Timestamp;
      last_status: string;
    }>(
      await database().execute(sql`
        select count(*)::int as runs_24h,
               count(*) filter (where status = 'FAILED')::int as failures_24h,
               max(started_at) as last_at,
               (select status from collector_runs where claim_key is not null
                 order by started_at desc limit 1) as last_status
        from collector_runs
        where claim_key is not null and started_at >= now() - interval '24 hours'
      `),
    );
    return row;
  });

  const dataset = await attempt(() => readMarketDataset());
  const trackedAssets = await attempt(async () => {
    const [row] = rowsOf<{ n: number }>(
      await database().execute(
        sql`select count(*)::int as n from assets where is_tracked`,
      ),
    );
    return row?.n ?? null;
  });

  return {
    funnel: {
      // GA4 is written from the browser; the server holds no credential for
      // the Data API, so this is genuinely unreadable here.
      visitors: stat(null, "GA4 only — no server-side Data API credential"),
      signups: stat(product?.signups),
      activated: stat(product?.activated, "watchlist, holding, alert or screen"),
      returning: stat(product?.returning, "session a day or more after signup"),
      windowDays,
    },
    authMethods: product
      ? { credential: product.credential, google: product.google }
      : null,
    engagement: {
      watchlistEntries: stat(product?.watchlist_entries),
      watchlistUsers: stat(product?.watchlist_users),
      alertRules: stat(product?.alert_rules),
      alertEvents24h: stat(product?.alert_events_24h),
      alertsDelivered24h: stat(product?.alerts_delivered_24h),
      holdings: stat(product?.holdings),
      portfolioUsers: stat(product?.portfolio_users),
      savedScreens: stat(product?.saved_screens),
      assetViews: stat(null, "no server-side event log"),
      screenerQueries: stat(null, "no server-side event log"),
    },
    provider: provider
      ? {
          cadenceMs: WINDOW_MS,
          lastRunAt: provider.run?.observed_at ?? null,
          assetsReceived: provider.run?.assets_received ?? null,
          assetsMapped: provider.run?.assets_mapped ?? null,
          assetsUnmapped: provider.run?.assets_unmapped ?? null,
          changed: provider.run?.states_changed ?? null,
          unchanged: provider.run?.states_unchanged ?? null,
          disappeared: provider.run?.disappeared ?? null,
          reappeared: provider.run?.reappeared ?? null,
          transformFailures: provider.run?.transform_failures ?? null,
          knownAssets: provider.totals?.known ?? null,
          historyRows: provider.totals?.history_rows ?? null,
          historyBytes: Number(provider.totals?.history_bytes ?? 0) || null,
          runs24h: provider.totals?.runs_24h ?? null,
          collectorVersion: provider.run?.collector_version ?? null,
          normalizationVersion: provider.run?.normalization_version ?? null,
        }
      : null,
    intelligence: dataset
      ? {
          trackedAssets: trackedAssets ?? null,
          // Intelligence-ready means an asset carries an observed median, the
          // same rule the sitemap and category pages use.
          intelligenceReady: dataset.error
            ? null
            : dataset.assets.filter((a) => a.median !== null).length,
          method: dataset.snapshot?.method ?? null,
          snapshotId: dataset.snapshotId ?? null,
          evidence: dataset.evidence,
          observedAt: dataset.freshness?.marketEvidence?.observedAt ?? null,
          computedAt: dataset.freshness?.intelligence?.computedAt ?? null,
          error: dataset.error,
        }
      : null,
    collector: collector
      ? {
          runs24h: collector.runs_24h ?? null,
          failures24h: collector.failures_24h ?? null,
          lastRunAt: collector.last_at ?? null,
          lastStatus: collector.last_status ?? null,
        }
      : null,
    activity,
    recentRuns,
  };
}
