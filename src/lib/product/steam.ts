import { createHash, randomBytes } from "node:crypto";
import type { BetterAuthPlugin } from "better-auth";
import type { GenericEndpointContext } from "@better-auth/core";
import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
  freshSessionMiddleware,
  getAuthoritativeSessionFromCtx,
  sensitiveSessionMiddleware,
} from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { productDatabase } from "./db";
import { authAccount } from "./schema";
import {
  steamAuthorizationURL,
  steamCallbackRequestURL,
  verifySteamAssertion,
} from "./steam-openid";

const flowSchema = z.enum(["settings", "onboarding"]);
const stateSchema = z.object({
  userId: z.string(),
  sessionId: z.string(),
  flow: flowSchema,
});
const ttl = 600;
const identifier = (state: string) => `steam-link:${state}`;

/*
 * AUTH and LINK are the same protocol used for different reasons, so they are
 * kept apart by construction rather than by a parameter:
 *
 *   - different cookie names, so a browser holding one cannot present the
 *     other;
 *   - different verification identifiers, so a state issued for one is simply
 *     not found when looked up as the other;
 *   - the intent stored server-side inside the record, checked after it is
 *     consumed, so even a forged cookie cannot cross the boundary.
 *
 * LINK binds the initiating authenticated user and session. AUTH has neither
 * and must not pretend to: its protection is the single-use challenge itself.
 */
const LINK_COOKIE = "steam_link";
const AUTH_COOKIE = "steam_auth";
const PENDING_COOKIE = "steam_pending";
const authIdentifier = (state: string) => `steam-auth:${state}`;
const pendingIdentifier = (token: string) => `steam-pending:${token}`;
const authStateSchema = z.object({ intent: z.literal("AUTH"), issuedAt: z.number() });
const pendingSchema = z.object({
  intent: z.literal("AUTH"),
  steamId: z.string().regex(/^\d{17}$/),
  issuedAt: z.number(),
});

/**
 * An internal destination the AUTH branch has decided on.
 *
 * Thrown rather than returned so it unwinds past the shared failure handler
 * below without being rewritten into a generic `failed` redirect: these are
 * successful outcomes that simply are not the LINK outcome.
 */
class SteamRedirect extends Error {
  constructor(readonly to: string) {
    super("STEAM_REDIRECT");
  }
}

/** A 64-hex value, the only shape any of these states may take. */
const freshState = () => randomBytes(32).toString("hex");
const isState = (v: string | null): v is string => !!v && /^[a-f0-9]{64}$/.test(v);
const destination = (flow: "settings" | "onboarding", status: string) =>
  `/${flow}?steam=${status}#connected-accounts`;

export const steamConnectionEnabled = () =>
  process.env.STEAM_ACCOUNT_LINKING_ENABLED === "true" &&
  process.env.FLOATALPHA_DEMO_PREVIEW !== "true";

export async function steamConnection(userId: string) {
  const [account] = await productDatabase()
    .select({
      id: authAccount.id,
      steamId: authAccount.accountId,
      connectedAt: authAccount.createdAt,
    })
    .from(authAccount)
    .where(
      and(eq(authAccount.userId, userId), eq(authAccount.providerId, "steam")),
    );
  return account
    ? { ...account, connectedAt: account.connectedAt.toISOString() }
    : null;
}

// OpenID 2.0 is isolated behind Better Auth's existing session/account abstraction.
// This provider links identities only: it never creates users, sessions or emails.
/**
 * Consumes the pending Steam identity, atomically and once.
 *
 * The browser must present the signed cookie it was given, so a pending
 * identity cannot be completed from anywhere else, and the record's own
 * intent is checked after consumption so an AUTH challenge can never be
 * replayed here as something else.
 */
async function consumePending(ctx: GenericEndpointContext): Promise<string> {
  const cookie = ctx.context.createAuthCookie(PENDING_COOKIE);
  const token = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
  // Cleared whatever happens, so a failed attempt cannot be retried from it.
  ctx.setCookie(cookie.name, "", { ...cookie.attributes, maxAge: 0 });
  if (!isState(typeof token === "string" ? token : null))
    throw new APIError("BAD_REQUEST", {
      code: "STEAM_PENDING_MISSING",
      message: "That Steam verification has expired. Start again.",
    });
  const record = await ctx.context.internalAdapter.consumeVerificationValue(
    pendingIdentifier(token as string),
  );
  if (!record)
    throw new APIError("BAD_REQUEST", {
      code: "STEAM_PENDING_MISSING",
      message: "That Steam verification has expired. Start again.",
    });
  return pendingSchema.parse(JSON.parse(record.value)).steamId;
}

