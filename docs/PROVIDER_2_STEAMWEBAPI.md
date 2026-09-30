# Provider #2 — SteamWebAPI collection and transformation

Evidence baseline: discovery probe `b6013b6`,
[`docs/STEAMWEBAPI_CAPABILITY_PROBE.md`](STEAMWEBAPI_CAPABILITY_PROBE.md).

SteamWebAPI is an **additional independent source**, not a replacement for
direct Skinport collection and not another representation of it. Provider
observations stay attributable to their provider and are never merged.

---

## 1. Where things live

| Concern | Table | Shared or new |
|---|---|---|
| Provider identity + static metadata | `provider_assets` (`provider='STEAMWEBAPI'`) | **shared** |
| Collection run ledger | `provider_collection_runs` | **shared** |
| Current Steam market state | `steam_market_state` | new |
| Steam state history (change-only) | `steam_market_state_history` | new |
| Provider-supplied price history | `steam_price_history` | new |

Identity and the run ledger are reused because both were already keyed by
`(provider, venue)` and written for a second source; duplicating them would have
created two answers to "what did we observe and when".

Market state is **not** shared. Skinport reports a listing venue — asks and a
quantity. Steam additionally reports a standing bid book, a listed offer count
and realised sales counts across four horizons. Flattening that into the shared
listing columns would discard the reason for paying for this source.

## 2. Field classification

Every field the probe observed, classified and accounted for.

### A — Canonical / shared vocabulary *(persisted in `steam_market_state`)*

| Provider field | FloatAlpha column | Note |
|---|---|---|
| `markethashname` | `provider_assets.market_hash_name` | identity + canonical mapping key |
| `pricelatest` | `min_price` | lowest current Steam listing |
| `pricemedian` | `median_price` | |
| `priceavg` | `mean_price` | |
| `pricemax` | `max_price` | |
| `offervolume` | `quantity` | Steam's listed quantity — see the caveat in §5 |
| *(constant)* | `currency` | `USD`; the collector requests no other currency |
| *(derived)* | `present` | absence is absence, never a zero |

Names looking similar was not treated as equivalence: `pricelatest` is a
standing listing while `pricelatestsell` is a realised trade, so only the first
maps to the shared listing concept.

### B — Steam-specific market evidence *(persisted, first-class columns)*

This is the category that must not be reduced, and it is most of the value.

| Provider field | Column |
|---|---|
| `pricelatestsell` | `price_latest_sell` |
| `pricemedian24h/7d/30d/90d` | `price_median_24h/7d/30d/90d` |
| `pricesafe` | `price_safe` |
| `pricemin` | `price_min_observed` |
| `pricemix` | `price_mix` |
| `buyorderprice` | `buy_order_price` |
| `buyordermedian` | `buy_order_median` |
| `buyorderavg` | `buy_order_avg` |
| `buyordervolume` | `buy_order_volume` |
| `offervolume` | `offer_volume` *(also mapped to `quantity`; kept raw as well)* |
| `soldtoday`, `sold24h`, `sold7d`, `sold30d`, `sold90d`, `soldtotal` | `sold_*` |
| `marketvolume` | `market_volume` |
| `points` | `points` |
| `hourstosold` | `hours_to_sold` |
| `priceupdatedat` | `price_updated_at` *(freshness — excluded from fingerprint)* |
| `lateststeamsellat` | `latest_steam_sell_at` *(freshness — excluded)* |

FloatAlpha has **no demand-side and no realised-volume evidence from any other
source**. Skinport gives listings, never trades.

### C — Static / catalog metadata *(persisted in `provider_assets.static_metadata`)*

`classid`, `instanceid`, `rarity`, `quality`, `itemgroup`, `itemtype`,
`itemname`, `wear`, `isstattrak`, `issouvenir`, `isstar`, `minfloat`,
`maxfloat`, `defindex`, `paintindex`, `marketable`, `tradable`, `unstable`,
`unstablereason`, `markettradablerestriction`, `tag1`, `tag7` (collection),
`groupname`, `firstseenat`, `inspectlink`.

Updated in place, never versioned: it changed for **0.00%** of assets across two
probe pulls, so history here would be pure churn. `inspectlink` is retained
because the 3D viewer contract needs it later.

