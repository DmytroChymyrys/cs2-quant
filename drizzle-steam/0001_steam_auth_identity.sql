-- Account identity only; no market, collector or billing changes.
--
-- Steam OpenID provides no verified email address. Rather than invent one,
-- the column becomes nullable. Email/password accounts still require and
-- verify an address through Better Auth; this removes only the storage
-- constraint that would otherwise force a placeholder.
--
-- The unique index is unaffected: Postgres treats NULLs as distinct.
ALTER TABLE "auth_users" ALTER COLUMN "email" DROP NOT NULL;
