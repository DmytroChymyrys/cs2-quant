-- L1 content-addressed History payload dedup. Strictly additive.
--
-- market_observations is append-only by trigger (0001), which rejects UPDATE as
-- well as DELETE/TRUNCATE. A backfilled foreign-key COLUMN on that table is
-- therefore impossible without weakening the guarantee, so the observation link
-- lives in its own side table. Nothing about market_observations changes, and
-- raw_history_payload remains the authoritative copy.
CREATE TABLE market_history_payloads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES assets(id),
  source text NOT NULL,
  payload_sha256 char(64) NOT NULL,
  payload jsonb NOT NULL,
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  observation_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT history_payload_identity UNIQUE (asset_id, source, payload_sha256),
  CONSTRAINT history_payload_seen_order CHECK (last_seen_at >= first_seen_at),
  CONSTRAINT history_payload_count_positive CHECK (observation_count >= 0)
);
--> statement-breakpoint
CREATE INDEX history_payload_asset_seen ON market_history_payloads(asset_id, source, first_seen_at DESC);
--> statement-breakpoint
-- One row per observation that has been linked to its deduplicated payload.
-- Append-only in practice; the backfill inserts and never rewrites.
CREATE TABLE market_observation_history (
  observation_id uuid PRIMARY KEY REFERENCES market_observations(id),
  history_payload_id uuid NOT NULL REFERENCES market_history_payloads(id),
  linked_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX observation_history_payload ON market_observation_history(history_payload_id);