The ~14.8k assets beyond the Skinport universe — stickers, graffiti, charms,
agents — are **kept**, with `asset_id` null. An unmapped provider observation is
still evidence.

### D — Third-party marketplace mirror *(NOT persisted)*

`pricereal`, `pricereal24h/7d/30d/90d`, `pricerealmedian`,
`realmarketsquantity`, `winloss`, `winlossprice`, `prices[]`.

**Not requested, not stored, not fingerprinted.** Three reasons, all measured:

1. The probe showed the mirrored Skinport representation is a **daily snapshot
   ~66.6 hours stale**, agreeing within 1% for 75% of the overlap and diverging
   by over 4,000% in the thin tail. It is not a substitute for direct Skinport
   evidence and must never be confused with it.
2. `realmarketsquantity` alone changed for **24.50%** of the universe over ten
   minutes against **2.37%** for every Steam field combined. Admitting it would
   multiply history rows by roughly twelve.
3. It attributes other venues' churn to Steam.

The brief permits retaining it separately given a demonstrated future reason.
There is none yet, so it is omitted rather than collected speculatively. It can
be added later without touching the Steam state tables.

### E — Omitted, with reasons

| Field(s) | Why |
|---|---|
| `id`, `slug`, `normalizedname`, `groupid` | Provider-internal identifiers; `markethashname` + `classid`/`instanceid` already identify the asset |
| `infoprice`, `infopricereal` | Provider documentation strings, not data |
| `itemimage`, `steamurl` | Presentation; FloatAlpha has its own imagery pipeline |
| `bordercolor`, `color` | Presentation |
| `latest10steamsales` | Ten daily points per row (~400 B × 39.7k). Superseded by `/history`, which returns 12.6 years for the assets that matter |
| `variants` | Doppler phase variants; phase-aware identity is deliberately deferred so it is an explicit change later, not a silent one |
| `createdat`, `releasedat`, `firstseentime` | Provider-operational timestamps; `firstseenat` is kept in static metadata |
| `marketable`/`tradable`/`unstable` as *state* | Kept as static metadata instead — they identify rather than fluctuate |

## 3. State fingerprint

**Included** (29 fields, declared as one list in
`STEAM_STATE_FINGERPRINT_FIELDS`): `present`, `currency`, `quantity`,
`minPrice`, `maxPrice`, `meanPrice`, `medianPrice`, `priceLatestSell`,
`priceMedian24h/7d/30d/90d`, `priceSafe`, `priceMinObserved`, `priceMix`,
`buyOrderPrice`, `buyOrderMedian`, `buyOrderAvg`, `buyOrderVolume`,
`offerVolume`, `soldToday`, `sold24h`, `sold7d`, `sold30d`, `sold90d`,
`soldTotal`, `marketVolume`, `points`, `hoursToSold`.

**Excluded**, named explicitly in `STEAM_STATE_FINGERPRINT_EXCLUSIONS` so the
exclusions are auditable rather than implied by omission:

- **Provider freshness** — `priceupdatedat`, `lateststeamsellat`. These describe
  the provider's pipeline, not the market. The probe measured `priceupdatedat`
  advancing for 2.02% of assets while a different 27% of state moved.
- **Run metadata** — `observedAt`, `collectorRunId`, `stateSince`,
  `collectorVersion`. Including any per-run value would mark all 39.7k assets
  changed every hour, which is the storage model this design exists to avoid.
- **Third-party mirror** — see §2 D.
- **Static metadata** — changed 0.00%.

## 4. Change-only semantics

- Unchanged Steam state → **no history row**. `steam_market_state.observed_at`
  advances so "observed and did not move" stays distinguishable from "not looked
  at", which the run ledger records independently.
- Changed state → **exactly one** transition, reason `CHANGED`.
- First sighting → `NEW`. Returning after absence → `REAPPEARED`.
- Absent from a successful full response → `DISAPPEARED`, recorded with null
  values. Never `quantity: 0`, which would assert an observed empty market the
  provider did not report.

## 5. Known data-quality caveats, recorded rather than normalized away

