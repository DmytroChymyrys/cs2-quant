# Full reconciliation

Pinned upstream commit: `be84e43a2eb379faf653158e409a2c90c4072312`. 48,412 source records → 48,412 normalized records. Zero invalid records, zero malformed media references, zero duplicate source IDs.

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

All 48,412 records have valid media URLs. Of these, 100 are verified AVAILABLE, 48,312 UNVERIFIED, 0 MISSING and 0 INVALID. Whole-catalog URL coverage is not whole-catalog delivery verification.

There are 122 duplicate market-name groups, representing distinct Doppler/Gamma Doppler paint variants. They are preserved without arbitrary merging. The full duplicate/candidate list is in [import-first.json](../../reports/catalog/import-first.json).

## FloatAlpha tracked subset

| Result | Count |
| --- | ---: |
| Tracked | 100 |
| Exact | 100 |
| Missing | 0 |
| Ambiguous | 0 |
| With verified media | 100 |
| Without media | 0 |

Every unchanged asset UUID, exact market name, catalog ID, match reason and media status appears in the report. There are no missing or ambiguous tracked identities to enumerate. Those states are nevertheless tested explicitly. The tracked snapshot came from a read-only query of the existing assets table; no market identities were regenerated.

First import: 48412 created, 0 updated, 0 unchanged. Second identical import: 0 created, 0 updated, 48412 unchanged, 0 deprecated; zero media redownloads. [Second report](../../reports/catalog/import-second.json). SQL integration tests additionally confirm byte-for-byte logical row equivalence, disappearance retention and reappearance behavior.

## Runtime and performance

Before: image elements called the name proxy, which selected a source, consulted resolution cache and fetched/transformed bytes. After: one batch of persisted asset mappings supplies metadata and source URLs; HTML contains the source URL and stable well before hydration. Direct artwork requests run in parallel. Browser verification recorded zero legacy resolver requests. The route remains compatibility-only.

Local Next development server on localhost:3001; full-response HTTP 200 wall time, first warmup sample excluded, median of the next three. Same unchanged remote market-data query path. Initial after measurements overlapped a production build and are retained separately; the idle run below avoids that contention. These small samples are not a controlled production benchmark.

| Route | Before warm median | After idle warm median |
| --- | ---: | ---: |
| /assets | 1049.0 ms | 1083.5 ms |
| /screener | 1067.7 ms | 1061.4 ms |
| /asset/9d481da8-39f2-4026-98df-c98e5f092f18 | 249.6 ms | 214.3 ms |

Assets was 34.5 ms slower in this sample; Screener and detail were faster. Do not claim universal server-latency improvement. The demonstrated architectural result is removal of per-asset discovery/proxy requests, with one indexed batch lookup and immediate media URLs. Remote market queries still dominate these local page timings. Direct sources also have larger byte payloads than thumbnails. Raw [before](../../reports/catalog/timings-before.json), [initial after](../../reports/catalog/timings-after.json), [idle after](../../reports/catalog/timings-after-idle.json).

## Capsule verification

Antwerp: crate-4832; Paris Contenders: crate-4892; Stockholm Legends: crate-4803. All three exact source records verified AVAILABLE, 1024×768 PNG, with raw content hashes and alpha bounds. The former generic 404s were proxy size-limit failures, not missing identities. [Recorded metadata](../../reports/catalog/capsule-media.json), [browser capture](../../reports/catalog/capsule.png).
