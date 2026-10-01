import type { SignupMethod } from "./schema";

/**
 * How an account came into existence -- decided at creation, never inferred later.
 *
 * Two rules, and the difference between them matters:
 *
 *   signupMethodForRequest  what the creating endpoint DECLARES. Derived from
 *                           the route the creation arrived on, which is a fact
 *                           about the request, not a reading of the data.
 *
 *   signupMethodFromAccounts  a fallback for a user row that reached us with no
 *                             profile yet. It answers only when the account set
 *                             admits exactly one answer, and says UNKNOWN
 *                             otherwise.
 *
 * Neither uses timing. Timing evidence appears once, in the 0006 migration, for
 * rows written before this column existed and for which nothing else survives.
 * Applying it to new accounts would be guessing where an answer is available.
 */

const PROVIDER_METHOD: Record<string, SignupMethod> = {
  credential: "EMAIL",
  google: "GOOGLE",
  steam: "STEAM",
};

/** Maps a Better Auth provider id onto a signup method, or UNKNOWN. */
export const methodForProvider = (providerId: string): SignupMethod =>
  PROVIDER_METHOD[providerId] ?? "UNKNOWN";

/**
 * The method declared by the endpoint that is creating this user.
 *
 * `/callback/:id` and `/sign-in/social` are the two ways a social signup
 * arrives; `/steam/create-account` is ours. Anything else -- an administrative
 * creation, a provider we have not mapped, a future route -- is UNKNOWN rather
 * than a best guess, because this value is read as acquisition data.
 */
export function signupMethodForRequest(request: {
  path?: string;
  params?: Record<string, string | undefined>;
  body?: Record<string, unknown>;
}): SignupMethod {
  const path = request.path ?? "";
  if (path === "/sign-up/email") return "EMAIL";
  if (path === "/steam/create-account") return "STEAM";
  if (path.startsWith("/callback/"))
    return methodForProvider(
      request.params?.id ?? path.slice("/callback/".length),
    );
  if (path === "/sign-in/social" || path === "/sign-in/oauth2") {
    const provider = request.body?.provider ?? request.body?.providerId;
    return typeof provider === "string" ? methodForProvider(provider) : "UNKNOWN";
  }
  return "UNKNOWN";
}

/**
 * The method implied by the identities a user already holds.
 *
 * Used only when provisioning a profile for a user row that does not have one,
 * which is the legacy and repair path. One identity is one unambiguous answer.
 * Two or more means the account has already been linked and the original
 * method is no longer recoverable from this table -- so it says so.
 */
export function signupMethodFromAccounts(
  accounts: readonly { providerId: string }[],
): SignupMethod {
  if (accounts.length !== 1) return "UNKNOWN";
  return methodForProvider(accounts[0].providerId);
}
