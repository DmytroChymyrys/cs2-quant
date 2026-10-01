-- How an account came into existence, recorded once and never changed.
--
-- Written by hand, like every migration in this stream: drizzle.product.config.ts
-- reads only src/lib/product/schema.ts and does not know about the market tables
-- this database shares, so generating here emits DROP TABLE for all of them.
--
-- This answers "how did this person sign up?", which is NOT the same question as
-- "how can this person sign in today?". The second is answered by auth_accounts
-- and changes whenever an identity is linked or unlinked. Keeping them apart is
-- the whole point: a Google signup who later connects Steam is still a Google
-- signup, and an admin reading the two together can tell acquisition from
-- current capability.
ALTER TABLE "app_users" ADD COLUMN IF NOT EXISTS "signup_method" text DEFAULT 'UNKNOWN' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "app_users" ADD CONSTRAINT "app_user_signup_method"
    CHECK ("signup_method" in ('EMAIL', 'GOOGLE', 'STEAM', 'UNKNOWN'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

-- Conservative one-time backfill for accounts that predate the column.
--
-- Timing evidence is used HERE and nowhere else. It is legitimate for history
-- because the rows are already written and nothing else survives that records
-- intent; it is illegitimate for new accounts, which state their method
-- explicitly at creation. Nothing in the application reads this logic.
--
-- "Earliest account wins" is deliberately NOT the rule, because it is not true
-- in general -- it would label every Steam-linked Google signup by whichever
-- row happened to sort first. A method is assigned only when the evidence is
-- unambiguous on all three counts:
--
--   1. the account row was created in the same breath as the user row, which is
--      what account creation actually looks like (observed: 4ms, 6ms);
--   2. exactly ONE account falls inside that window, so there is no competing
--      claim -- a later link sits far outside it and cannot be mistaken for the
--      signup;
--   3. no tie on created_at, so "first" is a fact rather than a sort order.
--
-- Anything else keeps UNKNOWN. An honest UNKNOWN is worth more than a plausible
-- guess that later gets quoted as acquisition data.
WITH first_account AS (
  SELECT DISTINCT ON (a.user_id) a.user_id, a.provider_id, a.created_at
  FROM auth_accounts a
  ORDER BY a.user_id, a.created_at, a.id
), evidence AS (
  SELECT u.id AS auth_user_id, f.provider_id,
    (SELECT count(*) FROM auth_accounts a
      WHERE a.user_id = u.id
        AND a.created_at <= u.created_at + interval '5 seconds') AS in_window,
    (SELECT count(*) FROM auth_accounts a
      WHERE a.user_id = u.id AND a.created_at = f.created_at) AS ties
  FROM auth_users u
  JOIN first_account f ON f.user_id = u.id
  WHERE f.created_at >= u.created_at
)
UPDATE "app_users" p SET "signup_method" = CASE e.provider_id
    WHEN 'credential' THEN 'EMAIL'
    WHEN 'google' THEN 'GOOGLE'
    WHEN 'steam' THEN 'STEAM'
    ELSE 'UNKNOWN' END
  FROM evidence e
  WHERE p.auth_user_id = e.auth_user_id
    AND e.in_window = 1 AND e.ties = 1
    -- Only rows that have never been assigned, so re-applying changes nothing
    -- and the immutability trigger below is never in conflict with this.
    AND p.signup_method = 'UNKNOWN';--> statement-breakpoint

-- Immutable after creation, enforced by the database rather than by discipline.
--
-- Linking, unlinking and ordinary sign-in all run UPDATE against app_users for
-- unrelated reasons; any one of them could carry this column along by accident
-- in a future refactor. A column-level guard turns that from a silent rewrite
-- of acquisition history into a failed statement.
--
-- UNKNOWN is the one permitted transition: a legacy row whose provenance is
-- later established by evidence may be set once, and after that it is fixed.
CREATE OR REPLACE FUNCTION app_users_signup_method_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.signup_method IS DISTINCT FROM NEW.signup_method
     AND OLD.signup_method <> 'UNKNOWN' THEN
    RAISE EXCEPTION 'app_users.signup_method is immutable (% -> %)',
      OLD.signup_method, NEW.signup_method
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS app_users_signup_method_guard ON "app_users";--> statement-breakpoint
CREATE TRIGGER app_users_signup_method_guard BEFORE UPDATE ON "app_users"
  FOR EACH ROW EXECUTE FUNCTION app_users_signup_method_immutable();
