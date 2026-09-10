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
  const [visualCategories, setVisualCategories] = useState(initialCategories);
  const router = useRouter();
  return (
    <form
      className={onboarding ? "form-grid onboarding-form" : "form-grid"}
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
        <div className="onboarding-stepper">
          <span className={step === 1 ? "active" : ""}>
            <b>01</b>
            <span>
              MARKET INTERESTS
              <small>
                {step === 1 ? "ACTIVE CONFIGURATION" : "CATEGORIES SELECTED"}
              </small>
            </span>
          </span>
          <i />
          <span className={step === 2 ? "active" : ""}>
            <b>02</b>
            <span>
              MONITORING CONDITIONS<small>CRITERIA SELECTION</small>
            </span>
          </span>
          <i />
          <span>
            <b>03</b>
            <span>
              WORKSPACE READY<small>SAVE YOUR PREFERENCES</small>
            </span>
          </span>
        </div>
      )}
      {onboarding && (
        <div className="onboarding-step-label">
          STEP {step} OF 2 //{" "}
          {step === 1 ? "INITIAL TAXONOMY" : "MONITORING FOCUS"}
        </div>
      )}
      <fieldset
        hidden={onboarding && step !== 1}
        style={{ border: 0, padding: 0, margin: 0 }}
      >
        <legend>
          <h2>{onboarding ? "What do you follow?" : "Your market focus"}</h2>
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
                onChange={(e) =>
                  setVisualCategories((current) =>
                    e.target.checked
                      ? [...current, value]
                      : current.filter((v) => v !== value),
                  )
                }
              />
              {label}
              {onboarding && (
                <span className="selection-label">
                  {visualCategories.includes(value) ? "SELECTED" : "UNSELECTED"}
                </span>
              )}
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
      {onboarding && (
        <aside className="onboarding-preview">
          <h3>
            Your market view <span className="dot" />
          </h3>
          <section>
            <span>TERMINAL PREFERENCES</span>
            <strong>
              {visualCategories.length
                ? categories
                    .filter(([key]) => visualCategories.includes(key))
                    .map(([, label]) => label)
                    .join(" · ")
                : "All categories"}
            </strong>
          </section>
          <section>
            <span>MARKET FACTS</span>
            <strong>Same grounded observations</strong>
          </section>
          <section>
            <span>MONITORING</span>
            <strong>
              {step === 1 ? "Configure in Step 2" : "Select your interests"}
            </strong>
          </section>
          <p>You can change these preferences in Settings.</p>
          <small>No Steam credentials or inventory access are required.</small>
        </aside>
      )}
      <Notice>
        Preferences affect your starting filters and focus, never the underlying
        market facts.
      </Notice>
      {message && <p role="status">{message}</p>}
      <div className={onboarding ? "row onboarding-actions" : "row"}>
        {onboarding && (
          <Link href="/terminal" className="muted">
            Skip for now
          </Link>
        )}
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
