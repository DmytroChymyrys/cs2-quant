import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  bigint,
  jsonb,
  numeric,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
import { assets, observations } from "../db/schema";
const time = (name: string) => timestamp(name, { withTimezone: true });
const audit = () => ({
  createdAt: time("created_at").defaultNow().notNull(),
  updatedAt: time("updated_at").defaultNow().notNull(),
});
export const authUser = pgTable("auth_users", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  /*
   * Nullable because Steam OpenID supplies no verified email address, and a
   * synthetic one would be a lie the rest of the product would then trust:
   * password reset, verification and support all key on this column.
   *
   * Email/password accounts are unaffected. Better Auth still requires and
   * verifies an address on that path (`requireEmailVerification: true`), so
   * the requirement is enforced where it means something rather than by a
   * column constraint that only forces an invented value.
   *
   * The unique index is kept: Postgres treats NULLs as distinct, so any number
   * of Steam-only accounts coexist while two accounts still cannot share a
   * real address.
   */
  email: text("email").unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  ...audit(),
});
export const authSession = pgTable(
  "auth_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: time("expires_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    ...audit(),
  },
  (t) => [index("auth_sessions_user").on(t.userId)],
);
export const authAccount = pgTable(
  "auth_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: time("access_token_expires_at"),
    refreshTokenExpiresAt: time("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    ...audit(),
  },
  (t) => [
    uniqueIndex("auth_provider_subject").on(t.providerId, t.accountId),
    uniqueIndex("auth_one_steam_per_user")
      .on(t.userId)
      .where(sql`${t.providerId} = 'steam'`),
    index("auth_accounts_user").on(t.userId),
  ],
);
export const authVerification = pgTable(
  "auth_verifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: time("expires_at").notNull(),
    ...audit(),
  },
  (t) => [index("auth_verification_identifier").on(t.identifier)],
);
export const authRateLimit = pgTable("auth_rate_limits", {
  id: uuid("id").defaultRandom().primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});
/**
 * The way an account first came into existence.
 *
 * Fixed set, stored as text with a check constraint rather than a pg enum: the
 * values are read by humans in the admin surfaces and an enum would make
 * adding a provider a type-level migration for no benefit here.
 */
