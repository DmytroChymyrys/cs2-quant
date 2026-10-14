# B1 — Observed Asset Identity Contract

Architecture and contract design only. **No implementation, commit, push,
deployment, migration or production write.** HEAD `9ee19c1`. All figures are
production measurements taken 2026-10-14.

---

## 1. Current identity and SEO architecture

### The analysed contract, as deployed

```
assetSlug(name, id) = slugifyName(name) + "-" + id.slice(0,8)
```

`slugifyName` lowercases, NFKD-decomposes, strips combining marks, maps every
non-`[a-z0-9]` run to `-`, trims, and caps the readable portion at **60**
characters.

Resolution (`resolveAssetSegment`) reads the **last** hyphen segment, requires
it to match `/^[0-9a-f]{8}$/`, filters assets by UUID prefix, and **refuses an
ambiguous match** rather than serving an arbitrary one. Bare UUIDs are accepted
as legacy. `asset/[slug]/page.tsx:118` then enforces *one asset, one URL* with
a `permanentRedirect` to the canonical slug, preserving the query string.

Three properties worth naming, because the observed contract must not break
them:

1. **The discriminator is identity; the readable part is decoration.** A
   renamed asset still resolves and redirects.
2. **Stability by construction.** The suffix depends only on the asset itself,
   so catalogue growth cannot move an indexed URL onto different content.
3. **Ambiguity fails closed** — a 404, never the wrong item.

### SEO registry

`INDEXABLE_ROUTES` drives the sitemap; `DISALLOWED_PATHS` drives robots; the
two are deliberately kept adjacent so they cannot disagree. `pageMetadata()`
sets `alternates.canonical` to the bare path. `PRIVATE_ROBOTS`
(`index:false, follow:false`) already exists for non-indexable pages.
`tests/seo-freeze.test.ts` pins the indexable route families.

## 2. Normalisation currently in force

Provider matching, `crossVenueFor` and the inventory matcher all share one key:

```
normalize(regexp_replace(btrim(market_hash_name), '\s+', ' ', 'g'), NFC)
```

NFC, trimmed, internal whitespace collapsed, **case preserved**. Case folding
is explicitly rejected because the broad universe contains case-insensitive
collisions.

**Measured on 65,553 `provider_assets` rows:**

| | |
|---|---|
| Distinct **raw** names | **39,999** |
| Distinct **normalised** names | **39,999** |
| Names collapsed by normalisation | **0** |
| Names present under both providers | 25,554 |
| Names under one provider only | 14,445 |
| `version` column in use | **no — null on all 65,553 rows** |

So normalisation is currently an identity function for deduplication purposes.
It is still load-bearing — it is what makes Skinport and Steam rows join — but
it is not merging anything today.

**The market identity is the normalised `market_hash_name`. There are 39,999
of them.** `provider_assets.id` is a *provider-row* identity (65,553 rows, two
per shared name) and is therefore unusable as an asset identity.

## 3. Collisions, measured

### Readable-slug collisions across all 39,999 names

| | |
|---|---|
| Colliding slug groups | **61** |
| Names affected | **144** |
| Largest group | **4** |
| Names slugifying to empty | **0** |
| Slug length | min 7 · median 34 · max 60 · **290 at the 60-char cap** |

The canonical case is real and shows exactly why a discriminator is required:

```
Desert Eagle | Sunset Storm 壱 (Factory New)  ┐ both → desert-eagle-sunset-storm-factory-new
Desert Eagle | Sunset Storm 弐 (Factory New)  ┘
```

壱 and 弐 are Japanese *one* and *two*. `slugifyName` strips non-ASCII, so two
genuinely different items reduce to the same readable slug. The 290 names at
the 60-character cap are a second, structural source of the same problem.

### Discriminator collisions

SHA-256 of the normalised name, truncated:

| Truncation | Collisions over 39,999 names |
|---|---|
| 8 hex (32 bit) | **0** |
| 10 hex (40 bit) | **0** |
| 12 hex (48 bit) | **0** |

Zero at 8 hex is **luck, not safety**: birthday expectation at n=39,999 over
2³² is ≈0.19, so roughly a one-in-five chance of a collision existing — we
happen not to have one. At 60,000 names it rises to ≈0.42. At **12 hex** the
expectation is ≈3×10⁻⁶ and stays negligible as the catalogue grows.

Because `resolveAssetSegment` fails closed, a collision would produce a 404
rather than wrong content — safe, but a user-visible broken page.

### Variant integrity

Wear, StatTrak and Souvenir are all inside the name and survive intact:

```
AK-47 | Redline (Field-Tested)             → ak-47-redline-field-tested-6ea9b71d44ad
Souvenir AK-47 | Redline (Field-Tested)    → souvenir-ak-47-redline-field-tested-e84dcf792968
StatTrak™ AK-47 | Redline (Field-Tested)   → stattrak-ak-47-redline-field-tested-2c6fc6329cfb
```

