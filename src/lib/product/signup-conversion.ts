import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { productDatabase } from "./db";
import { appUsers } from "./schema";
import type { SignupMethod } from "./schema";

/**
 * The signup conversion: one report per FloatAlpha account, ever.
 *
 * ## What the conversion means
 *
 * A new FloatAlpha account became USABLE. Not a button click, not an OAuth
 * start, not a callback, not a returning login, and not a linked identity.
 *
 * "Usable" is read from account state rather than from email verification. The
 * previous implementation gated on `emailVerified`, which silently excluded
 * every Steam-first signup: Steam supplies no email and `steam.ts` creates those
 * users with `emailVerified: false`. The correct test is that an authenticated
 * session exists at all — `currentUser()` returns null for an unusable account
 * (blocked, soft-deleted), and Better Auth will not issue a session for an
 * unverified email signup because `requireEmailVerification` is on. So reaching
 * an authenticated render IS the proof the account is usable, for every method.
 *
 * ## Why the claim is durable
 *
 * A `useRef` survives a React remount but not a refresh, a second tab, an OAuth
 * callback replay or another device. The claim below is a conditional UPDATE, so
 * exactly one request can win it for a given account, permanently.
 *
 * Trade-off, stated rather than hidden: the claim is consumed when the server
 * decides to report, and the browser emits a moment later. If the tab is closed
 * in that window, or scripts are blocked, the conversion is lost. This is
 * therefore AT MOST ONCE, chosen deliberately over a design that could
 * double-count. Over-reporting corrupts the Ads optimisation signal; a rare
 * under-report only loses one data point.
 */

/**
 * How recently the account must have been created for this to be its signup.
 *
 * A guard against a stale row ever being reported as a fresh conversion — for
 * example after a backfill that cleared the column. The durable claim is what
 * makes it once; this makes it once AND recent.
 */
export const SIGNUP_CONVERSION_WINDOW_MS = 30 * 60_000;

export type SignupConversion = {
  /** GA4 `method`, derived from recorded provenance. Never an identifier. */
  method: "google" | "email" | "steam" | "unknown";
};

/** Recorded provenance -> the GA4 method vocabulary. */
export function conversionMethod(
  signupMethod: SignupMethod | null,
): SignupConversion["method"] {
  switch (signupMethod) {
    case "GOOGLE":
      return "google";
    case "EMAIL":
      return "email";
    case "STEAM":
      return "steam";
    default:
      // UNKNOWN provenance is reported as unknown rather than guessed. A method
      // inferred from whichever identity sorts first would be worse than absent.
      return "unknown";
  }
}

/**
 * Claims the right to report this account's signup, atomically.
 *
 * Returns the conversion exactly once per account, across every request, tab,
 * device and replay. Every later call returns null.
 *
 * Callers must already hold an authenticated session for `appUserId`; this
 * performs no authorisation of its own and is never reachable from a route that
 * accepts a user id from a client.
 */
export async function claimSignupConversion(
  input: {
    appUserId: string;
    createdAt: Date | string;
    signupMethod: SignupMethod | null;
  },
  db = productDatabase(),
  now: Date = new Date(),
  windowMs: number = SIGNUP_CONVERSION_WINDOW_MS,
): Promise<SignupConversion | null> {
  const created =
    typeof input.createdAt === "string"
      ? Date.parse(input.createdAt)
      : input.createdAt.getTime();
  if (!Number.isFinite(created)) return null;

  /*
   * Cheap rejection first. Without it every authenticated page view of every
   * established account would issue a write that can never succeed; with it the
   * database is touched only during the half hour after an account is created.
   */
  if (now.getTime() - created > windowMs) return null;

  const claimed = await db
    .update(appUsers)
    .set({ signupReportedAt: sql`now()` })
    .where(
      and(eq(appUsers.id, input.appUserId), isNull(appUsers.signupReportedAt)),
    )
    .returning({ id: appUsers.id });

  if (claimed.length !== 1) return null;
  return { method: conversionMethod(input.signupMethod) };
}