export type SignupMethod = "EMAIL" | "GOOGLE" | "STEAM" | "UNKNOWN";
export const appUsers = pgTable(
  "app_users",
  {
    role: text("role").$type<"USER" | "ADMIN">().default("USER").notNull(),
    id: uuid("id").defaultRandom().primaryKey(),
    authUserId: uuid("auth_user_id")
      .unique()
      .references(() => authUser.id, { onDelete: "cascade" }),
    categories: jsonb("categories").$type<string[]>().default([]).notNull(),
    interests: jsonb("interests").$type<string[]>().default([]).notNull(),
    onboarded: boolean("onboarded").default(false).notNull(),
    /*
     * When the signup conversion was reported, or NULL if it has not been.
     * Claimed by one conditional UPDATE so the conversion fires once per
     * ACCOUNT rather than once per browser session. Analytics state only: it is
     * never read by authentication, entitlements or any product surface.
     */
    signupReportedAt: time("signup_reported_at"),
    watchVisitedAt: time("watch_visited_at"),
    /*
     * Account lifecycle. Both states deny access through currentUser() and are
     * reversible; neither releases the email address, so the row keeps its
     * audit trail and a restore is exact. Only a hard delete frees the address,
     * and that removes the row outright rather than setting a flag here.
     *
     * They are separate columns because they answer different questions: a
     * block is a moderation action against someone who still exists, a soft
     * delete is a closed account. A single "status" column would make a
     * blocked-then-deleted account indistinguishable from either.
     */
    blockedAt: time("blocked_at"),
    deletedAt: time("deleted_at"),
    statusReason: text("status_reason"),
    /*
     * How this account was created, written once at creation and immutable
     * afterwards -- a database trigger refuses to change it, so no later
     * refactor can quietly rewrite acquisition history.
     *
     * Deliberately NOT derivable from auth_accounts. That table answers "how
     * can this person sign in today?", which changes every time an identity is
     * linked or unlinked. A Google signup who connects Steam is still a Google
     * signup; reading the provider set would say otherwise.
     *
     * UNKNOWN is a real answer, not a failure: it marks an account whose
     * provenance could not be established from evidence, and is preferred to a
     * plausible guess that would later be quoted as acquisition data.
     */
    signupMethod: text("signup_method")
      .$type<SignupMethod>()
      .default("UNKNOWN")
      .notNull(),
    ...audit(),
  },
  (t) => [
    check("app_user_role", sql`${t.role} in ('USER', 'ADMIN')`),
    check(
      "app_user_signup_method",
      sql`${t.signupMethod} in ('EMAIL', 'GOOGLE', 'STEAM', 'UNKNOWN')`,
    ),
    // Admin listings filter on these constantly and they are null for almost
    // every row, so a partial index stays small.
    index("app_users_blocked")
      .on(t.blockedAt)
      .where(sql`${t.blockedAt} is not null`),
    index("app_users_deleted")
      .on(t.deletedAt)
      .where(sql`${t.deletedAt} is not null`),
  ],
);
export const watchEntries = pgTable(
  "watchlist_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id),
    checkpointObservationId: uuid("checkpoint_observation_id").references(
      () => observations.id,
    ),
    createdAt: time("created_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("watchlist_user_asset").on(t.userId, t.assetId)],
);
export const holdings = pgTable(
  "portfolio_holdings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id),
    quantity: integer("quantity").notNull(),
    unitCost: numeric("unit_cost", { precision: 20, scale: 8 }),
    ...audit(),
  },
  (t) => [
    uniqueIndex("holding_user_asset").on(t.userId, t.assetId),
    check("holding_quantity_positive", sql`${t.quantity}>0`),
    check(
      "holding_cost_nonnegative",
      sql`${t.unitCost} is null or ${t.unitCost}>=0`,
    ),
  ],
);
export type Condition = {
  metric:
    | "median"
    | "quantity"
    | "sales24h"
    | "priceChange"
    | "listingChange"
    | "activityChange";
  operator: "gt" | "lt" | "between";
  threshold: string;
  upper?: string;
};
export const alertRules = pgTable(
  "alert_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id),
    name: text("name").notNull(),
    conditions: jsonb("conditions").$type<Condition[]>().notNull(),
    email: boolean("email").default(false).notNull(),
    paused: boolean("paused").default(false).notNull(),
    previousTrue: boolean("previous_true").default(false).notNull(),
    lastObservationId: uuid("last_observation_id").references(
      () => observations.id,
    ),
    state: text("state").default("COLLECTING").notNull(),
    lastEvaluation: jsonb("last_evaluation"),
    ...audit(),
  },
  (t) => [index("alert_rules_user").on(t.userId)],
);
export const alertEvents = pgTable(
  "alert_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => alertRules.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    observationId: uuid("observation_id")
      .notNull()
      .references(() => observations.id),
    details: jsonb("details").notNull(),
    readAt: time("read_at"),
    emailState: text("email_state").default("NOT_REQUESTED").notNull(),
    createdAt: time("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("alert_event_transition").on(t.ruleId, t.observationId),
    index("alert_events_user_time").on(t.userId, t.createdAt),
  ],
);
export const subscriptions = pgTable("billing_subscriptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => appUsers.id, { onDelete: "cascade" }),
  customerId: text("customer_id").unique(),
  subscriptionId: text("subscription_id").unique(),
  status: text("status").default("none").notNull(),
  priceId: text("price_id"),
  periodEnd: time("period_end"),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false).notNull(),
  ...audit(),
});
export const billingEvents = pgTable("billing_events", {
  id: text("id").primaryKey(),
  createdAt: time("created_at").defaultNow().notNull(),
});
export const savedScreens = pgTable(
  "saved_screens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    conditions: jsonb("conditions").$type<Condition[]>().notNull(),
    createdAt: time("created_at").defaultNow().notNull(),
  },
  (t) => [index("saved_screens_user").on(t.userId)],
);

/**
 * Steam inventory: the product integration, its sync provenance and the
 * ownership intervals it produces.
 *
 * Deliberately separate from authentication. `auth_accounts` answers "who is
 * this person?"; these tables answer "what do they own?". Inventory code never
 * writes to an auth table, and the only link to identity is `app_users.id` as
 * an owner.
 */
export type SyncOutcome =
  | "OK_ITEMS"
  | "OK_EMPTY"
  | "UNAVAILABLE"
  | "PROVIDER_ERROR"
  | "RATE_LIMITED"
  | "TIMEOUT";