/** Signs a user in using Better Auth's own session primitives. */
async function signIn(ctx: GenericEndpointContext, userId: string) {
  const session = await ctx.context.internalAdapter.createSession(userId, false);
  const user = await ctx.context.internalAdapter.findUserById(userId);
  if (!user)
    throw new APIError("INTERNAL_SERVER_ERROR", { code: "STEAM_SIGNIN_FAILED" });
  // Better Auth's own primitive: a fresh session record and its signed cookie.
  await setSessionCookie(ctx, { session, user });
  return { url: "/continue" };
}

export function steamAccountLinking() {
  return {
    id: "steam-account-linking",
    rateLimit: [
      {
        pathMatcher: (path: string) => path.startsWith("/steam/"),
        window: 60,
        max: 10,
      },
    ],
    hooks: {
      before: [
        {
          matcher: (ctx) => ctx.path === "/unlink-account",
          handler: createAuthMiddleware(async (ctx) => {
            // A link-only identity must not count as a usable login/recovery method.
            const session = await getAuthoritativeSessionFromCtx(ctx);
            if (!session) return;
            const accounts = await ctx.context.internalAdapter.findAccounts(
              session.user.id,
            );
            const target = accounts.find((a) => a.id === ctx.body?.accountId);
            if (
              accounts.some((a) => a.providerId === "steam") &&
              target &&
              target.providerId !== "steam" &&
              accounts.filter((a) => a.providerId !== "steam").length === 1
            ) {
              throw new APIError("BAD_REQUEST", {
                code: "LAST_LOGIN_METHOD",
                message:
                  "Keep an email or other primary login method connected.",
              });
            }
            /*
             * Steam sign-in makes a Steam-only account possible, so Steam
             * itself can now be the last usable method. Removing it would
             * leave an account nobody can ever sign in to -- there is no
             * email address to recover with either, because Steam supplies
             * none.
             *
             * Adding Google or a password makes Steam removable again under
             * the normal rule above; nothing here is permanent.
             */
            if (
              target &&
              target.providerId === "steam" &&
              accounts.filter((a) => a.providerId !== "steam").length === 0
            ) {
              throw new APIError("BAD_REQUEST", {
                code: "ONLY_LOGIN_METHOD",
                message:
                  "Steam is the only way to sign in to this account. Add an email password or Google first.",
              });
            }
          }),
        },
      ],
    },
    endpoints: {
      linkSteam: createAuthEndpoint(
        "/steam/link",
        {
          method: "POST",
          requireHeaders: true,
          body: z.object({ flow: flowSchema.default("settings") }),
          use: [sensitiveSessionMiddleware, freshSessionMiddleware],
        },
        async (ctx) => {
          if (!steamConnectionEnabled())
            throw new APIError("SERVICE_UNAVAILABLE", {
              code: "STEAM_UNAVAILABLE",
              message: "Steam connection is not available right now.",
            });
          if (
            ctx.headers?.get("origin") !== new URL(ctx.context.baseURL).origin
          )
            throw new APIError("FORBIDDEN", {
              message: "Invalid request origin.",
            });
          const session = ctx.context.session;
          await ctx.context.adapter.deleteMany({
            model: "verification",
            where: [
              { field: "identifier", operator: "starts_with", value: "steam-" },
              { field: "expiresAt", operator: "lt", value: new Date() },
            ],
          });
          const accounts = await ctx.context.internalAdapter.findAccounts(
            session.user.id,
          );
          if (accounts.some((a) => a.providerId === "steam"))
            return ctx.json({ url: destination(ctx.body.flow, "connected") });
          const cookie = ctx.context.createAuthCookie("steam_link", {
            maxAge: ttl,
            sameSite: "lax",
            httpOnly: true,
          });
          const previous = await ctx.getSignedCookie(
            cookie.name,
            ctx.context.secret,
          );
          if (previous && /^[a-f0-9]{64}$/.test(previous))
            await ctx.context.internalAdapter.deleteVerificationByIdentifier(
              identifier(previous),
            );
          const state = randomBytes(32).toString("hex");
          await ctx.context.internalAdapter.createVerificationValue({
            identifier: identifier(state),
            value: JSON.stringify({
              userId: session.user.id,
              sessionId: session.session.id,
              flow: ctx.body.flow,
            }),
            expiresAt: new Date(Date.now() + ttl * 1000),
          });
          await ctx.setSignedCookie(
            cookie.name,
            state,
            ctx.context.secret,
            cookie.attributes,
          );
          const callback = new URL(`${ctx.context.baseURL}/steam/callback`);
          callback.search = new URLSearchParams({
            state,
            flow: ctx.body.flow,
          }).toString();
          return ctx.json({ url: steamAuthorizationURL(callback.toString()) });
        },
      ),
      /**
       * Starts Steam authentication for a logged-out visitor.
       *
       * Unlike LINK there is no session to bind to, so the protection is the
       * challenge itself: single-use, ten minutes, its intent recorded
       * server-side, and mirrored in a signed HttpOnly cookie so the assertion
       * can only be completed by the browser that asked for it.
       */
      authSteam: createAuthEndpoint(
        "/steam/auth",
        { method: "POST", requireHeaders: true },
        async (ctx) => {
          if (!steamConnectionEnabled())
            throw new APIError("SERVICE_UNAVAILABLE", {
              code: "STEAM_UNAVAILABLE",
              message: "Steam sign-in is not available right now.",
            });
          if (ctx.headers?.get("origin") !== new URL(ctx.context.baseURL).origin)
            throw new APIError("FORBIDDEN", { message: "Invalid request origin." });
          const state = freshState();
          const cookie = ctx.context.createAuthCookie(AUTH_COOKIE, {
            maxAge: ttl,
            sameSite: "lax",
            httpOnly: true,
          });
          await ctx.context.internalAdapter.createVerificationValue({
            identifier: authIdentifier(state),
            value: JSON.stringify({ intent: "AUTH", issuedAt: Date.now() }),
            expiresAt: new Date(Date.now() + ttl * 1000),
          });
          await ctx.setSignedCookie(
            cookie.name,
            state,
            ctx.context.secret,
            cookie.attributes,
          );
          const authCallback = new URL(`${ctx.context.baseURL}/steam/callback`);
          authCallback.search = new URLSearchParams({ state }).toString();
          return ctx.json({ url: steamAuthorizationURL(authCallback.toString()) });
        },
      ),

      /**
       * "Continue as a new account."
       *
       * Order matters. The pending identity is consumed FIRST, atomically, so
       * a retry or a concurrent click cannot run this twice. Then, if the
       * SteamID has meanwhile been claimed, that owner is simply signed in --
       * which makes a duplicated callback idempotent rather than an error.
       *
       * If attaching the identity fails after the user row exists, the user
       * row is removed again. Leaving it would create an account with no way
       * to sign in, and the SteamID is not consumed either way because the
       * account row is what holds it.
       */
      steamCreateAccount: createAuthEndpoint(
        "/steam/create-account",
        { method: "POST", requireHeaders: true },
        async (ctx) => {
          const steamId = await consumePending(ctx);
          const adapter = ctx.context.internalAdapter;
          const existing = await adapter.findAccountByKey({
            providerId: "steam",
            accountId: steamId,
          });
          if (existing) return ctx.json(await signIn(ctx, existing.userId));
          /*
           * The email key is OMITTED, not set to null. Better Auth validates
           * the field when it is present, so an explicit null is rejected
           * while an absent one leaves the column null — which is exactly
           * what a Steam identity has. No address is invented either way.
           */
          const user = await adapter.createUser(
            { name: "Steam user", emailVerified: false } as never,
            ctx,
          );
          try {
            await adapter.linkAccount({
              providerId: "steam",
              accountId: steamId,
              userId: user.id,
            });
          } catch {
            // Compensate, then defer to whoever won the race.
            await adapter.deleteUser(user.id);
            const winner = await adapter.findAccountByKey({
              providerId: "steam",
              accountId: steamId,
            });
            if (winner) return ctx.json(await signIn(ctx, winner.userId));
            throw new APIError("CONFLICT", {
              code: "STEAM_LINK_FAILED",
              message: "Steam sign-in could not be completed. Try again.",
            });
          }
          return ctx.json(await signIn(ctx, user.id));
        },
      ),

      /**
       * "I already have a FloatAlpha account", after they have signed in.
       *
       * Requires a FRESH session, so a long-lived background session in the
       * same browser cannot silently absorb a verified Steam identity, and
       * refuses outright if that account already has one -- an existing Steam
       * identity is never replaced.
       */
      steamFinishLink: createAuthEndpoint(
        "/steam/finish",
        {
          method: "POST",
          requireHeaders: true,
          use: [sensitiveSessionMiddleware, freshSessionMiddleware],
        },
        async (ctx) => {
          const steamId = await consumePending(ctx);
          const adapter = ctx.context.internalAdapter;
          const userId = ctx.context.session.user.id;
          const already = (await adapter.findAccounts(userId)).find(
            (a) => a.providerId === "steam",
          );
          if (already)
            throw new APIError("CONFLICT", {
              code: "ALREADY_CONNECTED",
              message: "This account already has a Steam identity connected.",
            });
          const owner = await adapter.findAccountByKey({
            providerId: "steam",
            accountId: steamId,
          });
          if (owner)
            throw new APIError("CONFLICT", {
              code: "STEAM_ALREADY_LINKED",
              message: "That Steam identity belongs to another FloatAlpha account.",
            });
          try {
            await adapter.linkAccount({
              providerId: "steam",
              accountId: steamId,
              userId,
            });
          } catch {
            // The database arbitrates; never reassign a row after a collision.
            throw new APIError("CONFLICT", {
              code: "STEAM_ALREADY_LINKED",
              message: "That Steam identity belongs to another FloatAlpha account.",
            });
          }
          return ctx.json({ url: "/settings?steam=connected#connected-accounts" });
        },
      ),

      steamCallback: createAuthEndpoint(
        "/steam/callback",
        {
          method: "GET",
          requireHeaders: true,
        },
        async (ctx) => {
          let flow: "settings" | "onboarding" = "settings";
          let status = "failed";
          try {
            if (!ctx.request || !steamConnectionEnabled()) throw Error();
            const url = steamCallbackRequestURL(
              ctx.request,
              ctx.context.baseURL,
            );
            flow =
              flowSchema.safeParse(url.searchParams.get("flow")).data ??
              "settings";
            const state = url.searchParams.get("state");
            if (
              !state ||
              !/^[a-f0-9]{64}$/.test(state) ||
              url.searchParams.getAll("state").length !== 1
            )
              throw Error();

            /*
             * AUTH first, and only when the browser presents the AUTH cookie.
             * A LINK state cannot reach this branch: its cookie has a
             * different name, its record a different identifier, and the
             * record's own `intent` is checked after consumption. The LINK
             * path below is untouched.
             */
            const authCookie = ctx.context.createAuthCookie(AUTH_COOKIE);
            const authBrowserState = await ctx.getSignedCookie(
              authCookie.name,
              ctx.context.secret,
            );
            if (authBrowserState) {
              ctx.setCookie(authCookie.name, "", {
                ...authCookie.attributes,
                maxAge: 0,
              });
              if (authBrowserState !== state) throw Error();
              const authRecord =
                await ctx.context.internalAdapter.consumeVerificationValue(
                  authIdentifier(state),
                );
              if (!authRecord) throw Error();
              // Server-side intent. A forged cookie still cannot cross over.
              authStateSchema.parse(JSON.parse(authRecord.value));
              // Cancelling on Steam is not a failure; it is a decision.
              if (url.searchParams.get("openid.mode") === "cancel")
                throw new SteamRedirect("/login?steam=cancelled");
              /*
               * The expected return_to must be reconstructed exactly as it was
               * sent, query string included — the assertion is signed over it.
               */
              const authCallback = new URL(
                `${ctx.context.baseURL}/steam/callback`,
              );
              authCallback.search = new URLSearchParams({ state }).toString();
              const { steamId } = await verifySteamAssertion(
                url,
                authCallback.toString(),
              );
              /*
               * An authenticated visitor must not have an identity attached
               * because a browser session happened to exist. Returned safely
               * with an explanation instead; Settings is where linking lives.
               */
              if (await getAuthoritativeSessionFromCtx(ctx))
                throw new SteamRedirect("/settings?steam=already-signed-in#connected-accounts");

              const linked = await ctx.context.internalAdapter.findAccountByKey(
                { providerId: "steam", accountId: steamId },
              );
              if (linked) {
                // Known identity: sign that user in. Repeating this is
                // idempotent -- it creates a session and nothing else.
                const session = await ctx.context.internalAdapter.createSession(
                  linked.userId,
                  false,
                );
                const user = await ctx.context.internalAdapter.findUserById(
                  linked.userId,
                );
                if (!user) throw Error();
                await setSessionCookie(ctx, { session, user });
                throw new SteamRedirect("/continue");
              }

              /*
               * Unlinked. Deliberately NOT auto-created: the SteamID is
               * globally unique, so creating an account here would consume it
               * and leave a user who already has a Google or email account
               * permanently unable to link Steam to it. The choice is theirs.
               */
              const pending = freshState();
              const pendingCookie =
                ctx.context.createAuthCookie(PENDING_COOKIE, {
                  maxAge: ttl,
                  sameSite: "lax",
                  httpOnly: true,
                });
              await ctx.context.internalAdapter.createVerificationValue({
                identifier: pendingIdentifier(pending),
                value: JSON.stringify({
                  intent: "AUTH",
                  steamId,
                  issuedAt: Date.now(),
                }),
                expiresAt: new Date(Date.now() + ttl * 1000),
              });
              await ctx.setSignedCookie(
                pendingCookie.name,
                pending,
                ctx.context.secret,
                pendingCookie.attributes,
              );
              throw new SteamRedirect("/steam/choose");
            }

            const cookie = ctx.context.createAuthCookie("steam_link");
            const browserState = await ctx.getSignedCookie(
              cookie.name,
              ctx.context.secret,
            );
            if (browserState !== state) throw Error();
            ctx.setCookie(cookie.name, "", { ...cookie.attributes, maxAge: 0 });
            const record =
              await ctx.context.internalAdapter.consumeVerificationValue(
                identifier(state),
              );
            if (!record) throw Error();
            const saved = stateSchema.parse(JSON.parse(record.value));
            flow = saved.flow;
            const session = await getAuthoritativeSessionFromCtx(ctx);
            if (
              !session ||
              session.user.id !== saved.userId ||
              session.session.id !== saved.sessionId
            )
              throw Error();
            if (url.searchParams.get("openid.mode") === "cancel") {
              status = "cancelled";
            } else {
              const callback = new URL(`${ctx.context.baseURL}/steam/callback`);
              callback.search = new URLSearchParams({ state, flow }).toString();
              const { steamId, nonce } = await verifySteamAssertion(
                url,
                callback.toString(),
              );
              const stillSignedIn = await getAuthoritativeSessionFromCtx(ctx);
              if (
                !stillSignedIn ||
                stillSignedIn.session.id !== saved.sessionId ||
                stillSignedIn.user.id !== saved.userId
              )
                throw Error();
              // Better Auth's generic reservation helper uses a base64 ID, which
              // this UUID adapter replaces with a random ID. Reserve with a
              // deterministic, UUID-shaped primary key so duplicates really fail.
              const digest = createHash("sha256")
                .update(`steam-nonce:${nonce}`)
                .digest();
              const nonceHash = digest.toString("hex");
              digest[6] = (digest[6] & 0x0f) | 0x50;
              digest[8] = (digest[8] & 0x3f) | 0x80;
              const key = digest.subarray(0, 16).toString("hex");
              const nonceId = `${key.slice(0, 8)}-${key.slice(8, 12)}-${key.slice(12, 16)}-${key.slice(16, 20)}-${key.slice(20)}`;
              await ctx.context.adapter.create({
                model: "verification",
                forceAllowId: true,
                data: {
                  id: nonceId,
                  identifier: `steam-nonce:${nonceHash}`,
                  value: "used",
                  // Retain through the entire accepted nonce window, including
                  // the allowed one-minute provider clock skew.
                  expiresAt: new Date(
                    Math.max(Date.now(), Date.parse(nonce.slice(0, 20))) +
                      ttl * 1000,
                  ),
                  createdAt: new Date(),
                  updatedAt: new Date(),
                },
              });
              const adapter = ctx.context.internalAdapter;
              const owner = await adapter.findAccountByKey({
                providerId: "steam",
                accountId: steamId,
              });
              const existing = (await adapter.findAccounts(saved.userId)).find(
                (a) => a.providerId === "steam",
              );
              if (owner && owner.userId !== saved.userId) status = "conflict";
              else if (existing && existing.accountId !== steamId)
                status = "already-connected";
              else if (owner || existing) status = "connected";
              else {
                try {
                  await adapter.linkAccount({
                    providerId: "steam",
                    accountId: steamId,
                    userId: saved.userId,
                  });
                  status = "connected";
                } catch {
                  // Both DB uniqueness constraints arbitrate concurrent callbacks.
                  // Never update/reassign a row after a collision.
                  const winner = await adapter.findAccountByKey({
                    providerId: "steam",
                    accountId: steamId,
                  });
                  const linked = (
                    await adapter.findAccounts(saved.userId)
                  ).find((a) => a.providerId === "steam");
                  status =
                    winner?.userId === saved.userId
                      ? "connected"
                      : winner
                        ? "conflict"
                        : linked
                          ? "already-connected"
                          : "failed";
                }
              }
            }
          } catch (error) {
            // An AUTH decision is not a failure; carry it through unchanged.
            if (error instanceof SteamRedirect) throw ctx.redirect(error.to);
            // Do not log OpenID assertions, signatures, state or session cookies.
            status = "failed";
          }
          throw ctx.redirect(destination(flow, status));
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
