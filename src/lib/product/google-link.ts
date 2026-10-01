import { randomBytes } from "node:crypto";
import type { BetterAuthPlugin } from "better-auth";
import {
  APIError,
  createAuthEndpoint,
  freshSessionMiddleware,
  getAuthoritativeSessionFromCtx,
  sensitiveSessionMiddleware,
} from "better-auth/api";
import { setTokenUtil } from "better-auth/oauth2";
import { z } from "zod";

/**
 * Explicit "Connect Google", owned by FloatAlpha.
 *
 * WHY THIS IS NOT `linkSocialAccount`
 * -----------------------------------
 * Better Auth 1.7.3 refuses to link a social account unless the provider's
 * email matches the LOCAL one, and reads the local address before it consults
 * `accountLinking.allowDifferentEmails`:
 *
 *   account.mjs:211   linkingUserInfo.user.email?.toLowerCase() !== session.user.email.toLowerCase() && ...allowDifferentEmails !== true
 *   callback.mjs:177  userInfo.email?.toLowerCase()             !== link.email.toLowerCase()         && ...allowDifferentEmails !== true
 *
 * The provider side is optional-chained; the local side is not. A Steam-created
 * user has `auth_users.email = NULL` by design -- Steam OpenID supplies no
 * verified address and we refuse to invent one -- so that expression throws
 * `Cannot read properties of null (reading 'toLowerCase')`. `&&` evaluates its
 * left operand first, so setting `allowDifferentEmails` cannot prevent it: the
 * option lives in the right operand and is never reached. Verified by executing
 * the expression, not by reading it.
 *
 * So this endpoint performs the handshake itself, using Better Auth's OWN
 * configured Google provider for every part that is Google's semantics --
 * authorization URL, PKCE, code exchange, user info, and the stable account
 * subject -- and owns only the authorization decision. The resulting
 * auth_accounts row is built from the same tokens the native callback stores,
 * so ordinary Google sign-in afterwards resolves it through `findAccountByKey`
 * exactly as if Better Auth had written it.
 *
 * Do NOT "simplify" this back to `linkSocialAccount`. It reintroduces the
 * NULL-email crash, and it reintroduces email equality as an authorization
 * input, which it must never be.
 *
 * WHAT AUTHORIZES A LINK
 * ----------------------
 *   control of an authenticated FloatAlpha session
 *   + fresh proof of control of the Google identity
 *   + that identity being unowned, or already owned by this same user
 *
 * Email equality is not part of that decision. Email inequality does not refuse
 * it. A NULL local email does not refuse it. The global uniqueness of
 * (provider_id, account_id) is the final arbiter, and the database enforces it.
 *
 * This is the same shape as the Steam plugin next door, which is already in
 * production: verify the identity ourselves, then attach it through the
 * adapter. Nothing here patches or reaches into Better Auth internals.
 */

const flowSchema = z.enum(["settings", "onboarding"]);
const ttl = 600;
const LINK_COOKIE = "google_link";
const linkIdentifier = (state: string) => `google-link:${state}`;

/*
 * The intent lives INSIDE the server-side record, not only in the cookie name,
 * and is checked after the record is consumed. A forged or replayed cookie
 * still cannot turn some other challenge into a LINK.
 */
const stateSchema = z.object({
  intent: z.literal("LINK"),
  userId: z.string(),
  sessionId: z.string(),
  flow: flowSchema,
  codeVerifier: z.string().min(43).max(128),
});

const freshState = () => randomBytes(32).toString("hex");
const isState = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
/** RFC 7636: 43-128 characters from the unreserved set. */
const freshVerifier = () => randomBytes(32).toString("base64url");
const destination = (flow: "settings" | "onboarding", status: string) =>
  `/${flow}?google=${status}#connected-accounts`;

export const googleLinkingEnabled = () =>
  Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) &&
  process.env.FLOATALPHA_DEMO_PREVIEW !== "true";