**`offervolume` cannot distinguish zero from unknown.** The provider returns 0
for 12.35% of assets and null for none. FloatAlpha's rule is that absence is
recorded as absence, so this is a genuine conflict in the source. The value is
stored **as reported** in both `quantity` and `offer_volume`, and the ambiguity
is documented here rather than resolved by guessing. Any derived measure using
it must treat `0` as "0 or unknown".

**`buyordervolume` is the mirror image** — null for 9.27%, never zero.

**Nulls are preserved.** The vendor's status banner read *"Steam Prices Broken"*
during discovery; the data showed partial degradation (`pricelatest` null for
8–15% by group) rather than an outage. Null prices are normal and are stored as
null. Missing Steam values are never substituted with mirrored marketplace
values.

**`pricesafe` semantics are undocumented** (21.58% null, provider-derived). It
is stored because it is Steam-side, and flagged here because nothing should be
derived from it until its meaning is confirmed.

## 6. Cadence and budget

**Hourly.** 720 calls per 30 days against an Items allowance of **1,500**,
leaving 52% in reserve for retries, the history backfill and investigation.

Justified by measurement, not symmetry with Skinport: only **2.37%** of assets
changed any Steam field over ten minutes, and the provider refreshes its own
pricing on a multi-hour rolling sweep (68% of `priceupdatedat` values ≤6h old).
Collecting faster than the provider updates would spend the allowance
re-reading unchanged values.

A 30-minute cadence fits arithmetically at 1,440 and is **explicitly rejected**:
60 spare calls for a whole month leaves nothing for a failed run.

The collector claims an **hourly window**, so a duplicate trigger inside the
same hour costs no credit.

Quota figures are provider configuration observed on a date, not a permanent
contract.

## 7. Kill switch

`STEAMWEBAPI_COLLECTION_ENABLED` — **off unless explicitly `true`**. This is the
opposite default from the Skinport universe switch, deliberately: a new paid
provider that starts spending credits the moment it merges is not a default
anyone chose.

Disabling it affects nothing else — not Skinport collection, the derived
refresh, product reads, auth or billing.

## 8. Persistence health

A successful HTTP response is **not** a healthy run. The collector marks
persistence unhealthy when a delta cannot be resolved to a provider asset id, or
when fewer rows are written than intended, and the route returns **502** in
either case.

This is deliberate history: an earlier Skinport incident had an isolation
wrapper swallowing write failures while the collector reported success. A green
collector that is silently losing observations is worse than a red one.

## 9. Provenance

Answerable from `provider_collection_runs` joined to `collector_runs`, without
duplicating lineage into every history row: provider, venue, data product,
endpoints, scheduled/started time, observed time, run id, collector version,
transformer version, normalization version, response fingerprint and bytes,
request success, persistence health, and per-run changed/unchanged/disappeared
counts. Each history row references its run.

## 10. History backfill — mechanism only

`scripts/steamwebapi-backfill-history.ts`. **Plan-only by default**; execution
requires `--apply`, and nothing in deployment triggers it.

- **Scope**: provider assets whose `asset_id` maps to a tracked FloatAlpha asset.
- **Cost**: ~1 credit per asset against an OTHER allowance of 500/period.
- **Destination**: `steam_price_history`.
- **Shape**: `observed_date`, `price`, `sold` per point.
- **Idempotency**: `UNIQUE (provider_asset_id, series, observed_date)` — a
  re-run updates in place and cannot duplicate a point.
- **Resume**: assets with existing points are skipped unless `--force`, so a
  partial failure is resumed by re-running the same command.
- **Pacing**: 31s between requests (provider allows 2/minute).
- **Provenance**: `observed_date` is the date the provider attributes a value
  to; `retrieved_at` is when we asked. A 2014 row means *"the provider told us
  in 2026 what it holds for 2014"*, never *"FloatAlpha observed this in 2014"*.
  The distinction is structural, not a comment.

## 11. Not in this batch

No product-facing SteamWebAPI data, no cross-provider intelligence
(`crossVenueSpread`, `supplyDivergence`, `demandPressure`, `venueAgreement`,
`crossVenueMomentum` all belong to a future derived layer), no change to
`listing-features-v3` or the derived refresh, no third-party mirror ingestion,
no phase-aware identity, no executed backfill, no 3D integration, no Steam
account linking or inventory.
