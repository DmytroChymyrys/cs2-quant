import type { FounderOverview, Stat, Timestamp } from "@/lib/ops/founder";

/**
 * Founder Operations overview.
 *
 * Built from the existing FloatAlpha primitives — the same panel, metric and
 * badge language as the rest of the product — rather than a second visual
 * system for one internal page.
 *
 * The rule throughout: a value that cannot be measured renders as
 * "Unavailable" with the reason, never as a zero. On a console used to decide
 * things, a confident zero is worse than an admitted gap.
 */

const number = (value: number | null) =>
  value === null ? null : value.toLocaleString("en-US");

const megabytes = (bytes: number | null) =>
  bytes === null ? null : `${(bytes / 1e6).toFixed(1)} MB`;

/** Both drivers' timestamp shapes, as milliseconds. */
const millis = (at: Timestamp) =>
  at === null ? null : typeof at === "string" ? Date.parse(at) : at.getTime();

/** HH:MM:SS UTC, or null — never a string built from `undefined`. */
const utc = (at: Timestamp) => {
  const ms = millis(at);
  return ms === null || !Number.isFinite(ms)
    ? null
    : `${new Date(ms).toISOString().slice(11, 19)} UTC`;
};

const ago = (at: Timestamp) => {
  if (!at) return null;
  const then = millis(at);
  if (then === null || !Number.isFinite(then)) return null;
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 90) return `${seconds}s ago`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 172800) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
};

function Figure({
  label,
  value,
  note,
  unavailable,
}: {
  label: string;
  value: string | null;
  note?: string | null;
  unavailable?: string;
}) {
  const missing = value === null;
  return (
    <div className="ops-figure" data-unavailable={missing ? "true" : undefined}>
      <span className="ops-figure-label">{label}</span>
      <strong className="ops-figure-value">{missing ? "—" : value}</strong>
      {(missing ? unavailable : note) && (
        <small className="ops-figure-note">
          {missing ? `Unavailable · ${unavailable ?? "no source"}` : note}
        </small>
      )}
    </div>
  );
}

const FunnelStage = ({
  index,
  label,
  stat,
}: {
  index: string;
  label: string;
  stat: Stat;
}) => (
  <div className="ops-figure" data-unavailable={stat.value === null ? "true" : undefined}>
    <span className="ops-figure-label">
      {index} · {label}
    </span>
    <strong className="ops-figure-value">
      {stat.value === null ? "—" : number(stat.value)}
    </strong>
    <small className="ops-figure-note">
      {stat.value === null ? `Unavailable · ${stat.note}` : stat.note}
    </small>
  </div>
);

