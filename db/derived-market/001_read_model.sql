-- Separate DERIVED_MARKET_DATABASE_URL only. No raw/product/catalog table mutations.
CREATE TABLE derived_market_snapshots (
  id text PRIMARY KEY,
  method text NOT NULL,
  scope jsonb NOT NULL,
  report jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE derived_history_versions (
  snapshot_id text NOT NULL REFERENCES derived_market_snapshots(id),
  version integer NOT NULL CHECK(version>0),
  source text NOT NULL,
  hash text NOT NULL,
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  fetch_count integer NOT NULL CHECK(fetch_count>0),
  source_timestamp timestamptz,
  left_censored boolean NOT NULL,
  PRIMARY KEY(snapshot_id,version)
);
CREATE TABLE derived_history_values (
  snapshot_id text NOT NULL,
  version integer NOT NULL,
  asset_id uuid NOT NULL,
  payload jsonb NOT NULL,
  PRIMARY KEY(snapshot_id,version,asset_id),
  FOREIGN KEY(snapshot_id,version) REFERENCES derived_history_versions(snapshot_id,version)
);
CREATE TABLE derived_market_features (
  snapshot_id text NOT NULL REFERENCES derived_market_snapshots(id),
  observation_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  observed_at timestamptz NOT NULL,
  history_version integer,
  feature jsonb NOT NULL,
  PRIMARY KEY(snapshot_id,observation_id),
  FOREIGN KEY(snapshot_id,history_version) REFERENCES derived_history_versions(snapshot_id,version),
  CHECK(NOT (feature ?| ARRAY['sales_24h_volume','history','raw_history_payload'])),
  CHECK(NOT ((feature->'values') ?| ARRAY['sales_24h_volume','published_sales_24h_volume']))
);
CREATE INDEX derived_features_asset_time ON derived_market_features(snapshot_id,asset_id,observed_at);
