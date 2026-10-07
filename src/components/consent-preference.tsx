"use client";

import { useEffect, useState } from "react";
import { Button } from "./ui";
import { applyConsent } from "./consent-banner";
import {
  CONSENT_COOKIE,
  CONSENT_MAX_AGE_SECONDS,
  CONSENT_REQUIRED_COOKIE,
  GOOGLE_PARTNER_SITES_URL,
  parseConsentChoice,
  type ConsentChoice,
} from "@/lib/consent";

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  for (const part of document.cookie ? document.cookie.split("; ") : []) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq) === name)
      return decodeURIComponent(part.slice(eq + 1));
  }
  return null;
}

/**
 * The accessible route to change a consent choice later, as Google's EU User
 * Consent Policy requires.
 *
 * Shown only to visitors in a consent-required region: elsewhere there is no
 * choice to revisit, and presenting one would imply a control that does not
 * govern anything.
 */
export function ConsentPreference() {
  const [required, setRequired] = useState(false);
  const [choice, setChoice] = useState<ConsentChoice | null>(null);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      setRequired(readCookie(CONSENT_REQUIRED_COOKIE) === "1");
      setChoice(parseConsentChoice(readCookie(CONSENT_COOKIE)));
    });
    return () => cancelAnimationFrame(id);
  }, []);

  if (!required) return null;

  const set = (next: ConsentChoice) => {
    document.cookie = `${CONSENT_COOKIE}=${next}; Max-Age=${CONSENT_MAX_AGE_SECONDS}; Path=/; SameSite=Lax; Secure`;
    applyConsent(next);
    setChoice(next);
  };

  return (
    <div className="stack">
      <h4>Cookies and measurement</h4>
      <p>
        FloatAlpha uses cookies and similar technologies for analytics,
        advertising measurement and ads personalization. Google may use this
        data as described in{" "}
        <a href={GOOGLE_PARTNER_SITES_URL} target="_blank" rel="noreferrer">
          how Google uses data from sites that use its services
        </a>
        .
      </p>
      <p role="status">
        {choice === "granted"
          ? "You accepted. Measurement cookies are in use."
          : choice === "denied"
            ? "You rejected. No advertising or analytics cookies are stored."
            : "You have not chosen yet."}
      </p>
      <div className="row">
        <Button type="button" disabled={choice === "granted"} onClick={() => set("granted")}>
          Accept
        </Button>
        <Button type="button" disabled={choice === "denied"} onClick={() => set("denied")}>
          Reject
        </Button>
      </div>
    </div>
  );
}
