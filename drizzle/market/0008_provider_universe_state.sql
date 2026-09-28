-- Full-universe Skinport collection, stored as change history.
--
-- The collector already fetches the complete provider response every five
-- minutes and discards everything outside the 100-asset intelligence universe.
-- These tables keep the rest. Nothing here changes what the existing collector
-- writes to market_observations, and listing-features-v3 does not read them.
--
-- Three concerns, deliberately separated so static metadata is not repeated in
-- every historical row:
--
--   provider_assets                identity and static provider metadata
--   provider_asset_state           current normalized state, one row per asset
--   provider_asset_state_history   append-only record of every state change
--
-- collector_runs is the run ledger. It already records every run whether or
-- not anything changed, which is what proves an asset was observed and simply
-- did not move during an interval with no history row.

CREATE TABLE IF NOT EXISTS provider_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Provider and venue are stored separately so a second source maps through
  -- the same structure. Skinport is a provider here, never the identity.
  provider text NOT NULL,
  venue text NOT NULL,
  external_asset_key text NOT NULL,
  market_hash_name text NOT NULL,
  -- Null for unversioned rows. Part of identity: Doppler phases share a name.
  version text,
  -- FloatAlpha's internal asset identity, when this provider asset resolves to
  -- one. Null is expected and correct: the catalogue is far larger than the
  -- tracked universe, and an unmapped provider asset is still worth observing.
  asset_id uuid REFERENCES assets(id),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  first_seen_run_id uuid NOT NULL REFERENCES collector_runs(id),
  -- Provider fields that identify rather than fluctuate.
  static_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (provider, venue, external_asset_key, version)
);

CREATE INDEX IF NOT EXISTS provider_assets_asset ON provider_assets (asset_id)
  WHERE asset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS provider_assets_name ON provider_assets (market_hash_name);

CREATE TABLE IF NOT EXISTS provider_asset_state (
  provider_asset_id uuid PRIMARY KEY REFERENCES provider_assets(id) ON DELETE CASCADE,
  -- Deterministic digest of meaningful market state only. It contains no
  -- timestamp and no run identifier, so an unchanged asset hashes identically
  -- on every run and produces no history row.
  state_hash text NOT NULL,
  -- Whether the asset appeared in the last successful full response. Absence
  -- is recorded as absence; it is never written as quantity zero, which would
  -- assert an observed empty order book that the provider did not report.
  present boolean NOT NULL,
  currency text,
  quantity integer,
  min_price numeric(20, 8),
  max_price numeric(20, 8),
  mean_price numeric(20, 8),
  median_price numeric(20, 8),
  suggested_price numeric(20, 8),
  -- Authorized provider fields with no dedicated column, kept rather than
  -- discarded because the current UI does not consume them.
  market_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- When this state was first observed, not when it was last confirmed.
  state_since timestamptz NOT NULL,
  -- The most recent run that confirmed this state, changed or not.
  observed_at timestamptz NOT NULL,
  collector_run_id uuid NOT NULL REFERENCES collector_runs(id)
);

CREATE TABLE IF NOT EXISTS provider_asset_state_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider_asset_id uuid NOT NULL REFERENCES provider_assets(id) ON DELETE CASCADE,
  state_hash text NOT NULL,
  present boolean NOT NULL,
  currency text,
  quantity integer,
  min_price numeric(20, 8),
  max_price numeric(20, 8),
  mean_price numeric(20, 8),
  median_price numeric(20, 8),
  suggested_price numeric(20, 8),
  market_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- When this state began. Point-in-time reconstruction reads the latest row
  -- at or before an instant; the run ledger proves observation in between.
  observed_at timestamptz NOT NULL,
  collector_run_id uuid NOT NULL REFERENCES collector_runs(id)
);

CREATE INDEX IF NOT EXISTS provider_state_history_asset_time
  ON provider_asset_state_history (provider_asset_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS provider_state_history_run
  ON provider_asset_state_history (collector_run_id);

-- History is evidence. It is appended to and never rewritten, matching the
-- protection already on market_observations.
CREATE OR REPLACE FUNCTION provider_state_history_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'provider_asset_state_history is append-only';
END;
$$;

-- Created conditionally rather than dropped and recreated: Postgres has no
-- CREATE TRIGGER IF NOT EXISTS, and a DROP would make this file fail the
-- additive-only check that governs direct application to production.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'provider_state_history_append_only'
      AND tgrelid = 'provider_asset_state_history'::regclass
  ) THEN
    CREATE TRIGGER provider_state_history_append_only
      BEFORE UPDATE OR DELETE ON provider_asset_state_history
      FOR EACH ROW EXECUTE FUNCTION provider_state_history_append_only();
  END IF;
END;
$$;

-- Provenance for each full-universe collection run.
--
-- Delta rows carry only collector_run_id and join here, so large provenance
-- metadata is recorded once per run rather than repeated on every state row.
--
-- Two different fingerprints exist in this schema and must not be conflated:
--
--   response_sha256  digests the provider payload exactly as delivered. It
--                    changes whenever anything in the response changes, which
--                    for a 25k-asset body is almost every run.
--   state_hash       digests one asset's normalized market state, excluding
--                    timestamps and run identifiers, so an unchanged asset
--                    hashes identically forever and writes no history.
--
-- One answers "was this the same response"; the other answers "did this asset
-- move". Using either in place of the other would either lose every delta or
-- fabricate one per asset per run.
CREATE TABLE IF NOT EXISTS provider_collection_runs (
  collector_run_id uuid PRIMARY KEY REFERENCES collector_runs(id) ON DELETE CASCADE,
  -- Provider evidence stays separable. A second provider records its own runs
  -- and its own provider_assets; cross-provider values are derived FloatAlpha
  -- metrics and never written back as provider observations.
  provider text NOT NULL,
  venue text NOT NULL,
  -- Which data product of that provider this run read.
  data_product text NOT NULL,
  endpoints jsonb NOT NULL DEFAULT '[]'::jsonb,
  observed_at timestamptz NOT NULL,
  response_sha256 text,
  response_bytes bigint,
  collector_version text NOT NULL,
  transformer_version text NOT NULL,
  normalization_version text NOT NULL,
  assets_received integer NOT NULL DEFAULT 0,
  assets_normalized integer NOT NULL DEFAULT 0,
  assets_mapped integer NOT NULL DEFAULT 0,
  assets_unmapped integer NOT NULL DEFAULT 0,
  states_changed integer NOT NULL DEFAULT 0,
  states_unchanged integer NOT NULL DEFAULT 0,
  disappeared integer NOT NULL DEFAULT 0,
  reappeared integer NOT NULL DEFAULT 0,
  transform_failures integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS provider_collection_runs_observed
  ON provider_collection_runs (provider, venue, observed_at DESC);
