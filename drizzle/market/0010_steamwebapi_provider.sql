-- Provider #2: SteamWebAPI.
--
-- Hand-written. `drizzle.market.config.ts` reads only the market schema, and
-- generating into this stream emits DROP TABLE for every product table it
-- cannot see. Review the SQL here instead.
--
-- Identity and the run ledger are NOT duplicated. `provider_assets` and
-- `provider_collection_runs` are already keyed by (provider, venue) and were
-- written for exactly this, so SteamWebAPI registers alongside Skinport and
-- its static metadata goes in `provider_assets.static_metadata`.
--
-- Market state IS separate. Steam reports a different kind of evidence from a
-- listing venue — a standing buy-order book, a listed offer count and realised
-- sales counts across four horizons — and flattening that into the shared
-- listing columns would discard the reason for paying for this source. Shared
-- concepts keep FloatAlpha's existing vocabulary; Steam-specific concepts get
-- their own typed columns rather than a JSON blob.

CREATE TABLE IF NOT EXISTS steam_market_state (
  provider_asset_id uuid PRIMARY KEY REFERENCES provider_assets(id) ON DELETE CASCADE,
  -- Digest of meaningful Steam-side market state only. Contains no timestamp,
  -- no run id, and nothing from the third-party mirror, so an asset that did
  -- not move hashes identically and writes no history row.
  state_hash text NOT NULL,
  -- Whether the asset appeared in the last successful full response. Absence
  -- is absence; it is never written as a zero, which would assert an observed
  -- empty market the provider did not report.
  present boolean NOT NULL,

  -- ── shared vocabulary (concepts Skinport also reports) ─────────────────
  currency text,
  -- Steam's listed offer count. Recorded as the venue's listed quantity, but
  -- note the provider returns 0 and never null for this field, so a zero here
  -- cannot be distinguished from "not measured". See docs/PROVIDER_2.
  quantity integer,
  min_price numeric(20, 8),
  max_price numeric(20, 8),
  mean_price numeric(20, 8),
  median_price numeric(20, 8),

  -- ── Steam-specific evidence (no honest Skinport equivalent) ────────────
  -- Realised sale prices, as distinct from the lowest standing listing.
  price_latest_sell numeric(20, 8),
  price_median_24h numeric(20, 8),
  price_median_7d numeric(20, 8),
  price_median_30d numeric(20, 8),
  price_median_90d numeric(20, 8),
  price_safe numeric(20, 8),
  price_min_observed numeric(20, 8),
  price_mix numeric(20, 8),

  -- The standing bid book. FloatAlpha observes no demand side from Skinport.
  buy_order_price numeric(20, 8),
  buy_order_median numeric(20, 8),
  buy_order_avg numeric(20, 8),
  buy_order_volume integer,

  -- Kept beside `quantity` deliberately: the shared column carries the
  -- normalized concept, this one carries the provider's own field unaltered.
  offer_volume integer,

  -- Realised trade counts. Skinport gives listings, never trades.
  sold_today integer,
  sold_24h integer,
  sold_7d integer,
  sold_30d integer,
  sold_90d integer,
  sold_total integer,
  market_volume numeric(20, 8),
  points integer,
  hours_to_sold integer,

  -- ── provider freshness (excluded from state_hash) ──────────────────────
  -- Different fields in one response carry different ages. These record what
  -- the provider says about its own data and must not cause a state change.
  price_updated_at timestamptz,
  latest_steam_sell_at timestamptz,

  -- When this state began, not when it was last confirmed.
  state_since timestamptz NOT NULL,
  -- The most recent run that confirmed this state, changed or not.
  observed_at timestamptz NOT NULL,
  collector_run_id uuid NOT NULL REFERENCES collector_runs(id)
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS steam_market_state_history (
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
  price_latest_sell numeric(20, 8),
  price_median_24h numeric(20, 8),
  price_median_7d numeric(20, 8),
  price_median_30d numeric(20, 8),
  price_median_90d numeric(20, 8),
  price_safe numeric(20, 8),
  price_min_observed numeric(20, 8),
  price_mix numeric(20, 8),
  buy_order_price numeric(20, 8),
  buy_order_median numeric(20, 8),
  buy_order_avg numeric(20, 8),
  buy_order_volume integer,
  offer_volume integer,
  sold_today integer,
  sold_24h integer,
  sold_7d integer,
  sold_30d integer,
  sold_90d integer,
  sold_total integer,
  market_volume numeric(20, 8),
  points integer,
  hours_to_sold integer,
  price_updated_at timestamptz,
  latest_steam_sell_at timestamptz,
  -- Point-in-time reconstruction reads the latest row at or before an instant;
  -- the run ledger proves observation happened in between.
  observed_at timestamptz NOT NULL,
  collector_run_id uuid NOT NULL REFERENCES collector_runs(id)
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS steam_market_state_history_asset
  ON steam_market_state_history (provider_asset_id, observed_at DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS steam_market_state_history_run
  ON steam_market_state_history (collector_run_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS steam_market_state_observed
  ON steam_market_state (observed_at DESC);--> statement-breakpoint

-- Provider-supplied historical evidence, retrieved now.
--
-- The distinction matters and is structural, not a comment: `observed_date` is
-- the date the provider attributes a value to, and `retrieved_at` is when we
-- asked. A 2014 row here means "the provider told us in 2026 what it holds for
-- 2014", never "FloatAlpha observed this in 2014".
--
-- The unique constraint is the idempotency mechanism: re-running a backfill
-- updates in place and cannot duplicate a point.
CREATE TABLE IF NOT EXISTS steam_price_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider_asset_id uuid NOT NULL REFERENCES provider_assets(id) ON DELETE CASCADE,
  -- Which provider series this came from, e.g. 'steam'.
  series text NOT NULL,
  observed_date date NOT NULL,
  price numeric(20, 8),
  sold integer,
  retrieved_at timestamptz NOT NULL DEFAULT now(),
  collector_run_id uuid REFERENCES collector_runs(id),
  source_endpoint text NOT NULL,
  collector_version text NOT NULL,
  UNIQUE (provider_asset_id, series, observed_date)
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS steam_price_history_asset_date
  ON steam_price_history (provider_asset_id, observed_date DESC);
