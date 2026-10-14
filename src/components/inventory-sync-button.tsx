"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./ui";

/**
 * One explicit synchronisation.
 *
 * Three independent protections sit behind this button, and none of them is in
 * this file:
 *
 *   ownership   the route derives the user from the session; nothing posted
 *               here names a user, an integration or a Steam account
 *   overlap     a DB lease makes a second concurrent sync impossible — it
 *               returns BUSY and makes no provider call
 *   rate        the route refuses an attempt made within the cooldown, read
 *               from `last_attempt_at`
 *
 * `disabled` while in flight is a courtesy to the person, not a control. A
 * client that ignored it would still hit all three.
 */
export function InventorySync({ label = "Refresh inventory" }: { label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  async function run() {
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch("/api/product/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync" }),
      });
      const result = await response.json();
      if (!response.ok) {
        setStatus(result.message ?? "That did not work. Please try again.");
        return;
      }
      /*
       * A non-authoritative outcome is evidence about the provider, never about
       * the inventory, so it must not read as an answer about what is owned.
       * The sentence comes from the server's fixed vocabulary -- this component
       * chooses no wording of its own and never sees a provider message.
       */
      setStatus(
        result.authoritative
          ? "Inventory updated."
          : (result.reason?.message ??
             "FloatAlpha could not read this Steam inventory. Your holdings are unchanged."),
      );
      // Re-read regardless: a refused sync leaves the view correct, and the
      // page is where the counts come from.
      router.refresh();
    } catch {
      setStatus("That did not work. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="stack">
      <Button type="button" disabled={busy} onClick={() => void run()}>
        {busy ? "Reading Steam…" : label}
      </Button>
      {status && <p role="status">{status}</p>}
    </span>
  );
}
