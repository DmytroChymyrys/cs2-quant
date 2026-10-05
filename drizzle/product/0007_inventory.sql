-- Steam inventory persistence foundation.
--
-- Written by hand, like every migration in this stream: drizzle.product.config.ts
-- reads only src/lib/product/schema.ts and does not know about the market tables
-- this database shares, so generating here emits DROP TABLE for all of them.
--
-- Three tables, and the separation between them is the design:
--
--   steam_integrations   the product integration. NOT authentication. It keeps
--                        its own SteamID so that disconnecting Steam is a
--                        policy decision, not an accident of cascade.
--   inventory_sync_runs  append-only provenance for every attempt.
--   inventory_holdings   temporal ownership intervals.
--
-- Inventory never writes to auth_users, auth_accounts or app_users. The only
-- relationship to identity is app_users.id as an owner.
CREATE TABLE IF NOT EXISTS "steam_integrations" (
  "user_id" uuid PRIMARY KEY REFERENCES "app_users"("id") ON DELETE CASCADE,
  /*
   * The integration's OWN copy of the SteamID.
   *
   * Deliberately not read from auth_accounts at sync time. If synchronisation
   * depended on the authentication row, disconnecting Steam would silently
   * destroy inventory capability through a foreign key rather than through a
   * product decision -- and the approved lifecycle says a disconnect must
   * preserve the last successful snapshot.
   */
  "steam_id" text NOT NULL UNIQUE,
  "status" text DEFAULT 'ACTIVE' NOT NULL,
  "connected_at" timestamp with time zone DEFAULT now() NOT NULL,
  "disconnected_at" timestamp with time zone,
  "last_attempt_at" timestamp with time zone,
  "last_success_at" timestamp with time zone,
  /*
   * The outcome of the most recent ATTEMPT, which is a different fact from the
   * integration's lifecycle status and from whether a snapshot is stale.
   * Keeping the three apart is what lets the product say "a snapshot exists,
   * the last attempt was rate limited, and the data is four hours old" without
   * forcing those into one enum.
   */
  "last_outcome" text,
  "next_eligible_at" timestamp with time zone,
  /*
   * Synchronisation lease. There is deliberately no SYNCING status: a sync is
   * in flight exactly when sync_lease_expires_at > now(). Expiry IS the crash
   * recovery -- a process that dies mid-fetch leaves a lease that the next
   * attempt reclaims on its own, with no stuck state to repair by hand.
   *
   * The same shape the derived-snapshot builds and the collector window claim
   * already use: the database arbitrates, not the application.
   */
  "sync_lease_id" uuid,
  "sync_lease_expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "steam_integration_status" CHECK ("status" in ('ACTIVE','DISCONNECTED')),
  CONSTRAINT "steam_integration_outcome" CHECK ("last_outcome" is null or "last_outcome" in
    ('OK_ITEMS','OK_EMPTY','UNAVAILABLE','PROVIDER_ERROR','RATE_LIMITED','TIMEOUT'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "steam_integration_lease" ON "steam_integrations"
  USING btree ("sync_lease_expires_at") WHERE "sync_lease_expires_at" is not null;--> statement-breakpoint

-- Append-only. One row per attempt, authoritative or not.
CREATE TABLE IF NOT EXISTS "inventory_sync_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "app_users"("id") ON DELETE CASCADE,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finished_at" timestamp with time zone,
  "outcome" text,
  /*
   * Only an authoritative run may establish absence. A privacy refusal or a
   * provider error is evidence about the PROVIDER, not about the inventory, so
   * it must never close an ownership interval.
   */
  "authoritative" boolean DEFAULT false NOT NULL,
  "http_status" integer,
  "error_code" text,
  "items_received" integer DEFAULT 0 NOT NULL,
  "items_matched" integer DEFAULT 0 NOT NULL,
  "items_unmatched" integer DEFAULT 0 NOT NULL,
  "items_ambiguous" integer DEFAULT 0 NOT NULL,
  "items_added" integer DEFAULT 0 NOT NULL,
  "items_removed" integer DEFAULT 0 NOT NULL,
  -- A stable steam_asset_id whose market_hash_name changed. Not a normal item
  -- mutation; recorded so a rename or a provider defect is visible.
  "identity_anomalies" integer DEFAULT 0 NOT NULL,
  "items_reappeared" integer DEFAULT 0 NOT NULL,
  "duration_ms" integer,
  "trigger" text NOT NULL,
  CONSTRAINT "inventory_run_outcome" CHECK ("outcome" is null or "outcome" in
    ('OK_ITEMS','OK_EMPTY','UNAVAILABLE','PROVIDER_ERROR','RATE_LIMITED','TIMEOUT')),
  CONSTRAINT "inventory_run_trigger" CHECK ("trigger" in ('CRON','MANUAL','FIRST_CONNECT'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_runs_user_time" ON "inventory_sync_runs"
  USING btree ("user_id","started_at" DESC);--> statement-breakpoint

/*
 * Temporal ownership intervals.
 *
 * One row is one period during which a Steam item instance was observed in a
 * user's inventory. An item that leaves and returns is TWO rows, never a
 * reopened one, so "what did this user own at time T" is a range predicate
 * that stays correct for every T.
 *
 * V1 LIMITATION, stated so nobody infers otherwise: ownership intervals are
 * preserved, but quantity history within an interval is NOT. A stack whose
 * count changes updates the row in place; the previous count is not retained
 * anywhere, and it cannot be reconstructed from inventory_sync_runs because
 * those hold per-run totals, not per-item evidence.
 */
CREATE TABLE IF NOT EXISTS "inventory_holdings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "app_users"("id") ON DELETE CASCADE,
  -- The Steam inventory INSTANCE identity. Not the market identity.
  "steam_asset_id" text NOT NULL,
  -- Corroborating upstream identifiers, so an upstream rename is detectable
  -- rather than silent.
  "class_id" text,
  "instance_id" text,
  /*
   * The V1 canonical market key. NOT an immutable global identity: Valve owns
   * this string and may rename it. It is the strongest cross-system key we
   * have -- the Steam inventory response, both provider universes, assets and
   * the catalogue all speak it -- and V1 deliberately does not introduce a
   * global asset master table to hedge a hypothetical rename.
   */
  "market_hash_name" text NOT NULL,
  -- NFC, trimmed, internal whitespace collapsed. Case is PRESERVED: the broad
  -- universe contains case-insensitive collisions, so folding would merge
  -- genuinely different items.
  "normalized_name" text NOT NULL,
  "quantity" integer DEFAULT 1 NOT NULL,
  "tradable" boolean,
  "marketable" boolean,
  "tradelocked_until" timestamp with time zone,
  "name_tag" text,
  -- Identity resolution and market-data depth are separate questions and are
  -- never encoded in one another.
  "identity_status" text NOT NULL,
  "market_depth" text NOT NULL,
  -- Advisory only: present when the item also has deep FloatAlpha
  -- intelligence. Holdings are NOT keyed on it and survive its removal.
  "asset_id" uuid REFERENCES "assets"("id") ON DELETE SET NULL,
  "first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "removed_at" timestamp with time zone,
  /*
   * Run provenance is the evidence; the timestamps are query convenience.
   * Only authoritative runs ever appear here, so provenance cannot be polluted
   * by a failed attempt.
   *
   * The run references cascade for one reason only: runs are append-only and
   * are never deleted individually, so the single way one disappears is with
   * its owning account -- and account deletion must not be blocked by a
   * restrict on a row that is going away in the same statement.
   */
  "first_seen_run_id" uuid NOT NULL REFERENCES "inventory_sync_runs"("id") ON DELETE CASCADE,
  "last_seen_run_id" uuid NOT NULL REFERENCES "inventory_sync_runs"("id") ON DELETE CASCADE,
  "removed_run_id" uuid REFERENCES "inventory_sync_runs"("id") ON DELETE CASCADE,
  "removed_reason" text,
  CONSTRAINT "inventory_identity_status" CHECK ("identity_status" in ('MATCHED','UNMATCHED','AMBIGUOUS')),
  CONSTRAINT "inventory_market_depth" CHECK ("market_depth" in ('TRACKED','BROAD','NONE')),
  CONSTRAINT "inventory_quantity_positive" CHECK ("quantity" > 0),
  CONSTRAINT "inventory_removed_reason" CHECK ("removed_reason" is null or "removed_reason" in ('ABSENT','IDENTITY_CHANGED')),
  -- An unresolved item cannot carry market depth it does not have.
  CONSTRAINT "inventory_unmatched_has_no_depth"
    CHECK ("identity_status" <> 'UNMATCHED' or "market_depth" = 'NONE'),
  -- TRACKED is exactly "this resolves to a deep-tracked asset", so the FK must exist.
  CONSTRAINT "inventory_tracked_has_asset"
    CHECK ("market_depth" <> 'TRACKED' or "asset_id" is not null),
  -- Closure moves as one fact. A half-closed interval would make ownership
  -- history ambiguous in exactly the cases that matter.
  CONSTRAINT "inventory_closure_consistent" CHECK (
    ("removed_at" is null and "removed_run_id" is null and "removed_reason" is null)
    or ("removed_at" is not null and "removed_run_id" is not null and "removed_reason" is not null))
);--> statement-breakpoint
/*
 * One OPEN interval per instance. Deliberately an invariant guard rather than
 * an ON CONFLICT target: the synchronisation lease already guarantees a single
 * writer per user, so the apply path is a plain read-diff-write. If a defect
 * ever admits two writers this index raises an error instead of silently
 * corrupting ownership history.
 */
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_one_open_interval" ON "inventory_holdings"
  USING btree ("user_id","steam_asset_id") WHERE "removed_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_user_open" ON "inventory_holdings"
  USING btree ("user_id") WHERE "removed_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_user_market_key" ON "inventory_holdings"
  USING btree ("user_id","normalized_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_user_interval" ON "inventory_holdings"
  USING btree ("user_id","first_seen_at","removed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_unresolved" ON "inventory_holdings"
  USING btree ("user_id") WHERE "identity_status" <> 'MATCHED';
