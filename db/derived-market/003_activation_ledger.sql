-- Activation history and durable protection. DERIVED database only.
--
-- derived_active_snapshot records only what is live RIGHT NOW, because it is a
-- single row updated in place. Retention needs to know what was live BEFORE, so
-- that the snapshots a rollback would target are never deletion candidates.
-- That history has to be written down; it cannot be recovered afterwards.
CREATE TABLE derived_snapshot_activations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  snapshot_id text NOT NULL,
  activated_at timestamptz NOT NULL DEFAULT now(),
  activated_by text,
  note text
);
-- Deliberately NO foreign key to derived_market_snapshots. This is an audit
-- record of what was published and when, and that record must outlive the data
-- it describes; a foreign key would either block retention or erase the history
-- retention just acted on.
CREATE INDEX derived_snapshot_activations_recent
  ON derived_snapshot_activations (activated_at DESC, id DESC);

-- Durable protection, as opposed to a command-line flag that is only as good as
-- the operator remembering it on every single run. A snapshot listed here cannot
-- be deleted by retention, and the foreign key means the database physically
-- refuses to delete it even if the retention code were wrong.
CREATE TABLE derived_protected_snapshots (
  snapshot_id text PRIMARY KEY REFERENCES derived_market_snapshots(id),
  protected_at timestamptz NOT NULL DEFAULT now(),
  protected_by text,
  -- Required: a protection nobody can explain is a protection nobody can retire.
  reason text NOT NULL CHECK (length(btrim(reason)) > 0)
);

-- Seed the ledger from the pointer, so a database that was already serving a
-- snapshot before this migration does not look as though nothing was ever
-- published. Only the current activation is recoverable; earlier ones are not,
-- which is precisely why the ledger exists from here on.
INSERT INTO derived_snapshot_activations (snapshot_id, activated_at, activated_by, note)
SELECT snapshot_id, activated_at, activated_by, 'seeded from the active pointer by migration 003'
  FROM derived_active_snapshot;
