# Market data architecture

## Preservation audit (before implementation)

The protected POST route calls `collectSkinport`. It claims `SKINPORT:<five-minute UTC boundary>` before making two concurrent market-wide requests. The client reads Items with `tradable=1` and Sales History without it, USD/app 730, Brotli accept header, no cache and no retries. Both results settle before failures are recorded. Numeric tokens are parsed losslessly and prices become numeric(20,8) strings. Unversioned duplicates fail across the entire response, including untracked rows. Versioned rows are excluded. Missing Items skip observations; missing History preserves the Items observation and marks the run PARTIAL.

The observation clock is read after source identity indexing. Observation/status writes are atomic, and completion is stamped after that transaction is acknowledged. Lost commit acknowledgements reconcile against database truth. Existing statuses, error codes, clock calls, append-only trigger and uniqueness constraints must remain intact.

Existing persistence already has `collector_runs.metadata`, response hashes/timing, per-observation Items/History provenance and `asset_source_mappings`. Use these instead of adding competing tables or rewriting observation history. Persist a versioned provider/venue/endpoint/statistic manifest once per run; every observation joins its non-null collector_run_id to it. Legacy SKINPORT rows are projected as SKINPORT_DIRECT/SKINPORT with an explicitly marked inferred legacy normalization version. Keep existing raw per-asset payloads exactly unchanged.

## Planned boundaries

Provider → adapter → raw DTO → transformer → canonical observation → validation → identity resolution → existing atomic persistence.

Move the client/schema implementation without changing HTTP behavior. Retain old imports as compatibility exports. The transformer retains all five listing statistics and all four sales windows with their separate min/max/avg/median fields; do not flatten them into an unlabeled price. Canonical monetary values use decimal strings, never JS floating point.

Resolve current approved names against the existing tracked internal IDs without another database query. Future provider mappings use the existing mapping table with provider/venue-qualified source keys; legacy SKINPORT retains its original key. No new identities are created during collection.

cs2.sh has no checked-in authoritative endpoint fixtures. Add a disabled, fail-closed client/transformer with pending mappings, rather than guessing its records or venue capabilities. Its configuration is lazy and isolated from Skinport. No scheduler or active/shadow writer is added.

Raw full-response retention remains disabled; add an opt-in sink contract with explicit expiration, separate from the mandatory per-asset provenance already stored. No giant payload storage starts as part of this refactor.

No migration is necessary for this compatibility strategy. No database schema, production configuration, schedule or UI changes are planned.

## Implemented architecture

```mermaid
flowchart LR
  P[Provider] --> A[Source adapter]
  A --> R[Validated provider DTO]
  R --> T[Provider transformer]
  T --> C[Canonical observation]
  C --> V[Canonical validation]
  V --> I[Internal identity resolver]
  I --> W[Compatibility writer]
  W --> DB[Existing atomic observation and run transaction]
```

The source layer lives in `src/market-data`. Existing `src/lib/sources/skinport` imports remain compatibility exports so discovery, seeding and scripts keep their interfaces. `collectSkinport` remains the scheduler-facing orchestration function and owns run claiming, diagnostics, coverage status, persistence and timing reconciliation. The adapter always settles both upstream requests. Preparing canonical unversioned indexes still happens before the single observation clock read. Source validation limits, null/undefined handling and raw payload encoding are unchanged.

The transformer operates on matched Item/History DTO pairs, not HTTP responses. It returns an unresolved canonical identity, exact decimal strings, separately labeled listing statistics and sales statistics, four rolling windows, timestamps and provenance. Ingestion validates, resolves to the existing internal asset UUID, and projects to the original columns. The writer rejects other providers/venues and versioned rows. It does not claim that its Skinport compatibility table is a universal multi-source production sink.

### Provider, venue, capability and identity

`SKINPORT_DIRECT` is the provider and `SKINPORT` is its venue. `CS2_SH/SKINPORT` is a second provider path for the same venue, not another venue. `providerPriority('SKINPORT')` expresses the future preference without implementing aggregation. Two mappings can resolve to one internal UUID.

`capabilitiesFor(provider, venue)` returns explicit source support, never conclusions derived from row nulls. Direct Skinport supplies aggregate ask/listing prices and quantity, rolling sales prices/volume and an Items update timestamp. It does not supply bids, individual listings, or listing-price candles through these two endpoints. cs2.sh capabilities return undefined (unverified), not fabricated false/true values. Capability metadata is descriptive; the current ingestion path does not use it to reinterpret stored columns.

