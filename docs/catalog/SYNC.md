# Synchronization

Set `CATALOG_DATABASE_URL` to an explicitly selected development database. It is intentionally separate from `DATABASE_URL`, which supplies authoritative market asset identities for read-only reconciliation.

```sh
npm run db:migrate:catalog
npm run catalog:sync -- --verify-tracked
```

The migration is additive and checksummed. Apply it to an isolated development database first. Do not run it against production without explicit deployment authorization. The implementation was tested using PGlite and a separate local PostgreSQL database, `floatalpha_catalog_v1`.

For reproducible offline source input and an existing identity snapshot:

```sh
npm run catalog:sync -- \
  --source-dir /path/to/pinned/source/files \
  --tracked-file reports/catalog/tracked-assets.json \
  --report reports/catalog/reconciliation.json
```

Each source file must match the checked-in manifest hash, byte size and count. Without `--source-dir`, missing files download to `.cache/catalog/<commit>/`. Existing cached files are verified; corrupt input aborts rather than being silently replaced. No JSON download happens in a page request.

The command fetches every selected dataset, validates and normalizes, detects duplicate identities, then uses one transaction and an advisory lock to upsert catalog/media mappings and reconcile unchanged market UUIDs. Failed transactions roll back. Duplicate source IDs and excessive validation failures stop before writes. Individual diagnostics retain dataset, source ID, record index and fields. Optional slow artwork verification runs after the atomic identity transaction; an interrupted verification can be resumed.

Output includes source and normalized totals, every actual asset type, created/updated/unchanged/deprecated counts, all invalid and duplicate diagnostics, media states, and each tracked UUID/name/match/candidate/reason. It distinguishes URL coverage from verified artwork. No missing or ambiguous tracked rows are hidden in aggregate counts.

Repeated identical input preserves catalog, media, mapping and source-semantic timestamps. Operational sync runs are append-only history. Absent source records are marked deprecated, retained, and excluded from active joins. Changed media URLs reset verification; unchanged URLs retain it. `source_updated_at` stays null when no per-record source timestamp exists; the manifest and `source_revision` capture snapshot provenance.

## Updating the source

V1 is manual and pinned. Review a new maintained ByMykel commit, inspect changed dataset shapes/types and identity behavior, download the selected files, and update `config/catalog/upstream-manifest.json` with that commit, snapshot time, exact SHA-256 values, sizes and counts. Re-run the validators, fixtures, isolated import, idempotency check and reconciliation before rollout. Bump the normalizer version when its semantics change. Do not merge new duplicate names by picking an arbitrary candidate.

A later daily or game-manifest-triggered job can run the same command with a reviewed snapshot. No automatic catalog scheduler was added. Existing image delivery health refresh remains independent: development startup timer every ten minutes; protected production POST health endpoint on the separately configured external schedule. Existing collector schedules are untouched.

## Production rollout not executed

Deploy only after explicit authorization: migrate the selected catalog database, sync the reviewed source and live tracked identity list, verify exact mappings/media, configure the catalog connection and existing health refresh, then verify initial HTML and monitoring. Catalog failure falls back to text-only. No production database, deployment or external scheduler was changed in this task.
