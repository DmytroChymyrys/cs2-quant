"use client";
import { useEffect, useRef } from "react";
import { track } from "@/lib/ga";

/** How recently the profile must have been created to count as this signup. */
const FIRST_LOAD_WINDOW_MS = 10 * 60_000;

/**
 * Reports a registration that actually completed.
 *
 * Distinct from `preview_signup_started`, which fires on the attempt. Email
 * signup requires verification, so an account can exist while registration is
 * not complete; counting the attempt would overstate conversion by everyone
 * who never opens the mail. The pair gives a real completion rate.
 *
 * Fires on the first authenticated load of a verified account. The profile row
 * is written on the first authenticated request, so a profile created moments
 * ago identifies that load; a later visit has an older profile and is silent.
 *
 * The freshness comparison lives here rather than in the page because reading
 * the clock during render is impure — and an effect is where a one-time
 * browser-side report belongs regardless.
 */
export function SignupCompleted({
  profileId,
  profileCreatedAt,
  verified,
}: {
  profileId: string;
  profileCreatedAt: string | Date;
  verified: boolean;
}) {
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current || !verified) return;
    const created =
      typeof profileCreatedAt === "string"
        ? Date.parse(profileCreatedAt)
        : profileCreatedAt.getTime();
    if (!Number.isFinite(created)) return;
    if (Date.now() - created > FIRST_LOAD_WINDOW_MS) return;
    sent.current = true;
    track({ name: "preview_signup_completed" });
  }, [profileId, profileCreatedAt, verified]);
  return null;
}
