import { createHash, randomBytes } from "node:crypto";
import type { BetterAuthPlugin } from "better-auth";
import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
  freshSessionMiddleware,
  getAuthoritativeSessionFromCtx,
  sensitiveSessionMiddleware,
} from "better-auth/api";
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
          } catch {
            // Do not log OpenID assertions, signatures, state or session cookies.
            status = "failed";
          }
          throw ctx.redirect(destination(flow, status));
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
