"use client";
import { useState } from "react";
import Link from "next/link";
import type { Condition } from "@/lib/product/schema";
import type { MarketAsset } from "@/lib/product/market";
import { ConditionBuilder } from "./personal-forms";
import { Button, DataState } from "./ui";
import { money, integer } from "@/lib/product/format";
export function AdvancedScreener() {
  const [conditions, setConditions] = useState<Condition[]>([
      { metric: "quantity", operator: "lt", threshold: "10" },
    ]),
    [assets, setAssets] = useState<MarketAsset[] | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [saved, setSaved] = useState<
      { id: string; name: string; conditions: Condition[] }[]
    >([]);
  const run = async (
    action: "run" | "save" | "export" | "load",
    name?: string,
  ) => {
    setBusy(true);
    setMessage("");
    try {
      const endpoint =
        action === "save" || action === "load"
          ? "/api/product/screens"
          : "/api/product/screener";
      const r = await fetch(endpoint, {
        method: action === "load" ? "GET" : "POST",
        headers: { "Content-Type": "application/json" },
        body:
          action === "load"
            ? undefined
            : JSON.stringify({
                conditions,
                exportCsv: action === "export",
                name,
              }),
      });
      const data = await r.json();
      if (!r.ok) {
        setMessage(data.message);
        return;
      }
      if (action === "load") setSaved(data.screens);
      else if (action === "save") setMessage("Screen saved.");
      else if (action === "export") {
        const url = URL.createObjectURL(
          new Blob([data.csv], { type: "text/csv;charset=utf-8" }),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = "floatalpha-screen.csv";
        a.click();
        URL.revokeObjectURL(url);
      } else setAssets(data.assets);
    } catch {
      setMessage("Request failed. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="pad stack">
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          void run("run");
        }}
      >
        <ConditionBuilder conditions={conditions} onChange={setConditions} />
        <Button variant="primary" disabled={busy}>
          {busy ? "Working…" : "Run advanced screen"}
        </Button>
      </form>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void run("save", String(new FormData(e.currentTarget).get("name")));
        }}
      >
        <label>
          Screen name
          <input name="name" className="input" required maxLength={100} />
        </label>
        <Button disabled={busy}>Save screen</Button>
        <Button type="button" onClick={() => void run("load")} disabled={busy}>
          Load saved
        </Button>
        <Button
          type="button"
          onClick={() => void run("export")}
          disabled={busy}
        >
          Export CSV
        </Button>
      </form>
      {saved.length > 0 && (
        <label>
          Saved screen
          <select
            defaultValue=""
            onChange={(e) => {
              const screen = saved.find((s) => s.id === e.target.value);
              if (screen) setConditions(screen.conditions);
            }}
          >
            <option value="" disabled>
              Select a screen
            </option>
            {saved.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {message && <p role="status">{message}</p>}
      {assets &&
        (assets.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Median</th>
                  <th>Listings</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Link href={`/asset/${a.id}`}>{a.name}</Link>
                    </td>
                    <td className="number">{money(a.median)}</td>
                    <td className="number">{integer(a.quantity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <DataState
            state="NO_RESULTS"
            title="No evaluable assets match"
            description="Unknown, collecting, or stale inputs do not satisfy numeric conditions."
          />
        ))}
    </div>
  );
}
