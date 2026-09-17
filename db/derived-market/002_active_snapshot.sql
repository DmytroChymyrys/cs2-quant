-- Active snapshot pointer. DERIVED database only; no market table is touched.
--
-- Exactly one row can exist, so "which snapshot is live" is a single atomic
-- UPDATE rather than an environment variable that needs a redeploy. The foreign
-- key guarantees the pointer can only name a snapshot that is already fully
-- persisted, because persistSnapshot commits the parent and all children in one
-- transaction.
CREATE TABLE derived_active_snapshot (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  snapshot_id text NOT NULL REFERENCES derived_market_snapshots(id),
  activated_at timestamptz NOT NULL DEFAULT now(),
  activated_by text,
  -- Free-form record of what the activation was based on. Never authoritative.
  note text
);
