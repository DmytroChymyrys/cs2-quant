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
import { PRIVATE_ROBOTS } from "@/lib/seo";
const stateGroups = [
  {
    title: "02 Data semantics, provenance & collecting states",
    states: [
      "COLLECTING",
      "INSUFFICIENT_HISTORY",
      "UNAVAILABLE",
      "STALE",
    ] as const,
  },
  {
    title: "03 Degradation, freshness & system errors",
    states: ["SOURCE_DEGRADED", "SOURCE_UNAVAILABLE", "NETWORK_ERROR"] as const,
  },
  {
    title: "04 Empty states & access gating",
    states: ["NO_RESULTS", "EMPTY", "AUTH_REQUIRED", "PRO_LOCKED"] as const,
  },
];
export const metadata = {
  title: "Component gallery",
  description: "Internal component gallery.",
  robots: PRIVATE_ROBOTS,
};
export default function Gallery() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <AppShell>
      <div className="system-state-board">
        <PageHeading
          title="System states & component behavior"
          description="Development-only specification board. All examples below are fixtures, not production observations."
        />
        <section>
          <h2 className="state-section-title">
            01 Skeletons & loading lifecycle
          </h2>
          <div className="terminal-grid">
            <div className="stack">
              <div className="metric-grid">
                {[1, 2, 3, 4].map((n) => (
                  <Skeleton key={n} kind="metric" />
                ))}
              </div>
              <Skeleton kind="table" />
              <Skeleton kind="chart" />
            </div>
            <div className="stack">
              <Skeleton kind="rail" />
              <Skeleton kind="metric" />
            </div>
          </div>
        </section>
        {stateGroups.map((group, i) => (
          <section key={group.title}>
            <h2 className="state-section-title">{group.title}</h2>
            {i === 0 && (
              <>
                <Panel title="Source and methodology vocabulary">
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
                <div className="metric-grid">
                  <Metric
                    label="Grounded zero"
                    value="0"
                    note="Legitimate observed zero"
                  />
                  <Metric
                    label="Unavailable"
                    value="—"
                    note="No substitute zero"
                  />
                  <Metric
                    label="History"
                    value={<SemanticBadge state="COLLECTING" />}
                  />
                  <Metric label="Confidence" value={<ConfidenceBadge />} />
                </div>
              </>
            )}
            <div className="three-columns">
              {group.states.map((state) => (
                <Panel title={state} key={state}>
                  <DataState state={state} />
                </Panel>
              ))}
            </div>
          </section>
        ))}
        <section>
          <h2 className="state-section-title">
            05 UI controls, forms & destruction hierarchy
          </h2>
          <Panel title="Input lifecycle states">
            <div className="state-input-grid">
              {["Default", "Focused", "Valid", "Invalid", "Disabled"].map(
                (state) => (
                  <label key={state}>
                    {state}
                    <input
                      className="input"
                      placeholder="Search asset"
                      disabled={state === "Disabled"}
                      aria-invalid={state === "Invalid"}
                      defaultValue={
                        state === "Valid" ? "Danger Zone Case" : undefined
                      }
                    />
                    {state === "Invalid" && (
                      <span className="field-error">Enter a valid value.</span>
                    )}
                  </label>
                ),
              )}
            </div>
          </Panel>
          <Panel title="Button states">
            <div className="pad row">
              <Button>Default</Button>
              <Button variant="primary">Primary</Button>
              <Button variant="danger">Destructive</Button>
              <Button disabled>Disabled</Button>
            </div>
          </Panel>
          <div className="three-columns">
            {[
              "Delete alert rule",
              "Remove portfolio holding",
              "Delete account",
            ].map((title, i) => (
              <Panel key={title} title={title}>
                <div className="pad stack">
                  <p>
                    {i === 0
                      ? "Rule deletion requires confirmation."
                      : i === 1
                        ? "Holding removal requires confirmation."
                        : "Account deletion requires explicit typed confirmation and a recent authenticated session."}
                  </p>
                  <Button variant="danger" disabled>
                    Preview only
                  </Button>
                </div>
              </Panel>
            ))}
          </div>
        </section>
        <section>
          <h2 className="state-section-title">
            06 Signals & terminology governance
          </h2>
          <div className="three-columns">
            {[
              [
                "Supply contraction",
                "An observed reduction in listing quantity; never an instruction to buy.",
              ],
              [
                "Activity change",
                "A comparison of published sales aggregates; not an inferred trade tape.",
              ],
              [
                "Price confidence",
                "Unavailable until a methodology is validated. Never a directional score.",
              ],
              [
                "Grounded zero",
                "A real zero remains zero, including zero sales.",
              ],
              ["Collecting", "The observation baseline is still accumulating."],
              [
                "Unchanged values",
                "Repeated source values are valid observations.",
              ],
            ].map(([title, description]) => (
              <Panel key={title} title={title}>
                <p className="pad">{description}</p>
              </Panel>
            ))}
          </div>
        </section>
        <section>
          <h2 className="state-section-title">
            07 Responsive viewport adaptations
          </h2>
          <div className="four-columns">
            {[
              [
                "1440px desktop",
                "Full terminal composition and inspection rail.",
              ],
              [
                "1280px compact",
                "Narrower rail; table columns remain accessible.",
              ],
              [
                "1024px workspace",
                "Stacked modules with contained table scrolling.",
              ],
              [
                "768px and below",
                "Single-column flow; compact metrics and mobile navigation.",
              ],
            ].map(([title, description]) => (
              <Panel key={title} title={title}>
                <p className="pad">{description}</p>
              </Panel>
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
