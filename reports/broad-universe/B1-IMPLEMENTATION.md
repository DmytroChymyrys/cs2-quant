# B1 — Observed Asset Identity: Implementation Review

Implemented locally. **Nothing committed, pushed or deployed.** HEAD `9ee19c1`.
No migration, no new provider calls, no collector change, no production write.
No route and no UI — those are the next gate.

---

## 1. Resolution strategy, demonstrated before implementing

The brief required a bounded strategy before a route. Three were measured
against the live catalogue of 39,999 canonical names.

| Strategy | Per request | Verdict |
|---|---|---|
| **A.** Hash in SQL, filter by prefix, no index | **635–1,036 ms** | This *is* the forbidden full-catalogue scan |
| **B.** Module-scope index, built once | **0.005 ms** | **Chosen** |
| **C.** Expression index on the digest | ~1 ms (est.) | **Requires a migration — reported, not taken** |

**B, measured end to end against production:**

```
COLD build          1,370 ms   (1 query + 29 ms hashing)
INDEX               39,999 names, 0 ambiguous
WARM                200 resolutions in 1 ms  → 0.005 ms each
MISS (unknown)      643 ms     (one bounded fallback query)
Heap                5.6 MB
```

Three design points worth review:

- **`unstable_cache` is deliberately not used.** The serialised map is
  **2.29 MB** and Next's data cache refuses entries above 2 MB, so it would
  silently never cache and every request would pay the rebuild.
- **Single-flight.** Ten concurrent first requests share one build, asserted by
  test.
- **A cache miss is not a 404.** The collector mints names continuously, so a
  miss falls back to one targeted SQL lookup and seeds the result. A name that
  appeared a minute ago resolves on its first request. Verified: the second
  request for the same name issues **no** query.

### The trade-off I am reporting rather than taking

An expression index on `left(encode(sha256(convert_to(canonical_name,'UTF8')),'hex'),12)`
would make resolution a ~1 ms indexed lookup and delete this cache, the TTL and
the fallback. It needs `CREATE INDEX`, which this gate forbids. **Recommended as
the successor**, with the cache remaining a correct fallback if it is never
built.

## 2. Files changed

**New (4)**

| File | Lines | Role |
|---|---|---|
| `src/lib/market-identity.ts` | 48 | the one canonical normalisation, TS + SQL |
| `src/lib/observed-slug.ts` | 100 | pure slug generation and parsing |
| `src/lib/product/observed-identity.ts` | 226 | bounded resolver, verdicts |
| `tests/observed-identity.test.ts` | 374 | 32 tests |

**Modified (2)** — +4 / −2 total

| File | Change |
|---|---|
| `src/lib/product/inventory.ts` | `normalizeMarketName` delegates to `canonicalMarketName` |
| `src/lib/product/cross-venue.ts` | `crossVenueKey` delegates to `canonicalMarketName` |

### One canonical normalisation

The contract required a single function. There were **two identical
implementations** — `inventory.ts:43` and `cross-venue.ts:222`, both
`.normalize("NFC").trim().replace(/\s+/g," ")`. That is the dangerous kind of
duplication: nothing fails when one drifts, the two simply stop matching the
same items.

Both now delegate to `canonicalMarketName`, keeping their public names so
nothing downstream changes. The SQL fragment lives beside the TS function and
is asserted equivalent against all 39,999 production rows — **0 mismatches**.

## 3. Test results

**32 new tests. Suite 1,527 → 1,559, 92 files, all passing.**
Typecheck clean. Lint **0 errors, 6 warnings — all pre-existing and outside
scope**. Production build compiled.

### Corpus verification, against the live catalogue

```
CORPUS  39,999   uniqueSlugs 39,999   uniqueDiscriminators 39,999
SQL/TS canonicalisation mismatches: 0
duplicate discriminators: 0
```

Every one of the 39,999 canonical names produces a unique slug **and** a unique
12-hex discriminator. Not a sample — the whole catalogue.

### The cases the contract was written for

| Case | Result |
|---|---|
| **壱 vs 弐** | identical readable slug, different URLs: `…factory-new-4747999ff9c3` vs `…factory-new-0e925dc0a1b0` |
| StatTrak / Souvenir / plain / wear | four distinct slugs from one base name |
| `★` ornament | stripped from the readable part, **still in the hash input** — asserted it changes the discriminator |
| 74-char name | readable truncated to 60, slug still unique |
| Name with no slugifiable characters | bare discriminator, still resolves |
| Case sensitivity | `ak-47` and `AK-47` produce different discriminators |
| Whitespace | `"  AK-47  |  Redline (FT) "` hashes identically to the clean name |

### Resolution verdicts

Six explicit outcomes, none a guess: `CANONICAL`, `REDIRECT`, `PROMOTED`,
`MALFORMED`, `NOT_FOUND`, `AMBIGUOUS`.

Over a 200-name production sample: **198 CANONICAL, 2 PROMOTED** — the two being
names that are also among the analysed 150, correctly redirected out of the
namespace.

**Ambiguity is an error in both paths** — the build records a repeated
discriminator rather than overwriting, and the fallback reports two rows as
`AMBIGUOUS` rather than taking the first.

