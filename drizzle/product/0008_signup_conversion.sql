-- Durable, once-per-account marker for the signup conversion.
--
-- The conversion must fire exactly once per FloatAlpha account. A client-side
-- ref survives a React remount but not a refresh, a second tab, a callback
-- replay or a different device. Claiming the report in the database makes
-- "once" a property of the account rather than of a browser session.
--
-- Nullable and with no default: NULL means "not yet reported", and the claim is
-- a conditional UPDATE that only one request can win.
ALTER TABLE "app_users" ADD COLUMN "signup_reported_at" timestamp with time zone;
