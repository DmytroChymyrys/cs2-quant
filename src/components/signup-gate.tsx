"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { track } from "@/lib/ga";

/**
 * The point where the guest preview ends.
 *
 * Framed as unlocking the rest of a real product rather than as a paywall,
 * because that is what it is: everything above is genuine data, and an account
 * is free. It states what is actually withheld — a count the caller measured —
 * so the offer is specific rather than a vague promise of "more".
 *
 * Reports `signup_gate_viewed` once per surface. That one event is what makes
 * the funnel measurable: without it we can see signups but not how many people
 * reached the point of being asked, which is the number that tells us whether
 * the gate is placed well. It is never an Ads conversion.
 *
 * ## Two placements, one component
 *
 * DEPTH gates sit beneath a truncated list and render with the page: the
 * visitor has already seen what they are missing, and `withheld` counts it.
 *
 * ACTION gates appear only after the visitor tries something an account is
 * required for, so they carry their own wording and no count. They mount at
 * that moment, which is exactly when `signup_gate_viewed` should fire — the
 * event means "was asked", and for an action gate the asking is the click.
 *
 * `surface` distinguishes the two in GA4 (`screener` vs `screener-run`), so no
 * second event name is needed to tell a depth gate from an action gate.
 */
export function SignupGate({
  withheld = 0,
  surface,
  what,
  title = "Unlock the full market",
  description,
  compact = false,
}: {
  surface: string;
  /** How many rows the caller withheld. Zero for an action gate. */
  withheld?: number;
  /** What those rows are, for the default wording. */
  what?: string;
  title?: string;
  /** Overrides the withheld-count wording entirely. */
  description?: string;
  compact?: boolean;
}) {
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    track({ name: "signup_gate_viewed", params: { surface, withheld } });
  }, [surface, withheld]);

  const body =
    description ??
    (withheld > 0 && what
      ? `${withheld} more ${what} are available with a free account, along with the complete screener, saved watchlists, condition alerts and your CS2 inventory valuation.`
      : `A free account adds the complete screener, saved watchlists, condition alerts and your CS2 inventory valuation.`);

  return (
    <div className={`signup-gate${compact ? " compact" : ""}`}>
      <div className="stack">
        <h3>{title}</h3>
        <p>{body}</p>
        <p className="muted">
          Pro access is included during early access. No card required.
        </p>
        <div className="row">
          <Link className="btn primary" href="/signup">
            Create free account
          </Link>
          <Link className="btn" href="/login">
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