The existing mapping table is retained. `mappingSourceKey` maps direct Skinport to the existing `SKINPORT` key; future pairs use `CS2_SH:SKINPORT`, `CS2_SH:STEAM`, etc. Existing uniqueness constraints then scope mappings to a provider/venue pair. A typed source identity also includes version. Persisted mapping support is currently unversioned only; enabling variants would require a separate identity review and is outside this task. No provider creates new internal assets while collecting. Current mappings are projected from the approved tracked canonical names, preserving the existing join and avoiding extra production DB calls.

### Configuration and isolation

| Configuration | Default | Current behavior |
| --- | --- | --- |
| `SKINPORT_DIRECT_ENABLED` | `true` | Preserves current collector activation. Explicit false blocks requests; it does not alter the cron schedule. |
| `CS2SH_ENABLED` | `false` | No requests, writes or key requirement. |
| `CS2SH_API_KEY` | absent | Required only when explicitly enabled; endpoint mapping still fails closed. |
| `RAW_SOURCE_RETENTION_ENABLED` | `false` | Optional full-response sink contract stays inactive. |
| `RAW_SOURCE_RETENTION_DAYS` | `7` | Explicit TTL, allowed 1–30 days, for a future configured sink. |

Registry entries are lazy provider factories. Skinport never reads cs2.sh or raw-retention settings. Invalid experimental settings cannot prevent its collection. The protected route is still Skinport-only; there is no multi-provider scheduler. Legacy Skinport error codes/statuses are preserved while adapter errors additionally carry provider-scoped classifications. Structured operation counts and provider/venue identifiers supplement existing logs; no API keys or response bodies are added to logs.

### cs2.sh status: DISABLED / mapping pending

No authoritative cs2.sh response fixtures or chosen endpoint contract were present in the repository. Its DTO is deliberately opaque, its parser/transformer reports `SOURCE_MAPPING_PENDING`, and its client has no HTTP implementation. Supplying a key does not bypass this guard. There are no invented BUFF/Youpin/Steam/Skinport/CSFloat fixtures or falsely implemented mappings. Tests exercise disabled/configuration/pending behavior, not pretend provider functionality.

Shadow and active modes are deferred. Future shadow collection requires an independent entry point/run scope, fixture-validated venue mappings and separate storage; it must never call the Skinport compatibility writer or affect current UI queries. The canonical provider/venue/identity/statistic model supplies that boundary now. No shadow jobs or tables are created prematurely.

### Raw retention

Existing per-asset raw JSON provenance remains mandatory and unchanged. The new optional retention contract is for full responses and is NOT wired into the production collector. A future sink must implement bounded object size, expiration enforcement and cleanup, then be explicitly integrated outside the critical Skinport workflow. The helper calculates expiresAt and fails clearly when enabled without a sink. Setting the environment flag alone does not suddenly store full responses.

### Validation compatibility

Canonical validation checks known provider/venue, matching provenance, transformer version/endpoints, valid Date objects, known currency, exact non-negative numeric(20,8)-compatible decimals, non-negative integer quantities/volumes and known unique sales windows/statistics. Identity resolution follows validation and rejects absent or ambiguous mappings. Legitimate null prices, missing History, zero listings, zero sales and unchanged values stay valid. Future/stale source timestamps within the original accepted epoch range remain observations; freshness is a separate audit, not an added rejection rule. OHLC is not modeled as a scalar sales price. A future candle source must add a properly typed listing-candle measurement with explicit semantics.

## Validation and rollout

Before refactoring, four golden cases were generated from the original normalizer: complete, null/zero, absent History and extreme decimal/unknown-metadata precision. New tests compare every serialized persisted field against these fixed outputs. Existing collector tests retain concurrency, rate limit/no retry, schema failures, variant exclusion, coverage, duplicate claims, unchanged append behavior and lost-acknowledgement timing checks. PGlite executes the original migrations, real store SQL and a 100-asset collection twice in one bucket and once in the next.

There are no schema additions or migration IDs. No old migration is edited. Any future deployment should run the full local checks, deploy the preservation refactor with cs2.sh/retention disabled, and review the first scheduled run's manifest and counts without changing schedule. Rollback requires only the previous application build: original columns and provenance remain compatible. Deployment itself is not part of this task.