/** Every Google identity attached to a user, newest last. */
export async function googleConnections(userId: string) {
  const { productDatabase } = await import("./db");
  const { authAccount } = await import("./schema");
  const { and, eq, asc } = await import("drizzle-orm");
  const rows = await productDatabase()
    .select({
      id: authAccount.id,
      subject: authAccount.accountId,
      connectedAt: authAccount.createdAt,
    })
    .from(authAccount)
    .where(
      and(eq(authAccount.userId, userId), eq(authAccount.providerId, "google")),
    )
    .orderBy(asc(authAccount.createdAt));
  return rows.map((r) => ({ ...r, connectedAt: r.connectedAt.toISOString() }));
}

export function googleAccountLinking() {
  return {
    id: "google-account-linking",
    rateLimit: [
      {
        pathMatcher: (path: string) => path.startsWith("/google/link"),
        window: 60,
        max: 10,
      },
    ],
    endpoints: {
      /**
       * Begins an explicit connect from an authenticated, FRESH session.
       *
       * Freshness matters here specifically: without it a long-lived background
       * session in the same browser could absorb a Google identity the person
       * did not mean to attach to THIS account.
       */
      linkGoogle: createAuthEndpoint(
        "/google/link",
        {
          method: "POST",
          requireHeaders: true,
          body: z.object({ flow: flowSchema.default("settings") }),
          use: [sensitiveSessionMiddleware, freshSessionMiddleware],
        },
        async (ctx) => {
          if (!googleLinkingEnabled())
            throw new APIError("SERVICE_UNAVAILABLE", {
              code: "GOOGLE_UNAVAILABLE",
              message: "Connecting Google is not available right now.",
            });
          if (ctx.headers?.get("origin") !== new URL(ctx.context.baseURL).origin)
            throw new APIError("FORBIDDEN", { message: "Invalid request origin." });
          const provider = ctx.context.socialProviders.find(
            (p) => p.id === "google",
          );
          if (!provider)
            throw new APIError("SERVICE_UNAVAILABLE", {
              code: "GOOGLE_UNAVAILABLE",
              message: "Connecting Google is not available right now.",
            });
          const session = ctx.context.session;
          await ctx.context.adapter.deleteMany({
            model: "verification",
            where: [
              { field: "identifier", operator: "starts_with", value: "google-link:" },
              { field: "expiresAt", operator: "lt", value: new Date() },
            ],
          });
          const cookie = ctx.context.createAuthCookie(LINK_COOKIE, {
            maxAge: ttl,
            sameSite: "lax",
            httpOnly: true,
          });
          // A second click replaces the first challenge rather than leaving a
          // usable one behind.
          const previous = await ctx.getSignedCookie(
            cookie.name,
            ctx.context.secret,
          );
          if (isState(previous))
            await ctx.context.internalAdapter.deleteVerificationByIdentifier(
              linkIdentifier(previous),
            );
          const state = freshState();
          const codeVerifier = freshVerifier();
          await ctx.context.internalAdapter.createVerificationValue({
            identifier: linkIdentifier(state),
            value: JSON.stringify({
              intent: "LINK",
              userId: session.user.id,
              sessionId: session.session.id,
              flow: ctx.body.flow,
              codeVerifier,
            }),
            expiresAt: new Date(Date.now() + ttl * 1000),
          });
          await ctx.setSignedCookie(
            cookie.name,
            state,
            ctx.context.secret,
            cookie.attributes,
          );
          const url = await provider.createAuthorizationURL({
            state,
            codeVerifier,
            redirectURI: `${ctx.context.baseURL}/google/link/callback`,
          });
          /*
           * `prompt=select_account` arrives from the provider configuration in
           * auth.ts, which applies it to sign-in and to connecting alike, and
           * it is asserted on this URL by its own test.
           *
           * Deliberately NOT set a second time here. It would be invisible
           * belt-and-braces -- the configured value already wins, so a
           * divergence between the two could not be observed until it mattered
           * -- and connecting a second Google identity is the case that needs
           * the chooser most, so it should fail loudly with everything else
           * rather than quietly carry its own copy.
           */
          return ctx.json({ url: url.toString() });
        },
      ),

      googleLinkCallback: createAuthEndpoint(
        "/google/link/callback",
        { method: "GET", requireHeaders: true },
        async (ctx) => {
          let flow: "settings" | "onboarding" = "settings";
          let status = "failed";
          try {
            if (!ctx.request || !googleLinkingEnabled()) throw Error();
            const url = new URL(ctx.request.url);
            const state = url.searchParams.get("state");
            if (!isState(state) || url.searchParams.getAll("state").length !== 1)
              throw Error();

            // Browser binding: only the browser that began this may finish it.
            const cookie = ctx.context.createAuthCookie(LINK_COOKIE);
            const browserState = await ctx.getSignedCookie(
              cookie.name,
              ctx.context.secret,
            );
            if (browserState !== state) throw Error();
            ctx.setCookie(cookie.name, "", { ...cookie.attributes, maxAge: 0 });

            // Single use: consumed atomically, so a replayed callback finds
            // nothing and a concurrent one loses the race.
            const record =
              await ctx.context.internalAdapter.consumeVerificationValue(
                linkIdentifier(state),
              );
            if (!record) throw Error();
            const saved = stateSchema.parse(JSON.parse(record.value));
            flow = saved.flow;

            // Declining at Google is a decision, not a failure.
            if (url.searchParams.get("error")) {
              status = "cancelled";
              throw new Done();
            }
            const code = url.searchParams.get("code");
            if (!code) throw Error();

            /*
             * The SAME session that began this must still be the one here --
             * user and session both. Signing out and in again mid-flow
             * produces a different session id and is refused.
             */
            const session = await getAuthoritativeSessionFromCtx(ctx);
            if (
              !session ||
              session.user.id !== saved.userId ||
              session.session.id !== saved.sessionId
            )
              throw Error();

            const provider = ctx.context.socialProviders.find(
              (p) => p.id === "google",
            );
            if (!provider) throw Error();
            const redirectURI = `${ctx.context.baseURL}/google/link/callback`;
            // Google's own semantics, via Better Auth's own provider.
            const tokens = await provider.validateAuthorizationCode({
              code,
              codeVerifier: saved.codeVerifier,
              redirectURI,
            });
            if (!tokens) throw Error();
            const info = await provider.getUserInfo(tokens);
            if (!info?.user) throw Error();
            const accountId = String(
              await provider.accountSubject({ tokens, profile: info.data }),
            );
            if (!accountId || accountId === "undefined" || accountId === "null")
              throw Error();

            /*
             * The ownership decision. Note what is NOT consulted: the Google
             * account's email address, and the local user's email address.
             * Neither authorizes nor refuses anything here.
             */
            const adapter = ctx.context.internalAdapter;
            const owner = await adapter.findAccountByKey({
              providerId: "google",
              accountId,
            });
            if (owner) {
              // Already ours: idempotent, and no duplicate row is inserted.
              status = owner.userId === saved.userId ? "connected" : "conflict";
              throw new Done();
            }
            try {
              await adapter.linkAccount({
                providerId: "google",
                accountId,
                userId: saved.userId,
                // Exactly what the native callback persists, so a later
                // ordinary Google sign-in finds a complete row.
                accessToken: await setTokenUtil(tokens.accessToken, ctx.context),
                refreshToken: await setTokenUtil(
                  tokens.refreshToken,
                  ctx.context,
                ),
                idToken: tokens.idToken,
                accessTokenExpiresAt: tokens.accessTokenExpiresAt,
                refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
                scope: tokens.scopes?.join(","),
              });
              status = "connected";
            } catch {
              /*
               * The database arbitrates concurrency. Never reassign a row after
               * a collision: re-read and report who actually owns it.
               */
              const winner = await adapter.findAccountByKey({
                providerId: "google",
                accountId,
              });
              status =
                winner?.userId === saved.userId
                  ? "connected"
                  : winner
                    ? "conflict"
                    : "failed";
            }
          } catch (error) {
            // A decided outcome carries its own status through unchanged.
            if (!(error instanceof Done)) status = "failed";
            // Never log authorization codes, tokens, state or cookies.
          }
          throw ctx.redirect(destination(flow, status));
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}

/** Unwinds to the single redirect without being rewritten as a failure. */
class Done extends Error {}
