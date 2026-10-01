-- Separate DERIVED_MARKET_DATABASE_URL only. No raw/product/catalog table mutations.
--
-- Durable state for a snapshot build that spans several invocations.
--
-- A build exists so that derivation, which is 72% of refresh wall time and
-- grows linearly with the universe, no longer has to finish inside one
-- function invocation. Nothing here is read by the product: readers resolve
-- snapshots through derived_active_snapshot, and this table never moves that
-- pointer.
CREATE TABLE derived_snapshot_builds (
  build_id text PRIMARY KEY,
  -- Null until PLANNING fixes the identity. Set null rather than blocking if
  -- retention later removes the snapshot this build produced.
  snapshot_id text REFERENCES derived_market_snapshots(id) ON DELETE SET NULL,
  method text NOT NULL,
  -- The scope is frozen at creation. Later invocations must derive the window
  -- the build started with, never a window recomputed from their own clock.
  scope_from timestamptz NOT NULL,
  scope_to timestamptz NOT NULL,
  max_days integer NOT NULL CHECK(max_days > 0),
  -- Universe identity, so a build cannot silently continue against a changed
  -- asset list.
  universe_sha256 text NOT NULL,
  assets_total integer NOT NULL CHECK(assets_total > 0),
  assets_completed integer NOT NULL DEFAULT 0 CHECK(assets_completed >= 0),
  status text NOT NULL CHECK(status IN
    ('PLANNING','DERIVING','COMPLETING','ACTIVATED','REJECTED','FAILED','ABANDONED')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  error_stage text,
  error_code text,
  validation jsonb,
  note text,
  invoked_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CHECK(assets_completed <= assets_total)
);

-- At most one build may be open, enforced by the database rather than by
-- convention: two invocations racing to create one both attempt this index and
-- exactly one survives. The constant expression makes every open row collide.
CREATE UNIQUE INDEX derived_builds_single_open
  ON derived_snapshot_builds ((true))
  WHERE status IN ('PLANNING','DERIVING','COMPLETING');

CREATE INDEX derived_builds_recent ON derived_snapshot_builds (created_at DESC);

-- Per-asset checkpoints. The unit of resumption is one asset, which is also
-- the unit deriveChunked already works in, so a resumed build repeats at most
-- one asset's work.
CREATE TABLE derived_build_assets (
  build_id text NOT NULL REFERENCES derived_snapshot_builds(build_id) ON DELETE CASCADE,
  asset_name text NOT NULL,
  -- Derivation order, fixed at planning so resumption is deterministic.
  position integer NOT NULL,
  status text NOT NULL CHECK(status IN ('PENDING','DONE')),
  -- What this asset's invocation believed it wrote. Summed at completion to
  -- give validation an expected count that is independent of the rows being
  -- validated: comparing the table against itself would check nothing.
  features_written integer CHECK(features_written >= 0),
  history_values_written integer CHECK(history_values_written >= 0),
  observations integer CHECK(observations >= 0),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  completed_at timestamptz,
  PRIMARY KEY(build_id, asset_name)
);

CREATE INDEX derived_build_assets_pending
  ON derived_build_assets (build_id, position) WHERE status = 'PENDING';
