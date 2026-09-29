-- Mirrors drizzle/product/0005_user_lifecycle.sql.
--
-- The billing sandbox stands up its own copy of the account tables, so the
-- account lifecycle columns have to exist here too; without them any read of
-- app_users through the shared Drizzle model fails against a sandbox database.
ALTER TABLE "app_users" ADD COLUMN "blocked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app_users" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app_users" ADD COLUMN "status_reason" text;--> statement-breakpoint
CREATE INDEX "app_users_blocked" ON "app_users" USING btree ("blocked_at") WHERE "app_users"."blocked_at" is not null;--> statement-breakpoint
CREATE INDEX "app_users_deleted" ON "app_users" USING btree ("deleted_at") WHERE "app_users"."deleted_at" is not null;
