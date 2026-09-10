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
export function authConfiguration() {
  const configured = Boolean(
    process.env.BETTER_AUTH_SECRET &&
    process.env.BETTER_AUTH_SECRET.length >= 32 &&
    process.env.BETTER_AUTH_URL &&
    (process.env.PRODUCT_DATABASE_URL || process.env.DATABASE_URL),
  );
  return {
    configured,
    email: configured && emailConfigured(),
    google:
      configured &&
      Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
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
    session: { freshAge: 300 },
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
            },
          }
        : {},
    plugins: process.env.TURNSTILE_SECRET_KEY
      ? [
          captcha({
            provider: "cloudflare-turnstile",
            secretKey: process.env.TURNSTILE_SECRET_KEY,
          }),
        ]
      : [],
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
    await db
      .insert(appUsers)
      .values({ authUserId: session.user.id })
      .onConflictDoNothing();
    user = (
      await db
        .select()
        .from(appUsers)
        .where(eq(appUsers.authUserId, session.user.id))
    )[0];
  }
  return { app: user, identity: session.user, session: session.session };
});
