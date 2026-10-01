import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { captcha } from "better-auth/plugins";
import { headers } from "next/headers";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { productDatabase } from "./db";
import {
  authUser,
  authSession,
  authAccount,
  authVerification,
  authRateLimit,
  appUsers,
  subscriptions,
} from "./schema";
import { sendEmail, emailConfigured } from "./email";
import { billingSandboxEnabled } from "./billing-config";
import { steamAccountLinking, steamConnectionEnabled } from "./steam";
import { googleAccountLinking, googleLinkingEnabled } from "./google-link";
import {
  signupMethodForRequest,
  signupMethodFromAccounts,
} from "./signup-method";
export function authConfiguration() {
  const configured = Boolean(
    process.env.BETTER_AUTH_SECRET &&
    process.env.BETTER_AUTH_SECRET.length >= 32 &&
    process.env.BETTER_AUTH_URL &&
    (process.env.PRODUCT_DATABASE_URL || process.env.DATABASE_URL),
  );
  return {
    billingSandbox: billingSandboxEnabled(),
    configured,
    email: configured && emailConfigured(),
    google:
      configured &&
      Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    // Steam sign-in rides the same flag as Steam linking: one feature, one
    // switch, so the button cannot appear while the endpoints refuse.
    steam: configured && steamConnectionEnabled(),
    // Explicit "Connect Google" is a linking capability, separate from Google
    // sign-in: a deployment can have Google auth working while this is off.
    googleLink: configured && googleLinkingEnabled(),
    turnstileSiteKey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? null,
  };
}
export function authService() {
  if (!authConfiguration().configured) return null;
  return betterAuth({
    appName: "FloatAlpha",
    baseURL: process.env.BETTER_AUTH_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(productDatabase(), {
      provider: "pg",
      transaction: true,
      schema: {
        user: authUser,
        session: authSession,
        account: authAccount,
        verification: authVerification,
        rateLimit: authRateLimit,
      },
    }),
    advanced: { database: { generateId: "uuid" } },
    /*
     * Where a failed social callback lands.
     *
     * Set on the SERVER rather than passed as `errorCallbackURL` by each
     * caller, so no client can forget it and drop somebody on Better Auth's
     * bare /api/auth/error page. The login page reads the `error` parameter and
     * explains what to do next.
     */
    onAPIError: { errorURL: "/login" },
    session: { freshAge: 300 },
    account: {
      accountLinking: {
        /*
         * Matching email addresses must never attach a new provider identity to
         * an existing account on their own.
         *
         * Without this, an unknown Google identity whose address happens to
         * equal a registered one is silently absorbed into that account. The
         * address is a claim made by a provider about a person; it is not proof
         * that the person at the keyboard controls the FloatAlpha account.
         *
         * Linking is therefore only ever explicit: an authenticated session
         * plus fresh proof of the provider identity, which is what
         * `google-link.ts` and `steam.ts` implement.
         *
         * `allowDifferentEmails` is deliberately NOT set. Our explicit path
         * does not use Better Auth's email-comparison linking at all, so
         * setting it would be inoperative configuration that implies the
         * native path is in use. See the header of google-link.ts.
         */
        disableImplicitLinking: true,
      },
    },
    databaseHooks: {
      user: {
        create: {
          /*
           * The profile row is created here, with the signup method the
           * CREATING ENDPOINT declares, rather than being inferred later from
           * whatever identities the account has accumulated.
           *
           * currentUser() still provisions a profile for any user row that
           * reaches it without one, so a failure here costs provenance, never
           * access.
           */
          after: async (user, context) => {
            await productDatabase()
              .insert(appUsers)
              .values({
                authUserId: user.id,
                signupMethod: signupMethodForRequest({
                  path: context?.path,
                  params: context?.params as
                    | Record<string, string | undefined>
                    | undefined,
                  body: context?.body as Record<string, unknown> | undefined,
                }),
              })
              .onConflictDoNothing();
          },
        },
      },
    },
    user: {
      deleteUser: {
        enabled: true,
        beforeDelete: async (user) => {
          const profile = (
            await productDatabase()
              .select()
              .from(appUsers)
              .where(eq(appUsers.authUserId, user.id))
          )[0];
          if (profile) {
            const billing = (
              await productDatabase()
                .select()
                .from(subscriptions)
                .where(eq(subscriptions.userId, profile.id))
            )[0];
            if (
              billing &&
              !["none", "canceled", "incomplete_expired"].includes(
                billing.status,
              )
            )
              throw new APIError("FORBIDDEN", {
                message:
                  "Cancel your subscription in the billing portal before deleting your account.",
              });
          }
        },
      },
    },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 50 },
    emailAndPassword: {
      enabled: emailConfigured(),
      requireEmailVerification: true,
      sendResetPassword: async ({ user, url }) => {
        await sendEmail(
          user.email,
          "Reset your FloatAlpha password",
          `Reset your password: ${url}`,
        );
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendEmail(
          user.email,
          "Verify your FloatAlpha email",
          `Verify your email address: ${url}`,
        );
      },
    },
    socialProviders:
      process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: process.env.GOOGLE_CLIENT_ID,
              clientSecret: process.env.GOOGLE_CLIENT_SECRET,
              /*
               * Always let the person choose which Google account to use.
               *
               * This is UX protection against selecting the wrong identity, NOT
               * an authorization mechanism. What authorizes anything is the
               * provider subject Google returns, verified through the code
               * exchange; the chooser cannot grant or withhold access and a
               * caller that suppressed it would gain nothing.
               *
               * It is here because of a real incident: a browser silently
               * reused a signed-in Google session during ordinary sign-in, and
               * a second FloatAlpha account was created for an identity the
               * person did not intend to use. Seeing the account before
               * committing is what prevents that, and it costs one click.
               */
              prompt: "select_account",
            },
          }
        : {},
    plugins: [
      steamAccountLinking(),
      googleAccountLinking(),
      ...(process.env.TURNSTILE_SECRET_KEY
        ? [
            captcha({
              provider: "cloudflare-turnstile",
              secretKey: process.env.TURNSTILE_SECRET_KEY,
            }),
          ]
        : []),
    ],
  });
}
export const currentUser = cache(async () => {
  const auth = authService();
  if (!auth) return null;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const db = productDatabase();
  let user = (
    await db
      .select()
      .from(appUsers)
      .where(eq(appUsers.authUserId, session.user.id))
  )[0];
  if (!user) {
    /*
     * A user row with no profile: legacy accounts, and any case where the
     * creation hook did not run. The signup method is taken from the identities
     * the account holds, and ONLY when there is exactly one, which is one
     * unambiguous answer. More than one means linking has already happened and
     * the original method is no longer recoverable here, so it stays UNKNOWN
     * rather than being guessed from whichever row sorts first.
     */
    const accounts = await db
      .select({ providerId: authAccount.providerId })
      .from(authAccount)
      .where(eq(authAccount.userId, session.user.id));
    await db
      .insert(appUsers)
      .values({
        authUserId: session.user.id,
        signupMethod: signupMethodFromAccounts(accounts),
      })
      .onConflictDoNothing();
    user = (
      await db
        .select()
        .from(appUsers)
        .where(eq(appUsers.authUserId, session.user.id))
    )[0];
  }
  /*
   * Blocked and soft-deleted accounts are denied here rather than at sign-in.
   * Every authenticated surface reads through currentUser(), so this is the
   * one place that cannot be bypassed — an admin can block someone mid-session
   * and the next request already treats them as signed out, without waiting
   * for a token to expire.
   *
   * Returning null rather than throwing keeps the caller contract: pages
   * already render their signed-out state for a null user.
   */
  if (user?.blockedAt || user?.deletedAt) return null;
  return { app: user, identity: session.user, session: session.session };
});