export type IdentityStatus = "MATCHED" | "UNMATCHED" | "AMBIGUOUS";
export type MarketDepth = "TRACKED" | "BROAD" | "NONE";
export type RemovedReason = "ABSENT" | "IDENTITY_CHANGED";
export type SyncTrigger = "CRON" | "MANUAL" | "FIRST_CONNECT";

export const steamIntegrations = pgTable(
  "steam_integrations",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    /*
     * The integration's own SteamID, copied at connect rather than read from
     * auth_accounts during a sync. Disconnecting Steam must be a product
     * decision that preserves the last snapshot, not a foreign key that
     * destroys inventory capability.
     */
    steamId: text("steam_id").notNull().unique(),
    status: text("status")
      .$type<"ACTIVE" | "DISCONNECTED">()
      .default("ACTIVE")
      .notNull(),
    connectedAt: time("connected_at").defaultNow().notNull(),
    disconnectedAt: time("disconnected_at"),
    lastAttemptAt: time("last_attempt_at"),
    lastSuccessAt: time("last_success_at"),
    /* The most recent ATTEMPT. Not the lifecycle, and not freshness. */
    lastOutcome: text("last_outcome").$type<SyncOutcome>(),
    nextEligibleAt: time("next_eligible_at"),
    /*
     * There is no SYNCING status. A sync is in flight exactly while
     * `syncLeaseExpiresAt > now()`, so a crashed invocation recovers by
     * expiry rather than leaving a state somebody has to clear by hand.
     */
    syncLeaseId: uuid("sync_lease_id"),
    syncLeaseExpiresAt: time("sync_lease_expires_at"),
    ...audit(),
  },
  (t) => [
    check("steam_integration_status", sql`${t.status} in ('ACTIVE', 'DISCONNECTED')`),
    check(
      "steam_integration_outcome",
      sql`${t.lastOutcome} is null or ${t.lastOutcome} in ('OK_ITEMS','OK_EMPTY','UNAVAILABLE','PROVIDER_ERROR','RATE_LIMITED','TIMEOUT')`,
    ),
    index("steam_integration_lease")
      .on(t.syncLeaseExpiresAt)
      .where(sql`${t.syncLeaseExpiresAt} is not null`),
  ],
);

/** Append-only provenance. One row per attempt, authoritative or not. */
export const inventorySyncRuns = pgTable(
  "inventory_sync_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    startedAt: time("started_at").defaultNow().notNull(),
    finishedAt: time("finished_at"),
    outcome: text("outcome").$type<SyncOutcome>(),
    /*
     * Only an authoritative run may establish absence. A privacy refusal is
     * evidence about the provider, never about the inventory.
     */
    authoritative: boolean("authoritative").default(false).notNull(),
    httpStatus: integer("http_status"),
    errorCode: text("error_code"),
    itemsReceived: integer("items_received").default(0).notNull(),
    itemsMatched: integer("items_matched").default(0).notNull(),
    itemsUnmatched: integer("items_unmatched").default(0).notNull(),
    itemsAmbiguous: integer("items_ambiguous").default(0).notNull(),
    itemsAdded: integer("items_added").default(0).notNull(),
    itemsRemoved: integer("items_removed").default(0).notNull(),
    identityAnomalies: integer("identity_anomalies").default(0).notNull(),
    itemsReappeared: integer("items_reappeared").default(0).notNull(),
    durationMs: integer("duration_ms"),
    trigger: text("trigger").$type<SyncTrigger>().notNull(),
  },
  (t) => [
    check(
      "inventory_run_outcome",
      sql`${t.outcome} is null or ${t.outcome} in ('OK_ITEMS','OK_EMPTY','UNAVAILABLE','PROVIDER_ERROR','RATE_LIMITED','TIMEOUT')`,
    ),
    check("inventory_run_trigger", sql`${t.trigger} in ('CRON','MANUAL','FIRST_CONNECT')`),
    index("inventory_runs_user_time").on(t.userId, t.startedAt),
  ],
);

/**
 * Temporal ownership intervals.
 *
 * One row is one period during which an item instance was observed. An item
 * that leaves and returns is two rows, never a reopened one.
 *
 * V1 LIMITATION: ownership intervals are preserved; quantity history within an
 * interval is not, and cannot be reconstructed from the run table, which holds
 * per-run totals rather than per-item evidence.
 */
