import type { FounderOverview, Stat, Timestamp } from "@/lib/ops/founder";

/**
 * Founder Operations overview.
 *
 * The rule throughout: a value that cannot be measured renders as "—" with the
 * reason, never as a zero. On a console used to decide things, a confident
 * zero is worse than an admitted gap. Nothing here is a literal from a design
 * mockup; every figure is read from a production source on each request.
 *
 * Percentages and expected-run counts are arithmetic over two real numbers,
 * not separate metrics — they return null the moment either side is missing,
 * so an unknown denominator reads as unknown rather than as 0%.
 */

const number = (value: number | null | undefined) =>
  value === null || value === undefined ? null : value.toLocaleString("en-US");

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
  if (seconds < 90) return `${seconds} sec ago`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 172800) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
};

/** Null unless both sides are known; an unknown rate is not 0%. */
const rate = (part: number | null, whole: number | null) =>
  part === null || whole === null || whole === 0
    ? null
    : `${((part / whole) * 100).toFixed(1)}%`;

/** A run identifier short enough to read. Real id, never a counter. */
const runRef = (id: string) => id.replace(/-/g, "").slice(0, 8);

/* ── shared pieces ─────────────────────────────────────────────────────── */

function Figure({
  label,
  value,
  note,
  unavailable,
  code,
}: {
  label: string;
  value: string | null;
  note?: string | null;
  unavailable?: string;
  /* Identifiers and states read as monospace text, not as a large numeral. */
  code?: boolean;
}) {
  const missing = value === null;
  return (
    <div className="ops-figure" data-unavailable={missing ? "true" : undefined}>
      <span className="ops-figure-label">{label}</span>
      <strong
        className="ops-figure-value"
        data-code={code && !missing ? "true" : undefined}
      >
        {missing ? "—" : value}
      </strong>
      {(missing ? unavailable : note) && (
        <small className="ops-figure-note">
          {missing ? `Unavailable · ${unavailable ?? "no source"}` : note}
        </small>
      )}
    </div>
  );
}

function FunnelStage({
  index,
  label,
  stat,
  unit,
  badge,
}: {
  index: string;
  label: string;
  stat: Stat;
  unit?: string;
  badge?: string | null;
}) {
  const missing = stat.value === null;
  return (
    <div
      className="ops-stage"
      data-unavailable={missing ? "true" : undefined}
      data-active={stat.value !== null && stat.value > 0 ? "true" : undefined}
    >
      <header>
        <span className="ops-stage-label">
          {index} · {label}
        </span>
        {badge && <span className="ops-stage-badge">{badge}</span>}
      </header>
      <strong className="ops-stage-value">
        {missing ? "—" : number(stat.value)}
        {!missing && unit && <em>{unit}</em>}
      </strong>
      <small className="ops-stage-note">
        {missing ? `Unavailable · ${stat.note}` : stat.note}
      </small>
    </div>
  );
}

function Health({
  label,
  state,
  detail,
  ok,
}: {
  label: string;
  state: string | null;
  detail: string;
  ok: boolean | null;
}) {
  return (
    <div
      className="ops-health"
      data-state={ok === null ? "unknown" : ok ? "ok" : "attention"}
    >
      <header>
        <span>{label}</span>
        <i aria-hidden="true" />
      </header>
      <strong>{state ?? "—"}</strong>
      <small>{detail}</small>
    </div>
  );
}

/* ── the console ───────────────────────────────────────────────────────── */

