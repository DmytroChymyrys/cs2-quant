import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell";
import {
  PageHeading,
  Panel,
  Metric,
  SemanticBadge,
  DataState,
  Skeleton,
  Button,
  ConfidenceBadge,
} from "@/components/ui";
export default function Gallery() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <AppShell>
      <PageHeading
        title="System states"
        description="Development-only component gallery. Fixtures here are not production data."
      />
      <div className="metric-grid">
        <Metric label="Grounded zero" value="0" note="Legitimate zero" />
        <Metric label="Unavailable" value="—" />
        <Metric label="History" value={<SemanticBadge state="COLLECTING" />} />
        <Metric label="Confidence" value={<ConfidenceBadge />} />
        <Skeleton kind="metric" />
        <Metric label="Stale" value={<SemanticBadge state="STALE" />} />
      </div>
      <Panel title="Semantic badges">
        <div className="pad row">
          {[
            "GROUNDED",
            "DERIVED",
            "EXPERIMENTAL",
            "COLLECTING",
            "UNAVAILABLE",
            "STALE",
          ].map((state) => (
            <SemanticBadge key={state} state={state} />
          ))}
        </div>
      </Panel>
      <div className="three-columns">
        {(
          [
            "COLLECTING",
            "INSUFFICIENT_HISTORY",
            "UNAVAILABLE",
            "STALE",
            "SOURCE_DEGRADED",
            "SOURCE_UNAVAILABLE",
            "NETWORK_ERROR",
            "NO_RESULTS",
            "EMPTY",
            "AUTH_REQUIRED",
            "PRO_LOCKED",
          ] as const
        ).map((state) => (
          <Panel title={state} key={state}>
            <DataState state={state} />
          </Panel>
        ))}
      </div>
      <Panel title="Form and button states">
        <div className="pad row">
          <label>
            Default
            <input className="input" placeholder="Search asset" />
          </label>
          <label>
            Validation error
            <input
              className="input"
              aria-invalid="true"
              aria-describedby="field-error"
            />
            <span className="field-error" id="field-error">
              Enter a valid value.
            </span>
          </label>
          <Button>Default</Button>
          <Button variant="primary">Primary</Button>
          <Button variant="danger">Destructive</Button>
          <Button disabled>Disabled</Button>
        </div>
      </Panel>
      <div className="terminal-grid">
        <Skeleton kind="chart" />
        <Skeleton kind="rail" />
      </div>
      <Skeleton kind="table" />
    </AppShell>
  );
}
