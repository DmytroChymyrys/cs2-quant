-- Mirrors drizzle/product/0006_signup_method.sql.
--
-- The billing sandbox stands up its own copy of the account tables, so this
-- column has to exist here too; without it any read of app_users through the
-- shared Drizzle model fails against a sandbox database.
--
-- The backfill and the immutability trigger are deliberately NOT mirrored. The
-- sandbox holds no real signup history to establish, and nothing in billing
-- writes this column, so the constraint alone is what the shared model needs.
ALTER TABLE "app_users" ADD COLUMN IF NOT EXISTS "signup_method" text DEFAULT 'UNKNOWN' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "app_users" ADD CONSTRAINT "app_user_signup_method"
    CHECK ("signup_method" in ('EMAIL', 'GOOGLE', 'STEAM', 'UNKNOWN'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