export const inventoryHoldings = pgTable(
  "inventory_holdings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    /** Steam INSTANCE identity. Not the market identity. */
    steamAssetId: text("steam_asset_id").notNull(),
    classId: text("class_id"),
    instanceId: text("instance_id"),
    /**
     * The V1 canonical market key — NOT an immutable global identity. Valve
     * owns this string. It is simply the strongest cross-system key we have.
     */
    marketHashName: text("market_hash_name").notNull(),
    /** NFC, trimmed, whitespace collapsed, case PRESERVED. */
    normalizedName: text("normalized_name").notNull(),
    quantity: integer("quantity").default(1).notNull(),
    tradable: boolean("tradable"),
    marketable: boolean("marketable"),
    tradelockedUntil: time("tradelocked_until"),
    nameTag: text("name_tag"),
    identityStatus: text("identity_status").$type<IdentityStatus>().notNull(),
    marketDepth: text("market_depth").$type<MarketDepth>().notNull(),
    /** Advisory. Holdings are not keyed on it and survive its removal. */
    assetId: uuid("asset_id").references(() => assets.id, { onDelete: "set null" }),
    firstSeenAt: time("first_seen_at").defaultNow().notNull(),
    lastSeenAt: time("last_seen_at").defaultNow().notNull(),
    removedAt: time("removed_at"),
    firstSeenRunId: uuid("first_seen_run_id")
      .notNull()
      .references(() => inventorySyncRuns.id, { onDelete: "cascade" }),
    lastSeenRunId: uuid("last_seen_run_id")
      .notNull()
      .references(() => inventorySyncRuns.id, { onDelete: "cascade" }),
    removedRunId: uuid("removed_run_id").references(() => inventorySyncRuns.id, {
      onDelete: "cascade",
    }),
    removedReason: text("removed_reason").$type<RemovedReason>(),
  },
  (t) => [
    check("inventory_identity_status", sql`${t.identityStatus} in ('MATCHED','UNMATCHED','AMBIGUOUS')`),
    check("inventory_market_depth", sql`${t.marketDepth} in ('TRACKED','BROAD','NONE')`),
    check("inventory_quantity_positive", sql`${t.quantity} > 0`),
    check(
      "inventory_removed_reason",
      sql`${t.removedReason} is null or ${t.removedReason} in ('ABSENT','IDENTITY_CHANGED')`,
    ),
    check(
      "inventory_unmatched_has_no_depth",
      sql`${t.identityStatus} <> 'UNMATCHED' or ${t.marketDepth} = 'NONE'`,
    ),
    check(
      "inventory_tracked_has_asset",
      sql`${t.marketDepth} <> 'TRACKED' or ${t.assetId} is not null`,
    ),
    check(
      "inventory_closure_consistent",
      sql`(${t.removedAt} is null and ${t.removedRunId} is null and ${t.removedReason} is null)
       or (${t.removedAt} is not null and ${t.removedRunId} is not null and ${t.removedReason} is not null)`,
    ),
    // Invariant guard, never an ON CONFLICT target: the sync lease already
    // guarantees one writer per user.
    uniqueIndex("inventory_one_open_interval")
      .on(t.userId, t.steamAssetId)
      .where(sql`${t.removedAt} is null`),
    index("inventory_user_open").on(t.userId).where(sql`${t.removedAt} is null`),
    index("inventory_user_market_key").on(t.userId, t.normalizedName),
    index("inventory_user_interval").on(t.userId, t.firstSeenAt, t.removedAt),
    index("inventory_unresolved").on(t.userId).where(sql`${t.identityStatus} <> 'MATCHED'`),
  ],
);

// Allowlisted administrative audit records. No arbitrary request metadata.
export const adminAudit = pgTable("admin_audit", {
  id: uuid("id").defaultRandom().primaryKey(),
  actor: text("actor").notNull(), // app user UUID, or explicit CLI operator identifier
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: uuid("target_id").notNull(),
  occurredAt: time("occurred_at").defaultNow().notNull(),
  metadata: jsonb("metadata")
    .$type<{
      previousRole?: string;
      role?: string;
      /* Lifecycle actions. Free text supplied by the admin, never request data. */
      reason?: string;
      /*
       * Recorded on a hard delete only, because the row it describes is gone
       * by the time anyone reads this: the audit entry is the only remaining
       * evidence that the account existed.
       */
      email?: string;
      cascade?: Record<string, number>;
      subscriptionCancelled?: string;
    }>()
    .default({})
    .notNull(),
});
