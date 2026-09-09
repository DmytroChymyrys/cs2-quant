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
export default async function Alerts() {
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
  return (
    <>
      <PageHeading
        eyebrow="Monitoring / Conditions"
        title="Alerts"
        description="Notify once when a condition newly becomes true. Re-arm after it becomes false."
        action={
          <AlertForm
            assets={snapshot.assets}
            emailAvailable={emailConfigured()}
          />
        }
      />
      {process.env.ALERT_SCHEDULE_ENABLED !== "true" && (
        <Notice>
          Automatic alert evaluation has not been enabled for this deployment.
          Saved rules will not notify until the evaluator is scheduled.
        </Notice>
      )}
      <div className="metric-grid">
        <Metric label="Rules" value={rules.length} />
        <Metric
          label="Active"
          value={rules.filter((r) => r.state === "ACTIVE" && !r.paused).length}
        />
        <Metric
          label="Collecting"
          value={
            rules.filter((r) => r.state === "COLLECTING" && !r.paused).length
          }
        />
        <Metric label="Paused" value={rules.filter((r) => r.paused).length} />
        <Metric
          label="Recent conditions satisfied"
          value={events.length}
          note="Latest 50 events"
        />
        <Metric
          label="Email delivery"
          value={emailConfigured() ? "Available" : "Unavailable"}
        />
      </div>
      <div className="terminal-grid">
        <Panel title="Condition rules">
          {rules.length ? (
            <div className="stack pad">
              {rules.map((r) => (
                <section className="panel" key={r.id}>
                  <div className="panel-head">
                    <h3>{r.name}</h3>
                    <SemanticBadge state={r.paused ? "PAUSED" : r.state} />
                  </div>
                  <div className="pad stack">
                    <p>
                      {snapshot.assets.find((a) => a.id === r.assetId)?.name}
                    </p>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Metric</th>
                            <th>Operator</th>
                            <th>Threshold</th>
                          </tr>
                        </thead>
                        <tbody>
                          {r.conditions.map((c, i) => (
                            <tr key={i}>
                              <td>{c.metric}</td>
                              <td>{c.operator}</td>
                              <td className="mono">
                                {c.threshold}
                                {c.upper ? ` to ${c.upper}` : ""}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <details>
                      <summary>Latest evaluation matrix</summary>
                      <pre style={{ whiteSpace: "pre-wrap" }}>
                        {r.lastEvaluation
                          ? JSON.stringify(r.lastEvaluation, null, 2)
                          : "No evaluation yet."}
                      </pre>
                    </details>
                    <div className="row">
                      <MutationButton
                        label={r.paused ? "Resume" : "Pause"}
                        endpoint="/api/product/alerts"
                        method="PATCH"
                        body={{ id: r.id, paused: !r.paused }}
                      />
                      <MutationButton
                        label="Delete alert"
                        endpoint="/api/product/alerts"
                        method="DELETE"
                        body={{ id: r.id }}
                        confirm={`Delete ${r.name} and its saved alert events?`}
                      />
                    </div>
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <DataState
              state="EMPTY"
              title="No alert rules"
              description="Choose an asset and a condition to monitor."
              action={
                <AlertForm
                  assets={snapshot.assets}
                  emailAvailable={emailConfigured()}
                />
              }
            />
          )}
        </Panel>
        <Panel title="In-app notifications">
          {events.length ? (
            events.map((event) => (
              <article className="notification-item stack" key={event.id}>
                <SemanticBadge state="DERIVED" />
                <h3>
                  {String(
                    (event.details as { name?: string }).name ??
                      "Condition satisfied",
                  )}
                </h3>
                <p>{timestamp(event.createdAt.toISOString())}</p>
                <p>
                  Email: {event.emailState.toLowerCase().replaceAll("_", " ")}
                </p>
              </article>
            ))
          ) : (
            <DataState
              state="EMPTY"
              title="No conditions satisfied yet"
              description="Events appear here only after a false-to-true transition."
            />
          )}
        </Panel>
      </div>
    </>
  );
}
