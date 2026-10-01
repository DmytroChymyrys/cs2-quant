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
