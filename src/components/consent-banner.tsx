"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "./ui";
import {
  ADVERTISING_SIGNALS,
  CONSENT_COOKIE,
  CONSENT_MAX_AGE_SECONDS,
  CONSENT_REQUIRED_COOKIE,
  GOOGLE_PARTNER_SITES_URL,
  parseConsentChoice,
  type ConsentChoice,
} from "@/lib/consent";

/** Literal-name cookie read; no regex over document.cookie. */
function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  for (const part of document.cookie ? document.cookie.split("; ") : []) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq) === name)
      return decodeURIComponent(part.slice(eq + 1));
  }
  return null;
}

function writeChoice(choice: ConsentChoice) {
  document.cookie = `${CONSENT_COOKIE}=${choice}; Max-Age=${CONSENT_MAX_AGE_SECONDS}; Path=/; SameSite=Lax; Secure`;
}

/** Applies a choice to Google Consent Mode immediately, without a reload. */
export function applyConsent(choice: ConsentChoice) {
  const update: Record<string, "granted" | "denied"> = {};
  for (const signal of ADVERTISING_SIGNALS) update[signal] = choice;
  // analytics_storage travels with the same choice here because in these
  // regions its default is also denied; outside them this banner never shows
  // and the existing granted default stands untouched.
  update.analytics_storage = choice;
  window.gtag?.("consent", "update", update);
}

/**
 * Consent banner, shown only where an affirmative choice is required.
 *
 * Renders nothing unless the proxy marked this request as coming from a
 * consent-required region AND no choice is stored. Both are read on the client
 * after mount, so no page has to become dynamic to decide.
 *
 * Accept and Reject are the same size, the same weight and adjacent. Neither is
 * pre-selected, dismissing is not treated as acceptance, and nothing is granted
 * before the visitor acts.
 */
export function ConsentBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (readCookie(CONSENT_REQUIRED_COOKIE) !== "1") return;
    if (parseConsentChoice(readCookie(CONSENT_COOKIE))) return;
    // Deferred out of the effect body: cookies are only readable after mount,
    // and setting state synchronously there cascades a second render pass.
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  if (!visible) return null;

  const choose = (choice: ConsentChoice) => {
    writeChoice(choice);
    applyConsent(choice);
    setVisible(false);
  };

  return (
    <div className="consent-banner" role="dialog" aria-live="polite"
         aria-label="Cookies and measurement">
      <div className="consent-banner-body">
        <p>
          FloatAlpha uses cookies and similar technologies for analytics,
          advertising measurement and ads personalization. Google may use this
          data as described in{" "}
          <a href={GOOGLE_PARTNER_SITES_URL} target="_blank" rel="noreferrer">
            how Google uses data from sites that use its services
          </a>
          . See our <Link href="/privacy">privacy notice</Link>. You can change
          this at any time in Settings.
        </p>
        <div className="row">
          <Button type="button" onClick={() => choose("granted")}>
            Accept
          </Button>
          <Button type="button" onClick={() => choose("denied")}>
            Reject
          </Button>
        </div>
      </div>
    </div>
  );
}
