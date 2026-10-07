"use client";
import { useEffect, useRef } from "react";
import { track } from "@/lib/ga";

/**
 * Emits the signup conversion the server has already claimed.
 *
 * The ref guards React StrictMode's double invocation within one mount. It is
 * NOT what makes the conversion unique — the database claim is. This component
 * only renders at all when the server won that claim, so it cannot be the thing
 * that decides.
 *
 * `preview_signup_completed` is emitted alongside purely so the existing GA4
 * series stays unbroken. Only ONE of the two may ever be a Google Ads
 * conversion; see the note in ga.ts.
 */
export function SignupConversionEmitter({
  method,
  campaign,
}: {
  method: "google" | "email" | "steam" | "unknown";
  campaign: {
    campaign_source?: string;
    campaign_medium?: string;
    campaign_name?: string;
  };
}) {
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    track({ name: "sign_up", params: { method, ...campaign } });
    track({ name: "preview_signup_completed" });
  }, [method, campaign]);
  return null;
}