### Namespace isolation

- An 8-hex segment is **rejected** by the observed parser.
- A 12-hex segment is rejected by the analysed parser (unchanged).
- A readable word that looks like hex does not fool either: the discriminator
  is always last.

## 4. Compatibility

| Check | Result |
|---|---|
| Analysed slugs unchanged | **150 paths regenerated byte-identical**; `assetSlug` asserted against a fixed fixture |
| Live analysed URL | `/asset/ak-47-bloodsport-field-tested-3ec521ae` → **200** |
| Existing suites | `cross-venue`, `liquidity`, `steam-inventory` — 123 tests green after the delegation change |
| Migrations created | **0** |
| Collector files touched | **0** |
| Writes to `assets` | **0** — asserted by test that the module contains no insert/update/delete |

## 5. SEO and promotion

**Specified and tested; not yet enforced, because there is no route yet.**

- **Promotion wins over everything.** A name with an `assets` row resolves
  `PROMOTED` with the analysed path, even when the readable portion is stale —
  so the observed namespace never keeps a second live page for an analysed
  asset. Detected in the same query as the build, via a left join; no extra
  per-request lookup.
- **Demotion is out of scope**, deliberately. An asset leaving the 150 should
  be an editorial decision, not an automatic URL move.
- `noindex` and sitemap exclusion belong to the route gate. Nothing is
  indexable today because nothing is routable today.

## 6. Deviations from the contract

**One, and it is an addition rather than a departure.** The contract described
resolution as a cache; the implementation adds a **targeted fallback on a cache
miss**. Without it, any name newer than the index would 404 until the next
refresh, which would be a correctness bug rather than a staleness
inconvenience. The fallback is bounded (one query), rare, and seeds the index.

Everything else is as approved: the `/observed/` namespace, 12 hex, SHA-256
over the canonical name, `slugifyName` reused unchanged.

## 7. Not implemented, by instruction

No `/observed/[slug]` route, no observed detail UI, no broad Screener, no
linking from any existing surface, no caption change. The identity foundation
is importable and tested; nothing renders it.

---

## 8. Recommended next steps

1. **Route gate** — `/observed/[slug]` applying the six verdicts, with
   `PRIVATE_ROBOTS` and sitemap exclusion asserted.
2. **Decide on the expression index** (§1). Worth its own small migration gate;
   it removes the cache, the TTL and the fallback.
3. **B2** — the broad Screener, which is the first surface that would link to
   observed pages.

**Stopping for review. Nothing committed.**

---

# Appendix — Resolver Operations Review

Added after the operational review. **Two real defects were found and fixed;
one limitation is reported rather than fixed.** Nothing committed.

## A1. Verification results

Each point was probed against the implementation before any change was made.

| # | Concern | Before | Now |
|---|---|---|---|
| 1 | Concurrent requests share one build | **PASS** — 1 build for 12 concurrent | unchanged |
| 2 | Expiry, refresh, refresh failure | **FAIL** — a failed rebuild discarded a usable index and threw for every request | **FIXED** |
| 3 | Independent instances | **PASS** — safe by construction | unchanged |
| 4 | Fallback bounded and indexed | **PARTIAL** — bounded in rows returned, but a full-catalogue scan | **IMPROVED**, still unindexed |
| 5 | Repeated unknown identifiers | **FAIL** — 10 identical unknown slugs cost 10 scans | **FIXED** |
| 6 | Malformed rejected before database | **PASS** — 0 database calls | unchanged |
| 7 | Database unavailable | **PASS** — throws rather than reporting NOT_FOUND | unchanged |
| 8 | Collisions fail closed | **PASS** — AMBIGUOUS with a count, both paths | unchanged |

### Defect 1 — a transient database blip became a site-wide 500

After the TTL, a failed rebuild propagated to every caller and the previous
snapshot was discarded. A stale index is still correct for every name that
existed when it was built, so this traded a correct answer for an error.

**Fix:** on rebuild failure the previous snapshot is served and the rebuild is
retried on a 60-second backoff rather than on every request. With nothing
cached the failure still propagates — there is no answer to give, and a
misleading "not found" would be worse.

### Defect 2 — repeated unknown slugs were unbounded database work

Every request for a nonexistent slug issued its own full-catalogue scan.
Twenty requests for one dead URL cost twenty scans at ~640 ms each — a cheap
denial-of-service against our own database, reachable by a crawler following a
stale link.

**Fix, two parts:**

1. **The fallback is now bounded by `first_seen_at`.** That is exactly what the
   lookup is for: a name the index has not seen can only be one the collector
   minted after the index was built. Measured: the window holds about **two
   rows an hour** out of 65,554, and the query drops from **579–620 ms to
   57–61 ms**.
2. **Negative caching.** A discriminator proved absent is remembered for 60
   seconds, so repeated requests answer from memory. Kept far shorter than the
   index TTL so a genuinely new name is not denied for long.

### Measured after the fixes, against production

```
COLD build        935 ms    40,000 names, 0 ambiguous
WARM              300 resolutions in 3 ms      (0.01 ms each)
MISS, first       61 ms                        (was 643 ms)
MISS, next 20     0 ms                         (negative cache)
Heap              5.6 MB
```