export function FounderOverviewView({ data }: { data: FounderOverview }) {
  const { funnel, engagement, provider, intelligence, collector, activity } =
    data;
  return (
    <div className="ops-founder">
      <section className="ops-panel">
        <h2>
          Growth &amp; conversion
          <small>rolling {funnel.windowDays} days</small>
        </h2>
        {/*
          Four stages, each defined from data that is actually persisted.
          Visitors has no server-side source at all and says so rather than
          borrowing a number from somewhere it does not belong.
        */}
        <div className="ops-figures">
          <FunnelStage index="01" label="Visitors" stat={funnel.visitors} />
          <FunnelStage index="02" label="Signups" stat={funnel.signups} />
          <FunnelStage index="03" label="Activated" stat={funnel.activated} />
          <FunnelStage index="04" label="Returning" stat={funnel.returning} />
        </div>
        {data.authMethods && (
          <p className="ops-note">
            Auth methods · {data.authMethods.credential} password ·{" "}
            {data.authMethods.google} Google
          </p>
        )}
      </section>

      <section className="ops-panel">
        <h2>
          Product engagement
          <small>persisted product records</small>
        </h2>
        <div className="ops-figures">
          <Figure
            label="Watchlist entries"
            value={number(engagement.watchlistEntries.value)}
            note={`${number(engagement.watchlistUsers.value) ?? "—"} users`}
          />
          <Figure
            label="Portfolio holdings"
            value={number(engagement.holdings.value)}
            note={`${number(engagement.portfolioUsers.value) ?? "—"} users`}
          />
          <Figure
            label="Alert rules"
            value={number(engagement.alertRules.value)}
            note={`${number(engagement.alertEvents24h.value) ?? "—"} events / 24h`}
          />
          <Figure
            label="Alerts delivered · 24h"
            value={number(engagement.alertsDelivered24h.value)}
            note="email_state = SENT"
          />
          <Figure
            label="Saved screens"
            value={number(engagement.savedScreens.value)}
          />
          <Figure
            label="Asset intelligence views"
            value={null}
            unavailable={engagement.assetViews.note}
          />
          <Figure
            label="Screener queries"
            value={null}
            unavailable={engagement.screenerQueries.note}
          />
        </div>
      </section>

      <section className="ops-panel">
        <h2>
          Data engine · provider universe
          <small>Skinport · full observable catalogue</small>
        </h2>
        {/*
          The provider universe and the derived intelligence scope are
          deliberately separate panels. One observes ~25,000 assets as change
          history; the other computes listing-features-v3 over ~100. Presenting
          them as one number would misdescribe both.
        */}
        {provider ? (
          <div className="ops-figures">
            <Figure
              label="Cadence"
              value={`${provider.cadenceMs / 60000}m`}
              note={`${number(provider.runs24h) ?? "—"} runs / 24h`}
            />
            <Figure
              label="Last collection"
              value={ago(provider.lastRunAt)}
              note={utc(provider.lastRunAt) ?? undefined}
            />
            <Figure
              label="Provider assets observed"
              value={number(provider.assetsReceived)}
              note={`${number(provider.knownAssets) ?? "—"} known identities`}
            />
            <Figure
              label="Mapped / unmapped"
              value={`${number(provider.assetsMapped) ?? "—"} / ${number(provider.assetsUnmapped) ?? "—"}`}
              note="resolved to a FloatAlpha asset"
            />
            <Figure
              label="Changed · last run"
              value={number(provider.changed)}
              note="state rows written"
            />
            <Figure
              label="Unchanged · last run"
              value={number(provider.unchanged)}
              note="observed, no history written"
            />
            <Figure
              label="Disappeared / reappeared"
              value={`${number(provider.disappeared) ?? "—"} / ${number(provider.reappeared) ?? "—"}`}
              note="absence, never quantity zero"
            />
            <Figure
              label="Transform failures"
              value={number(provider.transformFailures)}
            />
            <Figure
              label="State history"
              value={number(provider.historyRows)}
              note={megabytes(provider.historyBytes) ?? undefined}
            />
            <Figure
              label="Versions"
              value={provider.collectorVersion}
              note={provider.normalizationVersion ?? undefined}
            />
          </div>
        ) : (
          <p role="status">Unavailable · could not read provider state.</p>
        )}
      </section>

      <section className="ops-panel">
        <h2>
          Intelligence engine
          <small>derived scope</small>
        </h2>
        {intelligence ? (
          <div className="ops-figures">
            <Figure
              label="Tracked universe"
              value={number(intelligence.trackedAssets)}
              note="assets under derived intelligence"
            />
            <Figure
              label="Intelligence-ready"
              value={number(intelligence.intelligenceReady)}
              note="carrying an observed median"
            />
            <Figure label="Method" value={intelligence.method} />
            <Figure
              label="Evidence"
              value={intelligence.evidence}
              note={intelligence.error ?? undefined}
            />
            <Figure
              label="Market evidence"
              value={ago(intelligence.observedAt)}
              note="newest observation"
            />
            <Figure
              label="Intelligence computed"
              value={ago(intelligence.computedAt)}
              note="derived refresh"
            />
          </div>
        ) : (
          <p role="status">Unavailable · could not read the derived dataset.</p>
        )}
      </section>

      <section className="ops-panel">
        <h2>
          Collection health
          <small>tracked collector · 24h</small>
        </h2>
        {collector ? (
          <div className="ops-figures">
            <Figure label="Runs · 24h" value={number(collector.runs24h)} />
            <Figure
              label="Failures · 24h"
              value={number(collector.failures24h)}
            />
            <Figure
              label="Last run"
              value={ago(collector.lastRunAt)}
              note={collector.lastStatus ?? undefined}
            />
          </div>
        ) : (
          <p role="status">Unavailable · could not read collector runs.</p>
        )}
      </section>

      <section className="ops-panel">
        <h2>
          Recent activity
          <small>persisted account and product records</small>
        </h2>
        {/*
          No product event log exists, so this is built from durable rows —
          registrations, sessions, and the objects users create. It is not a
          page-view feed and does not pretend to be one.
        */}
        {activity.length ? (
          <ul className="ops-activity">
            {activity.map((event, i) => (
              <li key={i}>
                <span className="ops-activity-kind">{event.kind}</span>
                <span className="ops-activity-detail">{event.detail}</span>
                <span className="ops-activity-at">{ago(event.at)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p>No account or product activity recorded yet.</p>
        )}
      </section>
    </div>
  );
}
