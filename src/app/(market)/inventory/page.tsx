import Link from "next/link";
import { currentUser } from "@/lib/product/auth";
import { AuthRequired } from "@/components/auth-required";
import { PageHeading, Panel, Metric, DataState, Notice } from "@/components/ui";
import { InventoryTable } from "@/components/inventory-table";
import { inventoryView } from "@/lib/product/inventory-view";
import { money, integer, timestamp } from "@/lib/product/format";
import { PRIVATE_ROBOTS } from "@/lib/seo";

/**
 * Inventory V1.
 *
 * Strictly a read surface. Rendering this page never contacts Steam and never
 * writes: it displays what the last successful observation recorded, and says
 * plainly when that is old, failed or absent. Synchronisation is a separate,
 * explicit action that does not exist yet.
 */
export const metadata = {
  title: "Inventory",
  description: "Your observed CS2 inventory and its supported market references.",
  robots: PRIVATE_ROBOTS,
};
export const dynamic = "force-dynamic";

const OUTCOME_NOTE: Record<string, string> = {
  UNAVAILABLE:
    "The most recent refresh could not read your Steam inventory. This is usually a Steam privacy setting rather than a problem with your FloatAlpha account.",
  RATE_LIMITED: "The most recent refresh was rate limited by the data provider.",
  PROVIDER_ERROR: "The most recent refresh failed at the data provider.",
  TIMEOUT: "The most recent refresh timed out before Steam answered.",
};

export default async function Inventory() {
  const user = await currentUser();
  if (!user) return <AuthRequired feature="inventory" />;
  const view = await inventoryView(user.app.id);
  const { summary: s, snapshot } = view;

  return (
    <div className="personal-workstation inventory-workstation">
      <PageHeading
        eyebrow="Observed ownership · Listing-reference valuation"
        title="CS2 inventory"
        description="What you own, and what FloatAlpha can support about it."
      />

      {view.state === "NOT_CONNECTED" && (
        <Panel title="Steam inventory">
          <DataState
            state="EMPTY"
            title="Steam is not connected"
            description="Connect Steam from Settings to import your CS2 inventory. Connecting verifies account ownership only."
            action={<Link className="cyan" href="/settings#connected-accounts">Go to Settings</Link>}
          />
        </Panel>
      )}

      {view.state === "NEVER_SYNCED" && (
        <Panel title="Steam inventory">
          {/* Never observed is NOT an empty inventory, and must not read like one. */}
          <DataState
            state="EMPTY"
            title="Inventory not imported yet"
            description="Steam is connected, but FloatAlpha has not yet observed your CS2 inventory. Nothing is known about it either way."
          />
        </Panel>
      )}

      {view.state === "DISCONNECTED" && (
        <Notice>
          Steam is disconnected, so this inventory is no longer updating. The
          holdings below are preserved from the last successful observation on{" "}
          {timestamp(snapshot.lastSuccessAt)}.
        </Notice>
      )}

      {snapshot.latestAttemptFailed && (
        /* The previous snapshot stays on screen. Hiding observed inventory
           because a later refresh failed would lose real evidence. */
        <Notice>
          {OUTCOME_NOTE[snapshot.lastOutcome ?? ""] ??
            "The most recent refresh did not succeed."}{" "}
          Showing the last successful observation from{" "}
          {timestamp(snapshot.lastSuccessAt)}.
        </Notice>
      )}

      {snapshot.stale && !snapshot.latestAttemptFailed && (
        <Notice>
          This inventory was last observed {timestamp(snapshot.lastSuccessAt)} and
          may no longer reflect what you own.
        </Notice>
      )}

      {(view.state === "AVAILABLE" || view.state === "OBSERVED_EMPTY") && (
        <div className="metric-grid">
          <Metric
            label="Observed inventory value"
            value={money(s.estimatedValue)}
            note={`${s.priced}/${s.itemInstances} items priced`}
          />
          <Metric label="Items" value={integer(s.itemInstances)} note={`${integer(s.totalQuantity)} total quantity`} />
          <Metric
            label="Tracked coverage"
            value={`${s.tracked}/${s.itemInstances}`}
            note="Items with deep FloatAlpha intelligence"
          />
          <Metric label="Last observed" value={timestamp(snapshot.lastSuccessAt)} />
        </div>
      )}

      {view.state === "OBSERVED_EMPTY" && (
        <Panel title="Current holdings">
          {/* Observed and genuinely empty — a different fact from never synced. */}
          <DataState
            state="EMPTY"
            title="No CS2 inventory items were returned"
            description="The last successful observation found no items in your CS2 inventory."
          />
        </Panel>
      )}

      {s.unpriced > 0 && view.state !== "OBSERVED_EMPTY" && (
        <Notice>
          Partial valuation: {s.priced} of {s.itemInstances} items have a
          Skinport listing reference. The observed value covers only those
          items; the remainder are not valued at zero, they are unpriced.
        </Notice>
      )}

      {view.holdings.length > 0 && <InventoryTable holdings={view.holdings} />}

      {(s.unmatched > 0 || s.ambiguous > 0) && (
        <section className="subordinate-note">
          <p>
            {s.unmatched > 0 && (
              <>
                {s.unmatched} item{s.unmatched === 1 ? " is" : "s are"} owned but
                not resolved to a FloatAlpha market asset, so no market evidence
                is available for {s.unmatched === 1 ? "it" : "them"}.{" "}
              </>
            )}
            {s.ambiguous > 0 && (
              <>
                {s.ambiguous} item{s.ambiguous === 1 ? "" : "s"} matched more than
                one market identity and {s.ambiguous === 1 ? "was" : "were"} left
                unresolved rather than valued against a guess.
              </>
            )}
          </p>
        </section>
      )}

      <p className="subordinate-note">
        Values are observed Skinport listing references multiplied by the
        quantity observed in your inventory. They are an estimate of current
        market reference, not a sale price, and FloatAlpha holds no record of
        what you paid.
      </p>
    </div>
  );
}
