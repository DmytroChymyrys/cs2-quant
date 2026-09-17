-- L2 derived rollups. Rebuildable caches, never the system of record.
-- Dropping and recomputing these tables from market_observations must always be
-- safe, so they carry no data that cannot be re-derived.
--
-- Transitions are counted against the immediately preceding observation of the
-- same asset, which may lie in the previous bucket. Summing a column across
-- buckets therefore reproduces the global total exactly, and a gap in collection
-- never silently bridges two non-adjacent observations.
CREATE TABLE market_observations_hourly (
  asset_id uuid NOT NULL REFERENCES assets(id),
  source text NOT NULL,
  bucket timestamptz NOT NULL,
  observations integer NOT NULL,
  expected_observations integer NOT NULL,
  complete boolean NOT NULL,
  adjacent_pairs integer NOT NULL,

  min_price_open numeric(20,8), min_price_high numeric(20,8),
  min_price_low numeric(20,8), min_price_close numeric(20,8),
  median_price_open numeric(20,8), median_price_high numeric(20,8),
  median_price_low numeric(20,8), median_price_close numeric(20,8),

  listing_qty_open integer, listing_qty_high integer,
  listing_qty_low integer, listing_qty_close integer,

  min_price_transitions integer NOT NULL,
  median_price_transitions integer NOT NULL,
  listing_qty_transitions integer NOT NULL,
  listing_contractions integer NOT NULL,
  listing_expansions integer NOT NULL,
  sales_24h_volume_transitions integer NOT NULL,
  sales_24h_volume_close integer,

  source_age_median_seconds numeric(12,3),
  source_age_max_seconds numeric(12,3),
  observed_at_close timestamptz,

  built_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (asset_id, source, bucket),
  CONSTRAINT hourly_bucket_aligned CHECK (date_trunc('hour', bucket) = bucket),
  CONSTRAINT hourly_observation_bounds CHECK (observations > 0 AND observations <= expected_observations),
  CONSTRAINT hourly_complete_consistent CHECK (complete = (observations = expected_observations))
);
--> statement-breakpoint
CREATE INDEX observations_hourly_bucket ON market_observations_hourly(bucket DESC, asset_id);
--> statement-breakpoint
CREATE TABLE market_observations_daily (
  asset_id uuid NOT NULL REFERENCES assets(id),
  source text NOT NULL,
  bucket date NOT NULL,
  observations integer NOT NULL,
  expected_observations integer NOT NULL,
  complete boolean NOT NULL,
  adjacent_pairs integer NOT NULL,

  min_price_open numeric(20,8), min_price_high numeric(20,8),
  min_price_low numeric(20,8), min_price_close numeric(20,8),
  median_price_open numeric(20,8), median_price_high numeric(20,8),
  median_price_low numeric(20,8), median_price_close numeric(20,8),

  listing_qty_open integer, listing_qty_high integer,
  listing_qty_low integer, listing_qty_close integer,

  min_price_transitions integer NOT NULL,
  median_price_transitions integer NOT NULL,
  listing_qty_transitions integer NOT NULL,
  listing_contractions integer NOT NULL,
  listing_expansions integer NOT NULL,
  -- Published rolling sales update about once a day; this counts observed value
  -- changes and is never a count of trades and never summable across buckets.
  sales_24h_volume_transitions integer NOT NULL,
  sales_24h_volume_close integer,

  source_age_median_seconds numeric(12,3),
  source_age_max_seconds numeric(12,3),
  observed_at_close timestamptz,

  built_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (asset_id, source, bucket),
  CONSTRAINT daily_observation_bounds CHECK (observations > 0 AND observations <= expected_observations),
  CONSTRAINT daily_complete_consistent CHECK (complete = (observations = expected_observations))
);
--> statement-breakpoint
CREATE INDEX observations_daily_bucket ON market_observations_daily(bucket DESC, asset_id);
