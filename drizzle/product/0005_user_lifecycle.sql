-- Account lifecycle: block and soft delete.
--
-- Written by hand rather than generated. `drizzle.product.config.ts` reads only
-- src/lib/product/schema.ts, so drizzle-kit does not know the market tables
-- this stream shares a database with and emits DROP TABLE for every one of
-- them. Generating into this stream is not safe; review the SQL here instead.
--
-- Both states are reversible and neither releases the email address, so
-- auth_users is untouched and a restore is exact. Only a hard delete frees the
-- address, and that deletes the auth_users row so the existing ON DELETE
-- CASCADE chain removes everything beneath it.
ALTER TABLE "app_users" ADD COLUMN "blocked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app_users" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app_users" ADD COLUMN "status_reason" text;--> statement-breakpoint
-- Null for almost every row, so the partial indexes stay small while still
-- serving the admin listings that filter on them.
CREATE INDEX "app_users_blocked" ON "app_users" USING btree ("blocked_at") WHERE "app_users"."blocked_at" is not null;--> statement-breakpoint
CREATE INDEX "app_users_deleted" ON "app_users" USING btree ("deleted_at") WHERE "app_users"."deleted_at" is not null;
