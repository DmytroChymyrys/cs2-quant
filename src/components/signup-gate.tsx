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
 */
export function SignupGate({
  withheld,
  surface,
  what,
}: {
  withheld: number;
  surface: string;
  what: string;
}) {
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    track({ name: "signup_gate_viewed", params: { surface, withheld } });
  }, [surface, withheld]);

  return (
    <div className="signup-gate">
      <div className="stack">
        <h3>Unlock the full market</h3>
        <p>
          {withheld > 0
            ? `${withheld} more ${what} are available with a free account, along with the complete screener, saved watchlists, condition alerts and your CS2 inventory valuation.`
            : `A free account adds the complete screener, saved watchlists, condition alerts and your CS2 inventory valuation.`}
        </p>
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