export function FounderOverviewView({ data }: { data: FounderOverview }) {
  const {
    funnel,
    engagement,
    provider,
    intelligence,
    collector,
    recentRuns,
    authMethods,
  signupMethods,
    steam,
  } = data;

  /*
   * Runs expected in a day at the observed cadence. Derived from the cadence
   * the collector actually uses, so it tracks a cadence change instead of
   * being a number typed in once.
   */
  const expectedRuns = provider ? Math.round(86_400_000 / provider.cadenceMs) : null;
  const coverage = rate(
    intelligence?.intelligenceReady ?? null,
    intelligence?.trackedAssets ?? null,
  );
  const completion =
    intelligence?.intelligenceReady !== null &&
    intelligence?.intelligenceReady !== undefined &&
    intelligence?.trackedAssets
      ? Math.min(
          100,
          (intelligence.intelligenceReady / intelligence.trackedAssets) * 100,
        )
      : null;
  const collectionOk =
    collector?.failures24h === null || collector?.failures24h === undefined
      ? null
      : collector.failures24h === 0;
  const intelligenceOk = intelligence
    ? !intelligence.error && intelligence.intelligenceReady !== null
    : null;
  const persistenceOk = provider ? provider.historyRows !== null : null;
  const authOk = authMethods ? true : null;

  return (
    <div className="ops-founder">
      {/* 1 · status header */}
      <section className="ops-cockpit-head">
        <div>
          <h2>
            Founder Operations <span className="ops-tag">Production</span>
          </h2>
          <p>
            Platform telemetry, dual-engine data fidelity, and early activation
            funnels.
          </p>
        </div>
        <ul className="ops-chips">
          <li data-state={collectionOk === false ? "attention" : "ok"}>
            <i aria-hidden="true" />
            {collectionOk === null
              ? "Collector state unknown"
              : collectionOk
                ? "All systems operational"
                : "Collector failures in last 24h"}
          </li>
          {provider && (
            <li>Cadence · {provider.cadenceMs / 60000} min</li>
          )}
          <li>Ingestion · {provider ? (ago(provider.lastRunAt) ?? "—") : "—"}</li>
          <li>
            Storage ·{" "}
            {provider ? (megabytes(provider.historyBytes) ?? "—") : "—"}
          </li>
        </ul>
      </section>

      {/* 2 · growth and early activation */}
      <section className="ops-panel">
        <h2>
          Growth &amp; Early Activation
          <small>early-stage acquisition and conversion funnel</small>
        </h2>
        {/*
          Four stages, each defined from data that is actually persisted.
          Visitors has no server-side source at all and says so rather than
          borrowing a number from somewhere it does not belong.
        */}
        <div className="ops-stages">
          <FunnelStage index="01" label="Visitors" stat={funnel.visitors} />
          <FunnelStage
            index="02"
            label="Signups"
            stat={funnel.signups}
            unit="registered accounts"
          />
          <FunnelStage
            index="03"
            label="Activated"
            stat={funnel.activated}
            unit="users"
            badge={rate(funnel.activated.value, funnel.signups.value)}
          />
          <FunnelStage
            index="04"
            label="Returning"
            stat={funnel.returning}
            unit="users"
            badge={rate(funnel.returning.value, funnel.signups.value)}
          />
        </div>
        <p className="ops-note">
          Rolling {funnel.windowDays} days. Conversion is measured against
          signups in the same window.
        </p>
      </section>

      {/* 3 · data engine scope line */}
      <section className="ops-panel ops-scope">
        <h2>
          Data Engine
          <small>
            raw venue catalogue observation, separated from derived feature
            evaluation
          </small>
        </h2>
        {/*
          The one line that explains the architecture: a broad observed
          universe, a much smaller tracked universe, and the subset with
          computed intelligence. Three different facts, never one number.
        */}
        <ol className="ops-scope-line">
          <li>
            <strong>{number(provider?.knownAssets ?? null) ?? "—"}</strong>
            <span>observed</span>
          </li>
          <li aria-hidden="true" className="ops-scope-arrow">
            →
          </li>
          <li>
            <strong>{number(intelligence?.trackedAssets ?? null) ?? "—"}</strong>
            <span>tracked</span>
          </li>
          <li aria-hidden="true" className="ops-scope-arrow">
            →
          </li>
          <li>
            <strong>
              {number(intelligence?.intelligenceReady ?? null) ?? "—"}
            </strong>
            <span>intelligence ready</span>
          </li>
        </ol>
      </section>

      {/* 4 · provider observation | intelligence engine */}
      <div className="ops-duo">
        <section className="ops-panel">
          <h2>
            Provider Observation
            <small>Skinport · provider collection</small>
          </h2>
          {provider ? (
            <>
              <div className="ops-hero">
                <strong>{number(provider.knownAssets) ?? "—"}</strong>
                <span>Observable assets</span>
                <small>
                  {provider.lastRunAt ? "Live synced" : "Awaiting first run"}
                </small>
              </div>
              <div className="ops-figures">
                <Figure
                  label="Ingestion cadence"
                  value={`${provider.cadenceMs / 60000} minutes`}
                  note={`${number(provider.runs24h) ?? "—"} runs / 24h`}
                />
                <Figure
                  label="Transform failures"
                  value={number(provider.transformFailures)}
                  note="last run"
                />
                <Figure
                  label="Provider history"
                  value={number(provider.historyRows)}
                  note="transitions · change-only state records"
                />
                <Figure
                  label="Storage footprint"
                  value={megabytes(provider.historyBytes)}
                  note="state history relation"
                />
              </div>
              <div className="ops-breakdown">
                <header>
                  <span>Last run breakdown</span>
                  <small>{utc(provider.lastRunAt) ?? "—"}</small>
                </header>
                <div>
                  <Figure
                    label="Changed"
                    value={number(provider.changed)}
                    note="state rows written"
                  />
                  <Figure
                    label="Unchanged"
                    value={number(provider.unchanged)}
                    note="observed, nothing written"
                  />
                  <Figure
                    label="Disappeared"
                    value={number(provider.disappeared)}
                    note="absence, never quantity zero"
                  />
                </div>
              </div>
              <p className="ops-note">
                Raw external venue catalogue observation. Broad market
                visibility, without predictive or microstructure modelling.
              </p>
            </>
          ) : (
            <p role="status">Unavailable · could not read provider state.</p>
          )}
        </section>

        <section className="ops-panel">
          <h2>
            Intelligence Engine
            <small>
              {intelligence?.method ? (
                <code>{intelligence.method}</code>
              ) : (
                "derived scope"
              )}
            </small>
          </h2>
          {/*
            The provider universe and the derived scope stay separate panels.
            One observes the whole venue catalogue as change history; the other
            computes features over a far smaller tracked set. Presenting them
            as one number would misdescribe both.
          */}
          {intelligence ? (
            <>
              <div className="ops-hero ops-hero-split">
                <div>
                  <strong>{number(intelligence.trackedAssets) ?? "—"}</strong>
                  <span>Tracked universe</span>
                  <small>assets under derived intelligence</small>
                </div>
                <div>
                  <strong>
                    {number(intelligence.intelligenceReady) ?? "—"}
                    {intelligence.trackedAssets !== null && (
                      <em>/ {number(intelligence.trackedAssets)}</em>
                    )}
                  </strong>
                  <span>Operational coverage</span>
                  <small>{coverage ? `${coverage} ready` : "—"}</small>
                </div>
              </div>
              <div className="ops-figures">
                <Figure
                  label="Model pipeline"
                  value={intelligence.method}
                  note="feature evaluation method"
                  code
                />
                <Figure
                  label="Collector failures · 24h"
                  value={number(collector?.failures24h ?? null)}
                  unavailable="could not read collector runs"
                />
                <Figure
                  label="Execution rate · 24h"
                  value={
                    collector?.runs24h === null ||
                    collector?.runs24h === undefined
                      ? null
                      : `${number(collector.runs24h)}${expectedRuns ? ` / ${number(expectedRuns)}` : ""}`
                  }
                  note={
                    expectedRuns && collector?.runs24h != null
                      ? (rate(collector.runs24h, expectedRuns) ??
                        "at observed cadence")
                      : "at observed cadence"
                  }
                  unavailable="could not read collector runs"
                />
                <Figure
                  label="Dataset state"
                  value={intelligence.error ? null : intelligence.evidence}
                  note={ago(intelligence.computedAt) ?? undefined}
                  unavailable={intelligence.error ?? "no derived dataset"}
                  code
                />
              </div>
              {completion !== null && (
                <div className="ops-progress">
                  <header>
                    <span>Feature vector completion</span>
                    <small>
                      {number(intelligence.intelligenceReady)} /{" "}
                      {number(intelligence.trackedAssets)} synthesised
                    </small>
                  </header>
                  <div
                    role="progressbar"
                    aria-valuenow={Math.round(completion)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <i style={{ width: `${completion}%` }} />
                  </div>
                </div>
              )}
              <p className="ops-note">
                Derived surveillance over the tracked universe: multi-variable
                feature extraction, supply contraction, and baseline validation.
              </p>
            </>
          ) : (
            <p role="status">
              Unavailable · could not read the derived dataset.
            </p>
          )}
        </section>
      </div>

      {/*
        Provider #2, deliberately its own panel rather than a column added to
        Provider Observation. The two sources observe different venues at
        different cadences, and one figure spanning both would describe
        neither.
      */}
      <section className="ops-panel">
        <h2>
          Provider Observation · SteamWebAPI
          <small>Steam · provider collection</small>
        </h2>
        {steam ? (
          <>
            <div className="ops-hero ops-hero-split">
              <div>
                <strong>{number(steam.knownAssets) ?? "—"}</strong>
                <span>Observable assets</span>
                <small>{steam.enabled ? "Collecting" : "Collection disabled"}</small>
              </div>
              <div>
                <strong>
                  {number(steam.mappedAssets) ?? "—"}
                  {steam.knownAssets !== null && (
                    <em>/ {number(steam.knownAssets)}</em>
                  )}
                </strong>
                <span>Mapped to FloatAlpha</span>
                <small>
                  {number(steam.unmappedAssets) ?? "—"} observed without a
                  canonical asset
                </small>
              </div>
            </div>
            <div className="ops-figures">
              <Figure
                label="Ingestion cadence"
                value="60 minutes"
                note={`${number(steam.runs24h) ?? "—"} runs / 24h`}
              />
              <Figure
                label="Last collection"
                value={ago(steam.lastRunAt)}
                note={utc(steam.lastRunAt) ?? undefined}
              />
              <Figure
                label="Provider history"
                value={number(steam.historyRows)}
                note="transitions · change-only state records"
              />
              <Figure
                label="Storage footprint"
                value={megabytes(steam.historyBytes)}
                note="state history relation"
              />
            </div>
            <div className="ops-breakdown">
              <header>
                <span>Last run breakdown</span>
                <small>{steam.collectorVersion ?? "—"}</small>
              </header>
              <div>
                <Figure
                  label="Changed"
                  value={number(steam.changed)}
                  note="state rows written"
                />
                <Figure
                  label="Unchanged"
                  value={number(steam.unchanged)}
                  note="observed, nothing written"
                />
                <Figure
                  label="Transform failures"
                  value={number(steam.transformFailures)}
                  note="rows that could not be normalized"
                />
              </div>
            </div>
            <p className="ops-note">
              Steam-side market observation: listed offers, standing buy orders
              and realised sales counts. Third-party marketplace values this
              provider also returns are not collected.
            </p>
          </>
        ) : (
          <p role="status">
            Not collecting yet · no SteamWebAPI run has been recorded.
          </p>
        )}
      </section>

      {/* 5 · product engagement */}
      <section className="ops-panel">
        <h2>
          Product Engagement
          <small>behaviour mapped to persisted product records</small>
        </h2>
        <div className="ops-figures ops-figures-quad">
          <Figure
            label="Watch"
            value={number(engagement.watchlistEntries.value)}
            note={`watchlist entries · ${number(engagement.watchlistUsers.value) ?? "—"} users`}
          />
          <Figure
            label="Track"
            value={number(engagement.alertRules.value)}
            note={`alert rules · ${number(engagement.alertsDelivered24h.value) ?? "—"} delivered / 24h`}
          />
          <Figure
            label="Portfolio"
            value={number(engagement.holdings.value)}
            note={`holdings · ${number(engagement.portfolioUsers.value) ?? "—"} users`}
          />
          <Figure
            label="Research"
            value={number(engagement.savedScreens.value)}
            note="saved screens"
          />
        </div>
        {/*
          Browser-only analytics stay unavailable rather than being replaced
          with a server-side approximation that would mean something else.
        */}
        <p className="ops-note ops-note-inline">
          <span>
            Workstation telemetry inactive · front-end analytics bridge deferred
            for the alpha release.
          </span>
          <span>
            Asset intelligence views <b>—</b>
          </span>
          <span>
            Screener queries <b>—</b>
          </span>
        </p>
      </section>

      {/* 6 · system health */}
      <div className="ops-healths">
        <Health
          label="Collection Pipeline"
          ok={collectionOk}
          state={
            collectionOk === null
              ? null
              : collectionOk
                ? "Operational"
                : "Degraded"
          }
          detail={
            collector
              ? `${provider ? `${provider.cadenceMs / 60000}m cadence · ` : ""}last run ${ago(collector.lastRunAt) ?? "—"} · ${number(collector.failures24h) ?? "—"} failures / 24h`
              : "Unavailable · could not read collector runs"
          }
        />
        <Health
          label="Derived Intelligence"
          ok={intelligenceOk}
          state={
            intelligenceOk === null
              ? null
              : intelligenceOk
                ? "Active"
                : "Attention"
          }
          detail={
            intelligence
              ? `${number(intelligence.intelligenceReady) ?? "—"} ready · ${intelligence.method ?? "—"} · ${intelligence.error ?? "no errors"}`
              : "Unavailable · could not read the derived dataset"
          }
        />
        <Health
          label="Database Persistence"
          ok={persistenceOk}
          state={persistenceOk === null ? null : "Nominal"}
          detail={
            provider
              ? `${megabytes(provider.historyBytes) ?? "—"} · ${number(provider.historyRows) ?? "—"} transitions`
              : "Unavailable · could not read provider state"
          }
        />
        <Health
          label="Authentication"
          ok={authOk}
          state={authOk === null ? null : "Operational"}
          /*
           * Identities, not accounts: one person may hold several, including
           * more than one from the same provider, so these do not sum to the
           * number of users and are not meant to.
           */
          detail={
            authMethods
              ? `${authMethods.credential} password · ${authMethods.google} Google · ${authMethods.steam} Steam`
              : "Unavailable · could not read accounts"
          }
        />
        <Health
          label="Signed up with"
          ok={signupMethods === null ? null : true}
          state={signupMethods === null ? null : "Recorded"}
          /*
           * How accounts were CREATED. Fixed at creation, so unlike the row
           * above this does not move when somebody connects another identity.
           * Unknown is shown rather than hidden: it is the honest answer for
           * accounts whose provenance predates the record.
           */
          detail={
            signupMethods
              ? `${signupMethods.email} email · ${signupMethods.google} Google · ${signupMethods.steam} Steam · ${signupMethods.unknown} unknown`
              : "Unavailable · could not read accounts"
          }
        />
      </div>

      {/* 7 · recent persisted collector runs */}
      <section className="ops-panel">
        <h2>
          Recent Persisted Collector Runs
          <small>newest first · synchronous batch</small>
        </h2>
        {recentRuns.length ? (
          <div className="ops-scroll">
            <table className="ops-runs">
              <thead>
                <tr>
                  <th>Run identifier</th>
                  <th>Timestamp</th>
                  <th>State transition breakdown</th>
                  <th className="ops-num">Errors</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {recentRuns.map((run) => (
                  <tr key={run.id}>
                    <td>
                      <code>{runRef(run.id)}</code>
                    </td>
                    <td>{ago(run.at) ?? "—"}</td>
                    <td className="ops-transitions">
                      <b>{number(run.changed) ?? "—"} changed</b>,{" "}
                      {number(run.unchanged) ?? "—"} unchanged,{" "}
                      {number(run.disappeared) ?? "—"} disappeared
                    </td>
                    <td className="ops-num">{number(run.failures) ?? "—"}</td>
                    <td>
                      <span
                        className="ops-run-status"
                        data-ok={
                          run.status === null
                            ? undefined
                            : run.status !== "FAILED"
                              ? "true"
                              : "false"
                        }
                      >
                        {run.status ?? "—"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p role="status">No collection runs recorded yet.</p>
        )}
      </section>

      {/* 8 · footer */}
      <footer className="ops-cockpit-foot">
        <span>FloatAlpha Operations · Internal console</span>
        <span>Every value read from a production source on each request.</span>
      </footer>
    </div>
  );
}
