import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { currentUser } from "@/lib/product/auth";
import { productDatabase } from "@/lib/product/db";
import { alertRules, alertEvents } from "@/lib/product/schema";
import { entitlements } from "@/lib/product/entitlements";
import { marketSnapshot } from "@/lib/product/market";
import { emailConfigured } from "@/lib/product/email";
import { timestamp } from "@/lib/product/format";
import {
  Panel,
  PageHeading,
  Metric,
  DataState,
  LinkButton,
  SemanticBadge,
  Notice,
} from "@/components/ui";
import { AuthRequired } from "@/components/auth-required";
import { AlertForm } from "@/components/personal-forms";
import { MutationButton } from "@/components/product-actions";
export default async function Alerts({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await currentUser();
  if (!user) return <AuthRequired feature="alerts" />;
  const caps = await entitlements(user.app.id);
  if (!caps.canCreateAlerts)
    return (
      <DataState
        state="PRO_LOCKED"
        title="Condition alerts"
        description="Pro enables durable condition rules, in-app notifications, and email delivery when configured."
        action={<LinkButton href="/pricing">Compare Free and Pro</LinkButton>}
      />
    );
  const [snapshot, rules, events] = await Promise.all([
    marketSnapshot(),
    productDatabase()
      .select()
      .from(alertRules)
      .where(eq(alertRules.userId, user.app.id)),
    productDatabase()
      .select()
      .from(alertEvents)
      .where(eq(alertEvents.userId, user.app.id))
      .orderBy(desc(alertEvents.createdAt))
      .limit(50),
  ]);
  const selected = rules[0];
  const selectedId = (await searchParams).rule;
  const rule = rules.find((r) => r.id === selectedId) ?? selected;
  const asset = snapshot.assets.find((a) => a.id === rule?.assetId);
  return (
    <div className="personal-workstation alerts-workstation">
      <PageHeading
        eyebrow="Monitoring / Conditions"
        title="Alerts"
        description="Continuous monitoring of observed price, listing quantity and sales activity. Notify once on a false-to-true transition."
        action={
          <AlertForm
            assets={snapshot.assets}
            emailAvailable={emailConfigured()}
          />
        }
      />
      {process.env.ALERT_SCHEDULE_ENABLED !== "true" && (
        <Notice>
          Automatic evaluation has not been enabled. Saved rules notify only
          after the evaluator is scheduled.
        </Notice>
      )}
      <div className="metric-grid">
        <Metric
          label="Configured rules"
          value={rules.length}
          note={`${rules.filter((r) => !r.paused).length} enabled · ${rules.filter((r) => r.paused).length} paused`}
        />
        <Metric
          label="Recent conditions satisfied"
          value={events.length}
          note="Latest 50 recorded events"
        />
        <Metric
          label="Monitored assets"
          value={new Set(rules.map((r) => r.assetId)).size}
          note="Canonical Skinport assets"
        />
        <Metric
          label="Evaluation status"
          value={
            process.env.ALERT_SCHEDULE_ENABLED === "true"
              ? "ENABLED"
              : "NOT SCHEDULED"
          }
          note={`${rules.filter((r) => r.state === "COLLECTING").length} rules collecting history`}
        />
      </div>
      <h3 className="section-kicker">
        Recent evaluations // Conditions satisfied
      </h3>
      <div className="attention-grid alert-recent">
        {events.length ? (
          events.slice(0, 2).map((event) => (
            <section key={event.id}>
              <SemanticBadge state="DERIVED" />
              <strong>
                {String(
                  (event.details as { name?: string }).name ??
                    "Condition satisfied",
                )}
              </strong>
              <p>{timestamp(event.createdAt.toISOString())}</p>
              <span>
                Email: {event.emailState.toLowerCase().replaceAll("_", " ")}
              </span>
            </section>
          ))
        ) : (
          <>
            <section>
              <h3>Recent conditions</h3>
              <strong>No conditions satisfied yet</strong>
              <p>
                Events appear here after a false-to-true transition. A
                continuously true condition does not notify again.
              </p>
              <SemanticBadge state="EMPTY" />
            </section>
            <section>
              <h3>Delivery state</h3>
              <strong>In-app event history</strong>
              <p>
                No delivery is implied by an unevaluated rule. Each event
                retains its recorded timestamp and email delivery state.
              </p>
              <span className="cyan">
                DURABLE EVENT HISTORY · {events.length} EVENTS
              </span>
            </section>
          </>
        )}
      </div>
      <div className="personal-desk-grid alerts-desk">
        <Panel
          title={`Condition rules · ${rules.length}`}
          note="DURABLE STATE TRANSITIONS"
        >
          {rules.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Alert name</th>
                    <th>Target asset</th>
                    <th>Configured conditions</th>
                    <th>Status</th>
                    <th>Channels</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((r) => (
                    <tr
                      key={r.id}
                      className={r.id === rule?.id ? "selected-row" : ""}
                    >
                      <td>
                        <Link href={`/alerts?rule=${r.id}`}>{r.name}</Link>
                      </td>
                      <td>
                        <Link href={`/asset/${r.assetId}`}>
                          {snapshot.assets.find((a) => a.id === r.assetId)
                            ?.name ?? "Asset unavailable"}
                        </Link>
                      </td>
                      <td className="mono">
                        {r.conditions.map((c, i) => (
                          <div key={i}>
                            {i > 0 ? "AND " : ""}
                            {c.metric}{" "}
                            {c.operator === "gt"
                              ? ">"
                              : c.operator === "lt"
                                ? "<"
                                : "BETWEEN"}{" "}
                            {c.threshold}
                            {c.upper ? ` / ${c.upper}` : ""}
                          </div>
                        ))}
                      </td>
                      <td>
                        <SemanticBadge state={r.paused ? "PAUSED" : r.state} />
                      </td>
                      <td className="mono">
                        IN-APP{r.email ? " · EMAIL" : ""}
                      </td>
                      <td>
                        <div className="row">
                          <Link className="cyan" href={`/alerts?rule=${r.id}`}>
                            INSPECT
                          </Link>
                          <MutationButton
                            label={r.paused ? "Resume" : "Pause"}
                            endpoint="/api/product/alerts"
                            method="PATCH"
                            body={{ id: r.id, paused: !r.paused }}
                          />
                          <MutationButton
                            label="Delete"
                            endpoint="/api/product/alerts"
                            method="DELETE"
                            body={{ id: r.id }}
                            confirm={`Delete ${r.name} and its saved alert events?`}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <DataState
              state="EMPTY"
              title="No alert rules"
              description="Choose an asset and a condition to monitor."
            />
          )}
          <div className="condition-types">
            <h3>Condition types // Existing rule builder</h3>
            <div>
              {[
                "Median price",
                "Listing quantity",
                "Sales activity",
                "Compound AND",
              ].map((label) => (
                <section key={label}>
                  <strong>{label}</strong>
                  <small>Observed values · explicit thresholds</small>
                </section>
              ))}
            </div>
          </div>
          <div className="event-history">
            <h3>In-app notification history</h3>
            {events.length ? (
              events.map((event) => (
                <div key={event.id}>
                  <span>{timestamp(event.createdAt.toISOString())}</span>
                  <b>
                    {String(
                      (event.details as { name?: string }).name ??
                        "Condition satisfied",
                    )}
                  </b>
                  <span>{event.emailState}</span>
                </div>
              ))
            ) : (
              <p>No events have been recorded.</p>
            )}
          </div>
        </Panel>
        <aside className="rule-inspection">
          <div className="row between">
            <span>INSPECTION RAIL // ALERT</span>
            {rule && (
              <SemanticBadge state={rule.paused ? "PAUSED" : rule.state} />
            )}
          </div>
          {rule ? (
            <>
              <h2>{asset?.name ?? "Asset unavailable"}</h2>
              <p className="muted">Canonical unversioned asset · Skinport</p>
              <div className="rule-definition">
                <h3>
                  Rule definition <span>BOOLEAN AND</span>
                </h3>
                <strong>{rule.name}</strong>
                <p>
                  All configured conditions must become true together. The saved
                  state controls notification and re-arm behavior.
                </p>
              </div>
              <h3>Configured evaluation matrix</h3>
              <div className="evaluation-matrix">
                {rule.conditions.map((c, i) => (
                  <div key={i}>
                    <span>
                      {c.metric}
                      <small>
                        Target: {c.operator} {c.threshold}
                        {c.upper ? ` / ${c.upper}` : ""}
                      </small>
                    </span>
                    <SemanticBadge state={rule.state} />
                  </div>
                ))}
              </div>
              <details className="stored-evaluation" open>
                <summary>Latest recorded evaluation</summary>
                <pre>
                  {rule.lastEvaluation
                    ? JSON.stringify(rule.lastEvaluation, null, 2)
                    : "No evaluation has been recorded yet."}
                </pre>
              </details>
              <div className="dispatch-log">
                <h3>Dispatch log</h3>
                <p>
                  {events.filter((e) => e.ruleId === rule.id).length} recorded
                  events for this rule.
                </p>
                <p>
                  No simulated deliveries or current condition truth is
                  substituted for stored evaluation results.
                </p>
              </div>
              <LinkButton href={`/asset/${rule.assetId}`} primary>
                OPEN ASSET INTELLIGENCE ↗
              </LinkButton>
              <div className="row">
                <MutationButton
                  label={rule.paused ? "Resume alert" : "Pause alert"}
                  endpoint="/api/product/alerts"
                  method="PATCH"
                  body={{ id: rule.id, paused: !rule.paused }}
                />
                <MutationButton
                  label="Delete alert"
                  endpoint="/api/product/alerts"
                  method="DELETE"
                  body={{ id: rule.id }}
                  confirm={`Delete ${rule.name} and its saved alert events?`}
                />
              </div>
            </>
          ) : (
            <DataState state="EMPTY" title="Select a rule" />
          )}
        </aside>
      </div>
    </div>
  );
}