Each fix is mutation-tested: removing stale-serving fails 3 tests, removing the
negative cache fails 2, removing the `first_seen_at` bound fails 1, removing
the backoff fails 1.

## A2. The limitation I am not fixing

**The fallback predicate is still not indexed.** It is now bounded by a cheap
time window rather than by an index, which is why it is fast. An adversary
enumerating *distinct* discriminators would still trigger one 61 ms query each;
negative caching only dedupes repeats. At 61 ms this is an ordinary dynamic
route cost rather than an amplification, but it is a real property and the
reason Option B was evaluated seriously.

## A3. Option A — module-scope index (current)

| | |
|---|---|
| Cold start | **935 ms**, once per instance per TTL |
| Warm lookup | **0.01 ms** |
| Memory | **5.6 MB** per instance (39,999 entries) |
| Concurrency | single-flight; 12 concurrent cold requests → 1 build |
| Fallback | 61 ms, bounded by `first_seen_at`, negatively cached |
| Migration | **none** |
| Operational complexity | a TTL, a backoff and a negative cache to reason about |

**Instances maintaining independent snapshots is safe**, because the index is a
pure function of a read-only query. Two instances can disagree only about names
minted between their build times, and the fallback resolves exactly that case.
No coordination, no invalidation, no shared state.

## A4. Option B — database expression index

The index the strategy requires:

```sql
CREATE INDEX provider_assets_observed_discriminator ON provider_assets (
  left(encode(sha256(convert_to(
    normalize(regexp_replace(btrim(market_hash_name), '\s+', ' ', 'g'), NFC),
  'UTF8')), 'hex'), 12)
);
```

**It cannot be created as written.** Postgres requires every function in an
expression index to be `IMMUTABLE`, and `convert_to` is **`STABLE`** — verified
against the live server:

```
btrim IMMUTABLE · normalize IMMUTABLE · regexp_replace IMMUTABLE
encode IMMUTABLE · left IMMUTABLE · sha256 IMMUTABLE
convert_to  STABLE   <-- blocks the index
```

Two workarounds, both costly:

- **Wrap it in a user-defined function marked `IMMUTABLE`.** This asserts
  something untrue to the planner — `convert_to` depends on server encoding —
  and if that assumption ever broke the index would silently return wrong rows.
  It is also itself a migration, plus a function to own.
- **Change the digest** to one that is immutable over `text` (`md5`). That
  changes **every observed URL**, which is the one thing the identity contract
  exists to prevent.

### Write overhead — the decisive measurement

`provider_assets` is the schema's hottest table:

| | |
|---|---|
| Lifetime updates | **13,460,693** |
| Inserts | 190,344 |
| **Updates per day** | **961,478** |
| HOT updates | 74.8% |
| Size | 102 MB, of which 23 MB indexes |

That rate is not incidental — it is exactly the hourly collector rewriting
every Steam row: **39,922 × 24 = 958,128/day**, against 961,478 measured. An
expression index would add SHA-256 index maintenance to roughly **242,000
non-HOT updates a day**, permanently, to make a lookup that currently costs
61 ms and happens only on a cache miss cost about 1 ms.

### Migration and rollback

`CREATE INDEX CONCURRENTLY` on 65,554 rows is quick and non-blocking; rollback
is `DROP INDEX`. Neither is the problem. The problems are the immutability
blocker and the write amplification.

## A5. Recommendation — **Option A, for the initial release**

Three reasons, in order of weight:

1. **Option B cannot be built as specified.** It needs either a false
   `IMMUTABLE` assertion or a different hash that would change every URL.
2. **Option B taxes the busiest table in the schema** — ~242,000 extra indexed
   updates a day — to optimise a path that runs on cache misses only, and which
   now costs 61 ms once and 0 ms thereafter.
3. **Option A is measured, bounded and fails safely** on every axis the review
   asked about.

### The limits Option A ships with

- **5.6 MB per instance**, growing with the catalogue. At 100,000 names it is
  roughly 14 MB — still comfortable, but this is the number to watch.
- **935 ms cold start**, once per instance per hour. A visitor unlucky enough to
  hit a cold instance pays it.
- **Up to 1 hour of index staleness**, plus 60 seconds of backoff after a failed
  refresh. The fallback covers correctness; staleness costs one extra query.
- **A brand-new name can report NOT_FOUND for up to 60 seconds** after a prior
  miss on the same discriminator. Acceptable for a `noindex` surface; it would
  need revisiting if observed pages ever became indexable.
- **A cold instance during a database outage throws** rather than serving
  anything. Correct, and worth knowing.

**Revisit Option B if** observed pages become indexable, catalogue growth pushes
the index past ~15 MB, or crawler traffic makes distinct-discriminator
enumeration a measurable load. None of those is true today.

## A6. Final state

**1,571 tests / 92 files passing.** Typecheck clean, **0 lint errors**, build
compiled. 12 new operational tests covering all eight concerns. Analysed URLs
unchanged. No migration, no collector change, no production write.

**Stopping for final B1 release approval.**
