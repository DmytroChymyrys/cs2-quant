-- Additive catalog subsystem. Existing assets, observations and collector tables are untouched.
CREATE TABLE IF NOT EXISTS canonical_asset_catalog (
  catalog_asset_id text PRIMARY KEY,
  market_hash_name text,
  display_name text NOT NULL,
  asset_type text NOT NULL,
  metadata jsonb NOT NULL,
  catalog_provider text NOT NULL,
  catalog_dataset text NOT NULL,
  catalog_provider_id text NOT NULL,
  normalizer_version text NOT NULL,
  source_hash text NOT NULL,
  source_revision text NOT NULL,
  source_updated_at timestamptz,
  catalog_synced_at timestamptz NOT NULL,
  deprecated_at timestamptz,
  UNIQUE (catalog_provider, catalog_dataset, catalog_provider_id)
);
-- Deliberately non-unique: paint variants can share a Steam market name.
CREATE INDEX IF NOT EXISTS catalog_market_name ON canonical_asset_catalog(market_hash_name) WHERE deprecated_at IS NULL;
CREATE INDEX IF NOT EXISTS catalog_dataset ON canonical_asset_catalog(catalog_provider, catalog_dataset);

CREATE TABLE IF NOT EXISTS asset_media (
  catalog_asset_id text PRIMARY KEY REFERENCES canonical_asset_catalog(catalog_asset_id),
  media_type text NOT NULL DEFAULT 'ARTWORK_2D' CHECK (media_type = 'ARTWORK_2D'),
  source text NOT NULL,
  source_url text,
  served_url text,
  width integer CHECK (width > 0),
  height integer CHECK (height > 0),
  content_type text,
  content_hash text,
  alpha_bounds jsonb,
  status text NOT NULL CHECK (status IN ('AVAILABLE', 'MISSING', 'INVALID', 'UNVERIFIED')),
  last_verified_at timestamptz,
  verification_error text,
  catalog_synced_at timestamptz NOT NULL,
  CHECK (status NOT IN ('MISSING', 'INVALID') OR served_url IS NULL)
);

-- asset_id is the unchanged UUID read from FloatAlpha assets. A cross-database
-- reference permits an isolated catalog DB; runtime also checks the exact name.
CREATE TABLE IF NOT EXISTS asset_catalog_mappings (
  asset_id uuid PRIMARY KEY,
  market_hash_name text NOT NULL,
  catalog_asset_id text REFERENCES canonical_asset_catalog(catalog_asset_id),
  status text NOT NULL CHECK (status IN ('EXACT', 'MISSING', 'AMBIGUOUS')),
  candidates jsonb NOT NULL,
  reason text NOT NULL,
  catalog_synced_at timestamptz NOT NULL,
  CHECK ((status = 'EXACT') = (catalog_asset_id IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS catalog_sync_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_revision text NOT NULL,
  manifest jsonb NOT NULL,
  report jsonb NOT NULL,
  finished_at timestamptz NOT NULL
);
