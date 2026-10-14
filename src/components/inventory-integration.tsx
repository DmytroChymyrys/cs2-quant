"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Notice } from "./ui";

/**
 * Enabling Steam Inventory, from Settings.
 *
 * Rendering this never creates anything. The integration exists only once the
 * person presses the button — which is the whole reason the Steam
 * authentication identity and this product integration are separate records.
 *
 * Markup follows the Steam connection block directly above it: `stack`, `row`,
 * `p[role=status]`, `details`. No new visual vocabulary is introduced.
 */
export function InventoryIntegration({
  steamLinked,
  enabled,
  everSynced,
}: {
  steamLinked: boolean;
  enabled: boolean;
  everSynced: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  async function send(action: "enable" | "sync") {
    setBusy(true);
    if (action === "enable") setStatus("");
    try {
      const response = await fetch("/api/product/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const result = await response.json();
      if (!response.ok) {
        setStatus(result.message ?? "That did not work. Please try again.");
        return;
      }
      if (action === "enable") {
        // Two steps on purpose: the provider is contacted only once the
        // integration durably exists, so a refusal cannot leave it half-made.
        setStatus("Steam inventory enabled. Importing your inventory…");
        await send("sync");
        return;
      }
      /*
       * Not translated into "you own N items" here. The inventory page re-reads
       * the persisted view, which is the only thing that can state what was
       * actually observed. A non-authoritative outcome says nothing about the
       * inventory, so it must not read like an answer about it.
       */
      setStatus(
        result.authoritative
          ? "Inventory imported."
          : "FloatAlpha could not read this Steam inventory. Check that your Steam inventory privacy allows access, then try again.",
      );
      router.refresh();
    } catch {
      setStatus("That did not work. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <h4>Steam inventory</h4>
      {!steamLinked ? (
        <Notice>
          Connect Steam above to import your CS2 inventory.
        </Notice>
      ) : (
        <>
          <p>
            {enabled
              ? everSynced
                ? "FloatAlpha reads your CS2 inventory and values it against observed market listings."
                : "Enabled. Your inventory has not been imported yet."
              : "FloatAlpha will read your CS2 inventory and use market data to show your holdings and their observed value."}
          </p>
          <div className="row">
            {enabled ? (
              <Link className="cyan" href="/inventory">
                View inventory
              </Link>
            ) : (
              <Button
                type="button"
                disabled={busy}
                onClick={() => void send("enable")}
              >
                {busy ? "Enabling…" : "Enable Steam inventory"}
              </Button>
            )}
          </div>
          {status && <p role="status">{status}</p>}
          <details>
            <summary>What inventory access does</summary>
            <p>
              {/* States the limits explicitly. Read-only item list, nothing else. */}
              FloatAlpha reads the list of items in your CS2 inventory so it can
              show what you own and value it against observed market listings.
              It is read-only: FloatAlpha cannot trade, sell, move or hold your
              items, does not take custody of anything, and gains no control
              over your Steam account.
            </p>
            <p>
              Steam decides whether your inventory is visible. If your inventory
              privacy does not allow access, FloatAlpha reports that it could
              not read it — never that it is empty.
            </p>
          </details>
        </>
      )}
    </div>
  );
}
