-- Account identity constraint only; no market, collector or billing changes.
CREATE UNIQUE INDEX IF NOT EXISTS "auth_one_steam_per_user" ON "auth_accounts" ("user_id")
WHERE "provider_id" = 'steam';
