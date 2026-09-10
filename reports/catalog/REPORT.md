# FloatAlpha canonical CS2 catalog V1 — final report

Implemented and verified locally on 2026-09-10. No production deployment or writes, no commit, no catalog scheduler creation. Existing uncommitted work was preserved.

## Existing implementation audit

Preflight inspected git status/diff, five recent commits, provider/resolver/health/configuration/routes, image components and usages, schemas/migrations and relevant tests. The latest committed baseline was da8b471; substantial image/UI/market-adapter work already existed uncommitted. [Preflight status](preflight-status.txt) records that state.

The working system had a 100-name static Steam mapping, /api/asset-images/[name] proxy, transformed WebP bytes, a 2 MB upstream bound, persisted negative resolution states, and cached provider health. Five sentinels were checked in two rounds independently of requests. Initial image geometry was already server-rendered; the page supplied name-based proxy URLs. Table wells were 44×36 and detail wells 160×104. All 36 relevant preflight tests passed.

## Source inventory

Used the maintained [ByMykel/CSGO-API repository](https://github.com/ByMykel/CSGO-API) at pinned revision be84e43a2eb379faf653158e409a2c90c4072312, commit time 2026-09-09T23:28:46Z. It is an unofficial community source. These are selected item datasets, not a blind import of all JSON files.

| Dataset | Records |
| --- | ---: |
| skins_not_grouped.json | 21,407 |
| stickers.json | 11,134 |
| crates.json | 481 |
| keychains.json | 78 |
| agents.json | 63 |
| patches.json | 112 |
| graffiti.json | 2,111 |
| music_kits.json | 189 |
| collectibles.json | 667 |
| keys.json | 39 |
| tools.json | 4 |
| base_weapons.json | 67 |
| highlights.json | 926 |
| sticker_slabs.json | 11,134 |

Purposes, field semantics, null market identities, media hosts, duplicate behavior, aggregate exclusions and upstream manifest/image update behavior: [source documentation](../../docs/catalog/SOURCES.md), [machine inventory](source-inventory.json), [pinned hashes](../../config/catalog/upstream-manifest.json).

## Full catalog

48,412 source records → 48,412 normalized records. Zero invalid records, zero duplicate source IDs, zero malformed image URLs. The catalog covers source-defined nonmarketable/base items as well as marketable items; null market names are never invented.

| Actual asset type | Records |
| --- | ---: |
| AGENT | 63 |
| AUTOGRAPH_CAPSULE | 139 |
| BASE_WEAPON | 67 |
| CASE | 42 |
| CHARM | 78 |
| COLLECTIBLE | 667 |
| CONTAINER | 9 |
| GLOVES | 470 |
| GRAFFITI | 2,111 |
| GRAFFITI_CONTAINER | 3 |
| KEY | 39 |
| KNIFE | 4,020 |
| MUSIC_KIT | 189 |
| MUSIC_KIT_BOX | 13 |
| PATCH | 112 |
| PATCH_CAPSULE | 7 |
| PIN_CONTAINER | 4 |
| SOUVENIR_HIGHLIGHT | 926 |
| SOUVENIR_HIGHLIGHT_CONTAINER | 14 |
| SOUVENIR_PACKAGE | 150 |
| STICKER | 11,134 |
| STICKER_CAPSULE | 100 |
| STICKER_SLAB | 11,134 |
| TOOL | 4 |
| WEAPON_SKIN | 16,917 |

122 shared market-name groups are Doppler/Gamma Doppler paint variants with distinct source IDs and paint indexes. They remain distinct catalog records and ambiguous for name-only mapping. No variant is guessed. The exact candidate lists are in [the full reconciliation](import-first.json).

## Media coverage

48,412 valid media references; zero absent references in this snapshot. Exactly 100 were downloaded and decoded successfully (AVAILABLE); 48,312 remain UNVERIFIED. No claim is made that all source URLs are currently usable. The full artwork catalog was not downloaded/rehosted. Known MISSING/INVALID media emits no image request.

Offline inspection captured dimensions, MIME type, original-byte SHA-256 and alpha bounds for tracked artwork. It did not alter canonical artwork. FloatAlpha controls normalization/mappings/infrastructure; third-party CS2 artwork retains source provenance and rights.

## FloatAlpha reconciliation

| Result | Count |
| --- | ---: |
| Tracked | 100 |
| Exact matched | 100 |
| Missing | 0 |
| Ambiguous | 0 |
| With verified media | 100 |
| Without media | 0 |

All current asset UUIDs were read unchanged from assets. Every UUID/name/candidate/reason/media status is enumerated in the reconciliation artifact. There are no missing or ambiguous tracked rows to list. Such rows are explicitly reported and tested when present.

## Previously failing assets

- Antwerp 2022 Legends Sticker Capsule: exact crates.json ID crate-4832.
- Paris 2023 Contenders Sticker Capsule: exact ID crate-4892.
- Stockholm 2021 Legends Sticker Capsule: exact ID crate-4803.

All three are AVAILABLE, 1024×768 PNG, with recorded content hashes. The prior proxy rejected roughly 6 MB PNGs at its 2 MB bound and originally surfaced generic 404s; this was not missing catalog identity or systemic provider failure. The new generic direct-source mapping fixes their delivery without special-casing names or weakening the proxy. [Verification records](capsule-media.json), [capsule screenshot](capsule.png).

## Architecture

Existing market asset UUID → exact asset_catalog_mappings row → canonical_asset_catalog metadata → asset_media URL/state → existing image component. Market identity, metadata/media and observations remain separate. Weapon/paint/wear/float/variant identifiers survive for later research.

Catalog IDs are deterministic hashes of provider/dataset/source ID. Exact source names remain unmodified; unsupported or ambiguous identities are reported. A snapshot is validated before a transactional upsert. Disappeared records are retained with a deprecation marker, and can reappear.

First import created 48,412 records. The second and final identical runs each created 0, updated 0 and left 48,412 unchanged; no repeat media downloads occurred. [Final import](import-final.json). Operational run history is separate from logical idempotency.

## Runtime

Before: browser requested /api/asset-images/:name, which selected a source and performed cached proxy delivery. After: one batched indexed catalog/media lookup enriches initial market page data; HTML contains direct source URLs and reserved wells. Pages perform no per-asset identity/media discovery, source JSON downloads or health probes. The browser fetches artwork bytes in parallel.

Desktop/mobile navigation recorded no calls to the legacy name route. That route remains for backwards compatibility and its tests; it can be removed once old clients no longer depend on it. Five fixed delivery sentinel URLs now make health independent of its name resolver as well. The original circuit-breaker threshold and manual-false semantics remain intact.

## Performance

Local development, localhost:3001, HTTP 200 full-response wall times; first request excluded as warmup, median of three remaining samples. Same existing remote market-query path.

| Route | Before | After idle |
| --- | ---: | ---: |
| /assets | 1,049.0 ms | 1,083.5 ms |
| /screener | 1,067.7 ms | 1,061.4 ms |
| /asset/9d481da8-39f2-4026-98df-c98e5f092f18 | 249.6 ms | 214.3 ms |

Assets was 34.5 ms slower in this sample. These few development measurements do not establish universal server-latency improvement. Initial after samples overlapped a build; both initial and idle results are preserved. Removal of per-item discovery/proxy work and immediate src availability are verified independently of timing noise. Direct-source images can consume more bandwidth than old thumbnails. [Before](timings-before.json), [initial after](timings-after.json), [idle after](timings-after-idle.json).

## Database

New forward migration: db/catalog/001_catalog.sql. New tables: canonical_asset_catalog, asset_media, asset_catalog_mappings, catalog_sync_runs. Migration runner also maintains catalog_schema_migrations with checksums. No existing tables, IDs or observation foreign keys were altered.

Migration tested twice under PGlite and applied only to isolated local PostgreSQL floatalpha_catalog_v1. CATALOG_DATABASE_URL is explicit; no collector-database write fallback. Local .env.local points to this database.

Commands: npm run db:migrate:catalog; npm run catalog:sync (optional --verify-tracked, --source-dir, --tracked-file, --report). No automated catalog schedule was introduced.

## Tests

175 tests across 21 files passed, including 34 new catalog tests for schemas, weapon/knife/glove/nonweapon normalization, exact/missing/ambiguous identities, source duplicates, variant/wear/paint/float preservation, URL/null handling, SQL idempotency and disappearance, media verification, batching and runtime failure isolation. All pre-existing image/provider/market regression coverage remains passing.

All 14 desktop/mobile browser checks passed: direct initial src, zero resolver requests, three capsules, image failure geometry, circuit-breaker fallback/recovery, anonymous watchlist behavior, public navigation, responsive containment, and unchanged endpoint authentication.

Manual ASSET_IMAGES_ENABLED=false returned DISABLED and initial HTML with zero wells/images; the original absent/default-enabled setting was restored. [Manual-off evidence](manual-off.json). Observed wells remain 44×36 and 160×104. [Geometry/request evidence](browser.json), [dark skin screenshot](dark-skin.png).

## Verification

TypeScript, ESLint, git whitespace checks and optimized production build passed. Build command: npm run build -- --webpack, in an isolated filesystem copy without environment credentials to avoid disturbing the running dev preview. [Build log](build.log).

## Production impact

Nothing was deployed or written to production. The existing market assets table was read to obtain authoritative UUIDs/names; mutations were confined to local catalog tables. No production migration, catalog import, media upload, scheduled job or feature-flag change was performed. Production needs an explicitly authorized migration/bootstrap/connection rollout.

## Market-data safety

No collector behavior, source semantics, transformer behavior, collection schedules, historical observations, alert semantics, Price Confidence or signal methodology changed. Hash comparison of 45 protected collector/source/transformer/migration/schedule files showed zero changes from preflight. Existing unrelated uncommitted modifications remain preserved. [Safety evidence](market-safety.json).

## Future work — not implemented

- Controlled local media/CDN delivery retaining original provenance.
- Higher-resolution source research.
- Pseudo-3D interaction.
- True 3D rendering research.
- Float/pattern-specific visualization.

Source/media risks and rollout instructions: [architecture](../../docs/catalog/ARCHITECTURE.md), [identity](../../docs/catalog/IDENTITY.md), [media](../../docs/catalog/MEDIA.md), [sync](../../docs/catalog/SYNC.md), [reconciliation](../../docs/catalog/RECONCILIATION.md).
