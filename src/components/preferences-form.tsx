"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Notice } from "./ui";
const categories = [
  ["cases", "Cases"],
  ["weapons", "Weapon skins"],
  ["knives", "Knives"],
  ["gloves", "Gloves"],
  ["capsules/stickers", "Stickers & capsules"],
];
const interests = [
  "Price Movement",
  "Supply Changes",
  "Activity Anomalies",
  "Volatility",
  "Price/Supply Divergence",
];
export function PreferencesForm({
  initialCategories = [],
  initialInterests = [],
  assets = [],
  onboarding = false,
}: {
  initialCategories?: string[];
  initialInterests?: string[];
  assets?: { id: string; name: string }[];
  onboarding?: boolean;
}) {
  const [step, setStep] = useState(1),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const router = useRouter();
  return (
    <form
      className="form-grid"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        try {
          const r = await fetch("/api/product/preferences", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              categories: f.getAll("categories"),
              interests: f.getAll("interests"),
              starterAssets: f.getAll("starters"),
            }),
          });
          const b = await r.json();
          if (!r.ok) setMessage(b.message);
          else if (onboarding) router.push("/terminal");
          else {
            setMessage("Preferences saved.");
            router.refresh();
          }
        } catch {
          setMessage("Network error. Try again.");
        } finally {
          setBusy(false);
        }
      }}
    >
      {onboarding && (
        <>
          <div className="row between">
            <span className="eyebrow">Step {step} of 2</span>
            <Link href="/terminal" className="muted">
              Skip to Terminal →
            </Link>
          </div>
          <div className="progress">
            <span style={{ width: step === 1 ? "50%" : "100%" }} />
          </div>
        </>
      )}
      <fieldset
        hidden={onboarding && step !== 1}
        style={{ border: 0, padding: 0, margin: 0 }}
      >
        <legend>
          <h2>Your market focus</h2>
        </legend>
        <p className="muted">Choose the categories you want to follow.</p>
        <div className="check-grid" style={{ marginTop: 15 }}>
          {categories.map(([value, label]) => (
            <label className="check-card" key={value}>
              <input
                type="checkbox"
                name="categories"
                value={value}
                defaultChecked={initialCategories.includes(value)}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset
        hidden={onboarding && step !== 2}
        style={{ border: 0, padding: 0, margin: 0 }}
      >
        <legend>
          <h2>What do you monitor?</h2>
        </legend>
        <div className="check-grid">
          {interests.map((value) => (
            <label className="check-card" key={value}>
              <input
                type="checkbox"
                name="interests"
                value={value}
                defaultChecked={initialInterests.includes(value)}
              />
              {value}
            </label>
          ))}
        </div>
        {onboarding && assets.length > 0 && (
          <details style={{ marginTop: 20 }}>
            <summary>Add up to five starter assets (optional)</summary>
            <div
              className="stack"
              style={{ maxHeight: 240, overflow: "auto", padding: 10 }}
            >
              {assets.map((a) => (
                <label className="row" key={a.id}>
                  <input type="checkbox" name="starters" value={a.id} />
                  {a.name}
                </label>
              ))}
            </div>
          </details>
        )}
      </fieldset>
      <Notice>
        Preferences affect your starting filters and focus, never the underlying
        market facts.
      </Notice>
      {message && <p role="status">{message}</p>}
      <div className="row">
        {onboarding && step === 2 && (
          <Button type="button" onClick={() => setStep(1)}>
            Back
          </Button>
        )}
        {onboarding && step === 1 ? (
          <Button type="button" variant="primary" onClick={() => setStep(2)}>
            Continue →
          </Button>
        ) : (
          <Button variant="primary" disabled={busy}>
            {busy
              ? "Saving…"
              : onboarding
                ? "Open my terminal"
                : "Save preferences"}
          </Button>
        )}
      </div>
    </form>
  );
}
