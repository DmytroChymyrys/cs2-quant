-- Make provider identity unique when version is NULL.
--
-- The constraint in 0008 was UNIQUE (provider, venue, external_asset_key,
-- version). Postgres treats NULLs as distinct in a unique index by default, and
-- every Skinport row is unversioned, so ON CONFLICT never fired: each run
-- re-inserted all ~25,000 provider assets instead of matching the existing
-- ones. Observed directly in production — provider_assets grew fivefold across
-- three runs.
--
-- NULLS NOT DISTINCT makes one NULL version collide with another, which is the
-- intended meaning: an unversioned asset has exactly one identity per provider
-- and venue.
ALTER TABLE provider_assets
  DROP CONSTRAINT IF EXISTS provider_assets_provider_venue_external_asset_key_version_key;

CREATE UNIQUE INDEX IF NOT EXISTS provider_assets_identity
  ON provider_assets (provider, venue, external_asset_key, version)
  NULLS NOT DISTINCT;
