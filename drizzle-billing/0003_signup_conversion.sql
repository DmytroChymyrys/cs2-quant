-- Mirrors drizzle/product/0008_signup_conversion.sql.
--
-- The billing sandbox runs the SHARED Drizzle model against its own database,
-- so every column that model reads must exist here too — a missing one fails
-- every app_users query, not only the ones that use the new column.
ALTER TABLE "app_users" ADD COLUMN "signup_reported_at" timestamp with time zone;
