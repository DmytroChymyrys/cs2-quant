-- Durable per-run record of the refresh lifecycle. DERIVED database only.
--
-- The canary needs timings, memory and retention decisions for every attempted
-- run over 24 hours. Those numbers exist only in the platform's runtime logs,
-- which roll off, so evidence that is supposed to justify a permanent cadence
-- would evaporate before the decision is made. This writes it down.
--
-- Deliberately NOT foreign-keyed to derived_market_snapshots: a failed run has
-- no snapshot at all, and a successful one's snapshot may later be deleted by
-- retention, but the record of what happened must outlive both.
CREATE TABLE derived_refresh_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL DEFAULT now(),
  result text NOT NULL,
  stage text,
  error_code text,
  snapshot_id text,
  active_before text,
  active_after text,
  invoked_by text,
  -- Full structured outcome, minus the bulky validation payload.
  summary jsonb NOT NULL
);
CREATE INDEX derived_refresh_runs_recent ON derived_refresh_runs (finished_at DESC);
