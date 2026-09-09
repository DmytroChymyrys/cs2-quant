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
  email: text("email").notNull().unique(),
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
export const appUsers = pgTable("app_users", {
  id: uuid("id").defaultRandom().primaryKey(),
  authUserId: uuid("auth_user_id")
    .unique()
    .references(() => authUser.id, { onDelete: "cascade" }),
  categories: jsonb("categories").$type<string[]>().default([]).notNull(),
  interests: jsonb("interests").$type<string[]>().default([]).notNull(),
  onboarded: boolean("onboarded").default(false).notNull(),
  watchVisitedAt: time("watch_visited_at"),
  ...audit(),
});
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