Three distinct URLs. Exact variant matching is not weakened.

## 4. Do provider names change?

**Unknown, and the design must not depend on the answer.** `provider_assets`
carries `version` and `first_seen_at`, but `version` is null on every row, so
no rename has ever been recorded. Valve owns these strings and has renamed
items historically.

A name change under any name-derived scheme mints a **new** identity and
orphans the old URL. That is the central weakness of strategies A and B, and
the central argument for C. It is mitigated — not solved — by the fact that
the existing analysed contract already tolerates stale slugs via redirect, and
by observed pages being `noindex` (§7), which bounds the damage to shared
links rather than indexed pages.

## 5. Three strategies compared

### A. Encoded canonical market hash name

`/observed/U3RhdFRyYWvihKIgQUstNDcgfCBSZWRsaW5l…` (base64url) or percent-encoded.

| | |
|---|---|
| Stability | perfect while the name holds |
| Reversibility | **exact** — no lookup needed |
| Collision risk | **zero by construction** |
| Database | none |
| Migration | none |
| SEO | **poor** — unreadable, and percent-encoded `★`/`™`/CJK produce hostile URLs |
| Complexity | low, but decoding must be hardened against crafted input |

Rejected on readability. It also diverges from the deployed URL shape for no
benefit the hash does not already provide.

### B. Deterministic hash with collision handling — **recommended**

```
observedSlug(name) = slugifyName(name) + "-" + sha256(nfc(name)).slice(0,12)
```

| | |
|---|---|
| Stability | perfect while the name holds; a rename mints a new URL |
| Reversibility | **no** — resolution is a lookup by hash |
| Collision risk | ≈3×10⁻⁶ at 12 hex; **0 measured** |
| Database | **none new** — hash computed over `provider_assets` at read time, or an expression index later if needed |
| Migration | **none** |
| SEO | **same shape as analysed URLs**; readable words retained |
| Complexity | low — mirrors the deployed contract exactly |

**Why 12 hex and not 8:** it keeps the observed namespace numerically safe as
the catalogue grows *and* makes the two identity kinds distinguishable by
length alone (§6).

### C. Persistent asset identity registry

A new table mapping normalised name → minted UUID, maintained alongside the
collectors.

| | |
|---|---|
| Stability | **best** — survives renames if the row is updated rather than replaced |
| Reversibility | via database |
| Collision risk | zero |
| Database | **requires a new table and a write path** |
| Migration | **required — forbidden by this gate** |
| SEO | equivalent to B |
| Complexity | **highest** — lifecycle for names appearing, disappearing, being renamed; a second source of truth beside `assets` |

Correct long-term answer if renames prove common, and the natural successor to
B. B's URLs can be migrated into C later without changing their shape, because
C would simply back the same `slug-discriminator` form with a stored id.

**Recommendation: B now, with C as a documented successor.** B needs no
migration, no write path and no change to the collectors — satisfying every
constraint of this gate — and it is the only option that reuses the deployed
resolution contract verbatim.

## 6. Route namespace, and avoiding duplicate indexed pages

**Separate namespace: `/observed/[slug]`.**

Sharing `/asset/` would work — 8-hex and 12-hex discriminators are
distinguishable by length — but it is the wrong choice for three reasons:

1. **Duplicate-content risk.** Two live URLs for one item, on one host, is the
   exact failure item 8 asks to avoid. Separate namespaces make the canonical
   unambiguous.
2. **The SEO freeze.** `/asset/` is an indexed family with a pinned contract
   and 99 URLs already in Search Console. A new namespace is a deliberate
   addition, reviewable on its own.
3. **It is honest.** The URL itself says analysed versus observed, which is the
   distinction the whole feature rests on.

**Observed pages carry `PRIVATE_ROBOTS` (`index:false, follow:false`) and are
absent from `INDEXABLE_ROUTES`.** They are thin by construction — price,
cross-venue and liquidity only, no time series — and thin pages at 24,000 scale
is precisely the programmatic-SEO shape the freeze exists to prevent. This also
removes the duplicate-indexing question entirely rather than managing it.

### URL examples, all real names from production

