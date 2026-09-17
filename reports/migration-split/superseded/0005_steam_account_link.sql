CREATE UNIQUE INDEX IF NOT EXISTS "auth_one_steam_per_user" ON "auth_accounts" USING btree ("user_id") WHERE "auth_accounts"."provider_id" = 'steam';
