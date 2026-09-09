"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Notice } from "./ui";
import { Dialog } from "./dialog";
import type { Condition } from "@/lib/product/schema";
type AssetOption = { id: string; name: string };
export function HoldingForm({
  assets,
  holding,
}: {
  assets: AssetOption[];
  holding?: { assetId: string; quantity: number; unitCost: string | null };
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const router = useRouter();
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        {holding ? "Edit holding" : "+ Add holding"}
      </Button>
      <Dialog
        title={holding ? "Edit holding" : "Add manual holding"}
        open={open}
        onClose={() => setOpen(false)}
      >
        <form
          className="form-grid"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const f = new FormData(e.currentTarget);
            try {
              const r = await fetch("/api/product/portfolio", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  assetId: f.get("asset"),
                  quantity: Number(f.get("quantity")),
                  unitCost: f.get("cost") || null,
                }),
              });
              const b = await r.json();
              if (!r.ok) setError(b.message);
              else {
                setOpen(false);
                router.refresh();
              }
            } catch {
              setError("Network error. Try again.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Tracked asset
            <select name="asset" defaultValue={holding?.assetId} required>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Quantity
            <input
              className="input"
              name="quantity"
              type="number"
              min="1"
              max="1000000"
              step="1"
              defaultValue={holding?.quantity ?? 1}
              required
            />
          </label>
          <label>
            Cost basis per unit · USD (optional)
            <input
              className="input"
              name="cost"
              inputMode="decimal"
              pattern="[0-9]+(\.[0-9]{1,8})?"
              defaultValue={holding?.unitCost ?? ""}
              placeholder="Leave blank if unknown"
            />
          </label>
          <Notice>
            Saving an existing asset replaces its quantity and optional unit
            cost.
          </Notice>
          {error && (
            <p role="alert" className="field-error">
              {error}
            </p>
          )}
          <Button variant="primary" disabled={busy}>
            {busy ? "Saving…" : "Save holding"}
          </Button>
        </form>
      </Dialog>
    </>
  );
}
export function ConditionBuilder({
  conditions,
  onChange,
}: {
  conditions: Condition[];
  onChange: (value: Condition[]) => void;
}) {
  const names: Record<Condition["metric"], string> = {
    median: "Observed median · USD",
    quantity: "Listing quantity",
    sales24h: "Sales activity · 24h",
    priceChange: "Price change · 24h %",
    listingChange: "Listing change · 24h %",
    activityChange: "Activity change · 24h %",
  };
  const set = (index: number, change: Partial<Condition>) =>
    onChange(conditions.map((c, i) => (i === index ? { ...c, ...change } : c)));
  return (
    <div className="stack">
      {conditions.map((c, i) => (
        <div className="form-grid panel pad" key={i}>
          {i > 0 && <span className="eyebrow">AND</span>}
          <label>
            Metric
            <select
              value={c.metric}
              onChange={(e) =>
                set(i, { metric: e.target.value as Condition["metric"] })
              }
            >
              {Object.entries(names).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <div className="row">
            <label>
              Operator
              <select
                value={c.operator}
                onChange={(e) =>
                  set(i, { operator: e.target.value as Condition["operator"] })
                }
              >
                <option value="gt">Greater than</option>
                <option value="lt">Less than</option>
                <option value="between">Between (inclusive)</option>
              </select>
            </label>
            <label>
              Threshold
              <input
                className="input"
                value={c.threshold}
                onChange={(e) => set(i, { threshold: e.target.value })}
                inputMode="decimal"
                required
                pattern="-?[0-9]+(\.[0-9]{1,8})?"
              />
            </label>
            {c.operator === "between" && (
              <label>
                Upper bound
                <input
                  className="input"
                  value={c.upper ?? ""}
                  onChange={(e) => set(i, { upper: e.target.value })}
                  inputMode="decimal"
                  required
                  pattern="-?[0-9]+(\.[0-9]{1,8})?"
                />
              </label>
            )}
          </div>
          {conditions.length > 1 && (
            <Button
              type="button"
              onClick={() =>
                onChange(conditions.filter((_, index) => index !== i))
              }
            >
              Remove condition
            </Button>
          )}
        </div>
      ))}
      <Button
        type="button"
        disabled={conditions.length >= 6}
        onClick={() =>
          onChange([
            ...conditions,
            { metric: "quantity", operator: "lt", threshold: "10" },
          ])
        }
      >
        + Add AND condition
      </Button>
    </div>
  );
}
export function AlertForm({
  assets,
  emailAvailable,
}: {
  assets: AssetOption[];
  emailAvailable: boolean;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [conditions, setConditions] = useState<Condition[]>([
      { metric: "quantity", operator: "lt", threshold: "10" },
    ]);
  const router = useRouter();
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        + Create alert
      </Button>
      <Dialog
        title="Create condition alert"
        open={open}
        onClose={() => setOpen(false)}
      >
        <form
          className="form-grid"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const f = new FormData(e.currentTarget);
            try {
              const r = await fetch("/api/product/alerts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  name: f.get("name"),
                  assetId: f.get("asset"),
                  conditions,
                  email: f.get("email") === "on",
                }),
              });
              const b = await r.json();
              if (!r.ok) setError(b.message);
              else {
                setOpen(false);
                router.refresh();
              }
            } catch {
              setError("Network error. Try again.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Rule name
            <input name="name" className="input" required maxLength={100} />
          </label>
          <label>
            Asset
            <select name="asset">
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <ConditionBuilder conditions={conditions} onChange={setConditions} />
          <label className="row">
            <input name="email" type="checkbox" disabled={!emailAvailable} />{" "}
            Also notify by email {emailAvailable ? "" : "(unavailable)"}
          </label>
          <Notice>
            One notification when all conditions newly become true. The alert
            re-arms after they become false. Insufficient history stays
            collecting.
          </Notice>
          {error && (
            <p role="alert" className="field-error">
              {error}
            </p>
          )}
          <Button variant="primary" disabled={busy}>
            {busy ? "Saving…" : "Create alert"}
          </Button>
        </form>
      </Dialog>
    </>
  );
}