| Case | Name | URL |
|---|---|---|
| Plain | `AK-47 \| Redline (Field-Tested)` | `/observed/ak-47-redline-field-tested-6ea9b71d44ad` |
| StatTrak | `StatTrak™ AK-47 \| Aquamarine Revenge (Factory New)` | `/observed/stattrak-ak-47-aquamarine-revenge-factory-new-4676ca506b64` |
| Souvenir | `Souvenir AK-47 \| Redline (Field-Tested)` | `/observed/souvenir-ak-47-redline-field-tested-e84dcf792968` |
| Unicode `★` | `★ Bloodhound Gloves \| Bronzed (Factory New)` | `/observed/bloodhound-gloves-bronzed-factory-new-1d6b4c2a6604` |
| **CJK collision** | `Desert Eagle \| Sunset Storm 壱 (Factory New)` | `/observed/desert-eagle-sunset-storm-factory-new-4747999ff9c3` |
| **CJK collision** | `Desert Eagle \| Sunset Storm 弐 (Factory New)` | `/observed/desert-eagle-sunset-storm-factory-new-0e925dc0a1b0` |
| Long (truncated) | `Souvenir Charm \| Austin 2025 Highlight \| Don't Bring A Knife To A Gunfight` | `/observed/souvenir-charm-austin-2025-highlight-don-t-bring-a-knife-to-63a4d5d9337b` |

Longest observed URL: 60 readable + 1 + 12 + `/observed/` = **83 characters**.
No encoding, no `%`, ASCII only — Next.js route decoding is not exercised and
no decoding hardening is required.

## 7. Promotion: observed → analysed

When a name joins the tracked 150 it gains an `assets.id` and therefore an
8-hex analysed slug under `/asset/`. The observed URL must not become a second
live page.

**Contract:**

1. `/observed/<slug-12hex>` resolves the hash to a normalised name.
2. If that name now has a row in `assets`, the route issues
   `permanentRedirect` to `/asset/<analysed-slug>`, preserving the query
   string — the mechanism `asset/[slug]/page.tsx:118` already implements.
3. `/asset/` never redirects to `/observed/`. Demotion (an asset leaving the
   150) is **out of scope** and should be treated as a deliberate editorial act
   with its own decision, not an automatic URL move.

Because observed pages are `noindex`, promotion creates no indexed-URL churn:
only shared links and internal navigation traverse the redirect.

## 8. Collision and canonicalisation tests

To be written in the implementation gate, not now. Each is a hard requirement:

1. **All 39,999 production names produce unique observed slugs.** The whole
   catalogue, not a sample.
2. **The 61 known readable-collision groups resolve distinctly**, with the two
   Sunset Storm Desert Eagles asserted by name.
3. **Variant distinctness** — plain, Souvenir and StatTrak of one base name
   give three different slugs.
4. **Normalisation parity** — the slug's hash input is byte-identical to the
   key `crossVenueFor` joins on. A test fails if the two ever diverge.
5. **Discriminator length discipline** — observed is exactly 12 hex, analysed
   exactly 8; neither resolver accepts the other's form.
6. **Ambiguity fails closed** — a forged or truncated discriminator 404s.
7. **Canonical redirect** — a stale readable portion with a valid hash
   redirects once, preserving the query string, and does not loop.
8. **Promotion redirect** — a name present in `assets` 301s from `/observed/`
   to `/asset/`.
9. **`noindex` asserted** on every observed page, and `/observed` absent from
   `INDEXABLE_ROUTES` and the sitemap.
10. **No analysed URL changes.** A fixture of the current 150 slugs must be
    byte-identical before and after.

## 9. Rollback and compatibility

- **Nothing existing changes.** No `assets` row, no analysed UUID, no deployed
  `/asset/` URL, no collector, no migration. The implementation is additive:
  one new route namespace and one pure slug module beside `asset-slug.ts`.
- **Rollback is removing the route.** Observed URLs 404 and nothing else is
  affected, because no other surface links to them until the Screener does.
- **Forward compatibility with C.** If renames prove common, a registry can
  back the same `slug-12hex` URL shape by storing the hash, so URLs minted
  under B remain valid.
- **The risk retained** is a provider rename orphaning an observed URL. With
  `noindex` and no inbound links, the blast radius is shared links only. If
  renames turn out to be frequent, that is the trigger to adopt C.

## 10. Implementation plan and acceptance criteria

**Scope:** one pure module, one route, one resolver. No migration, no write
path, no collector change.

| Step | Acceptance criterion |
|---|---|
| 1. `observed-slug.ts` — `observedSlug(name)`, `observedDiscriminator(slug)` | Tests 1–5 pass over all **39,999** production names |
| 2. Resolver — hash → normalised name, against `provider_assets` | Resolves in a single indexed query; ambiguity 404s (test 6) |
| 3. `/observed/[slug]` route — price, cross-venue, liquidity only | Carries `PRIVATE_ROBOTS`; absent from `INDEXABLE_ROUTES` and sitemap (test 9) |
| 4. Canonical + promotion redirects | Tests 7–8 pass; no redirect loop |
| 5. Regression | Test 10: the 150 analysed slugs byte-identical; full suite green |

**Explicitly out of scope for the implementation gate:** linking to observed
pages from the Screener (that is B2), any caption claiming broad coverage, any
indexable observed surface, and demotion handling.

---

**Recommendation: approve strategy B with the `/observed/` namespace and
`noindex`, and proceed to implementation as a separate gate.**
