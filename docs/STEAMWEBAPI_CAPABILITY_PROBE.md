# SteamWebAPI — Capability Probe V1

Discovery only. Nothing in this probe changed the Skinport collector, the
derived pipeline, canonical mappings, production schemas or the product. No
migration was created and nothing was deployed.

Probe date: 2026-09-30. Subscription: **Item Small**, 2026-09-30 → 2026-10-30.
Evidence: [`docs/evidence/steamwebapi/`](evidence/steamwebapi/). Probe client:
[`scripts/steamwebapi-probe/`](../scripts/steamwebapi-probe/).

---

## 1. Executive summary

SteamWebAPI is a **complementary source, not a second Skinport**. Three findings
decide the integration shape.

**It sees 39,703 CS2 items against Skinport's 24,906**, and 14,857 of them are
outside our current observable universe — stickers, graffiti, charms, agents,
music kits and containers that Skinport does not list. Our 100 canonical tracked
assets are matched **100/100**.

**Its Skinport numbers are a stale daily mirror.** Every one of the 47,976 rows
returned by the Skinport price endpoint carries the same `createdat`,
`2026-09-28` — roughly **66.6 hours behind** our own collection at the time of
the probe. It agrees with our direct observation within 1% for 75% of the
overlap, but it must never be substituted for direct collection.

**Its unique value is Steam-side, and it is data we currently have none of**:
Steam buy-order price and volume, Steam listing (offer) volume, Steam sales
counts over 24h/7d/30d/90d, and **12.6 years of daily price-and-volume history
reaching back to 2014-02-19**. Backfilling that history for our 100 tracked
assets costs 100 credits and fits comfortably inside the plan.

Steam-side state is also **slow**: over a 10-minute window only 2.37% of assets
changed any Steam field, while 26.99% changed a third-party field. A 5-minute
cadence would be both wasteful and unaffordable. **Hourly is the recommendation.**

---

## 2. Subscription and quota

| Bucket | Per minute | Per day | Per billing period |
|---|---|---|---|
| ITEM (`/steam/api/item`) | 100 | 5,000 | 100,000 |
| ITEMS (`/steam/api/items`) | 10 | 500 | **1,500** |
| OTHER | 2 | 50 | 500 |
| Screenshot (separate) | 2 | 50 | 500 |

The ITEMS allowance is the binding constraint on any recurring collector.

**Credits are charged per call, not per row.** A `max=3` request and a 39,703-row
request each cost 1. This is the single most important economic fact about the
source: there is no reason to fetch a subset.

**`/market/{market}/prices` is charged against the ITEMS bucket.** The account
ledger moved `items` 6 → 8 across two Skinport price calls. The documentation
says it "requires Items access"; the observed behaviour is that it *consumes*
that allowance. Any design using it recurrently competes directly with `/items`.

### Probe consumption

Total account usage after the probe: **27 credits this billing period**, of
which roughly 22 were this probe (the remainder predate it).

```
item=10   items=8   account=3   inventory=2   markets_history_all=2
items_history=1   history=1
```

`/markets/history` cost **2 credits**, as documented. Screenshot usage was 0/500
before the probe and 1 after; it is metered separately and did not touch the
market allowance.

---

## 3. Endpoints tested

| Endpoint | Method | Bucket observed | Result |
|---|---|---|---|
| `/account/me` | GET | account | 200 |
| `/steam/api/items` | GET | items | 200 |
| `/steam/api/item` | GET | item | 200 |
| `/steam/api/history` | GET | history | 200 |
| `/steam/api/items/history` | POST | items_history | 200 |
| `/markets/history` | GET | markets_history_all | 200 (2 credits) |
| `/market/skinport/prices` | GET | **items** | 200 |
| `/steam/api/inventory` | GET | inventory | 200 |
| `/steam/api/screenshot` | GET | screenshot (separate) | 200 |
| `/steam/api/screenshot/usage` | GET | — | 200 |

## 4. Endpoint authorization matrix

Everything tested is authorized on Item Small. **No 402 or 403 was returned by
any endpoint.** The only failure was one `429` on `/steam/api/history` when two
OTHER-bucket calls landed inside the same 60-second window — a rate limit, not
an authorization limit. The premium cross-market endpoints (`/markets/history`,
`/market/{market}/prices`) that the specification describes as gated were in
fact served.

**Authentication works through the `X-Api-Key` header.** The key never appeared
in a URL, a log, an artifact or this document. The probe fails closed when the
environment variable is absent.

---

## 5. Full universe statistics

**39,703 CS2 items. 39,703 unique market hash names. Zero duplicates. Zero null
or empty names.** One request returned the entire universe; no pagination was
needed.

| Class | Count | Share |
|---|---|---|
| sticker | 18,264 | 46.00% |
| pistol | 4,192 | 10.56% |
| knife | 3,413 | 8.60% |
| rifle | 3,353 | 8.45% |
| smg | 2,769 | 6.97% |
| graffiti | 1,812 | 4.56% |
| sniper rifle | 1,514 | 3.81% |
| shotgun | 1,470 | 3.70% |
| charm | 984 | 2.48% |
| gloves | 470 | 1.18% |
| container | 463 | 1.17% |
| machinegun | 451 | 1.14% |
| music kit / patch / equipment / agent / collectible / pass / key / gift | 545 | 1.37% |

StatTrak 5,057 · Souvenir 4,665 · knife-or-glove (`isstar`) 2,184.
Marketable 39,703 · tradable 36,945 · **`unstable` 9,019 (22.7%)**, a
provider-supplied warning flag with no FloatAlpha equivalent.

### Three universes, deliberately not equated

| Universe | Size |
|---|---|
| SteamWebAPI CS2 catalog | 39,703 |
| Skinport observable (direct, currently present) | 24,906 |
| FloatAlpha canonical / derived-intelligence | 100 |

---

## 6. Payload characteristics

| Request | Rows | Bytes | Duration | Bytes/row |
|---|---|---|---|---|
| `max=3`, all 93 fields | 3 | 14,715 | 365 ms | 4,905 |
| Full universe, 62 selected fields | 39,703 | 63,123,180 | 7,929 ms | 1,590 |
| Skinport mirror (all markets rows) | 47,976 | 6,695,251 | 1,617 ms | 140 |

An unfiltered full pull would be roughly **195 MB**. `select` is not an
optimisation here, it is a requirement: it cut the payload by ~68% with no loss
of the fields this probe needed. Field selection is the single most effective
lever, and it costs nothing in credits.

Pagination exists (`page`, `max`) but is unnecessary — `max=50000` covers the
universe in one call.

---

## 7. Complete field inventory

93 fields are available; the probe selected 62 for the universe pull. Full
machine-readable inventory with null and zero rates:
[`field-inventory.json`](evidence/steamwebapi/field-inventory.json).

### Identity
`markethashname` (0% null, unique), `classid`, `instanceid` (0.02% null),
`groupid`, `id`, `slug`, `normalizedname`, `groupname`. Identity is complete and
stable — this is what canonical mapping will key on.

### Steam market
| Field | Null | Zero | Note |
|---|---|---|---|
| `pricelatest` | 12.14% | 0.21% | current lowest Steam listing |
| `pricelatestsell` | 9.24% | 1.02% | most recent actual sale |
| `pricemedian` / `priceavg` | 9.24% | 1.02% | with 24h/7d/30d/90d variants |
| `pricesafe` | 21.58% | 0.99% | provider-derived, semantics undocumented |
| `pricemin` / `pricemax` | 14.45% | 1.02% | |
| `pricemix` | 7.37% | 0% | lowest across Steam + markets |

### Demand and supply — no FloatAlpha equivalent today
| Field | Null | Zero | Note |
|---|---|---|---|
| `buyorderprice` | 9.06% | 0.21% | highest standing Steam buy order |
| `buyordervolume` | 9.27% | 0% | **outstanding buy orders** |
| `offervolume` | 0% | 12.35% | **Steam listings outstanding** |

### Sales volume — no FloatAlpha equivalent today
`soldtoday`, `sold24h`, `sold7d`, `sold30d`, `sold90d`, `soldtotal` (all
10.25% null), plus `marketvolume`, `points`, `hourstosold` (57.23% null).

### Time horizons
24h, 7d, 30d and 90d exist for median, average, latest-sale and third-party
price. There is no intraday horizon shorter than 24h.

### Metadata (fully static — see §8)
`rarity`, `quality`, `itemgroup`, `itemtype`, `itemname`, `wear` (55.4% null —
stickers and graffiti have none), `isstattrak`, `issouvenir`, `isstar`,
`minfloat`/`maxfloat`/`paintindex` (55.51% null), `defindex`, `tag1`–`tag7`
(`tag7` = collection, 58.44% null), `markettradablerestriction`, `marketable`,
`tradable`, `unstable`/`unstablereason`, `itemimage`, `steamurl`, `inspectlink`.

### Third-party marketplace
`pricereal` (13.16% null, present for 86.84%), `pricereal24h/7d/30d/90d`,
`pricerealmedian`, `winloss`/`winlossprice`, `realmarketsquantity`, and the
nested `prices[]` array carrying up to **13 markets** with `source`, `price`,
`quantity`, `name`, `logo` and per-phase `variants`.

`latest10steamsales` is a free embedded mini-history: ten `[date, price, count]`
triples per asset, included in the row at no extra credit.

---

## 8. Static vs dynamic fields

Measured across two pulls 10.1 minutes apart, 39,703 common assets:

| Family | Changed | Rate |
|---|---|---|
| METADATA | **0** | **0.00%** |
| SUPPLY (`offervolume`) | 229 | 0.58% |
| DEMAND (buy orders) | 240 | 0.60% |
| VOLUME (sales counts) | 487 | 1.23% |
| MARKET (Steam prices) | 728 | 1.83% |
| THIRD-PARTY | 10,715 | **26.99%** |
| RETRIEVAL (`priceupdatedat` etc.) | 945 | 2.38% |

**Metadata did not change at all.** It belongs in a static table written once
and revisited rarely, never in change history.

**Third-party churn dominates and is almost entirely one field**:
`realmarketsquantity` alone changed for 24.50% of assets in ten minutes, with
`pricerealmedian` second at 5.65%. Steam-side fields changed for 2.37% of assets.

---

## 9. Representative asset matrix

Real values, probed via `/steam/api/item`. Full payloads:
[`representative-assets.json`](evidence/steamwebapi/representative-assets.json).

| Class | Asset | latest | median | buy order | buy qty | offers | 24h | 30d | 3rd-party | markets |
|---|---|---|---|---|---|---|---|---|---|---|
| liquid rifle | AK-47 Redline (FT) | 33.98 | 36.45 | 33.93 | 48,296 | 1,204 | 59 | 2,396 | 25.36 | 13 |
| expensive sniper | Souvenir AWP Dragon Lore (FT) | — | 801.29 | 2,177.70 | 102 | 0 | 0 | 0 | 6,153.36 | 11 |
| cheap liquid | FAMAS Grey Ghost (FT) | 0.03 | 0.03 | — | — | 6,246 | 310 | 13,707 | 0.01 | 12 |
| case | Sealed Genesis Terminal | 0.08 | 0.09 | 0.07 | 426,818 | 31,908 | 1,368,526 | — | 0.05 | 13 |
| knife | ★ Karambit Doppler (FN) | 1,734.70 | 1,756.19 | 1,620 | 6,530 | 2 | 0 | 37 | 1,187.94 | 12 |
| glove | ★ Hydra Gloves Mangrove (FT) | 35 | 34.30 | 32.48 | 1,008 | 171 | 32 | 1,204 | 25.11 | 13 |
| sticker | Sticker Slab headtr1ck Budapest 2025 | — | 0.05 | 0.14 | 112 | 0 | 22 | 210 | **12.88** | 3 |
| StatTrak | StatTrak™ FAMAS Meow 36 (WW) | 0.10 | 0.11 | 0.09 | 11,386 | 630 | 27 | 1,473 | 0.06 | 12 |
| Souvenir | Souvenir AK-47 Midnight Laminate (BS) | — | 34.90 | 20.56 | 206 | 0 | 0 | 11 | 22.38 | 9 |
| charm | Charm Backsplash | 0.09 | 0.09 | 0.08 | 18,658 | 5,207 | 374 | 9,783 | 0.05 | 12 |

Two things stand out. **Buy-order volume is enormous and real** — 426,818
standing orders on one case is a demand signal we cannot currently observe at
all. And the sticker row is a **red flag**: a Steam median of $0.05 against a
third-party price of $12.88 across only 3 markets. Thin third-party coverage
produces values that are not comparable to the Steam figure beside them.

---

## 10. Freshness analysis

Different fields in the same response carry different ages. They must not be
collapsed into one "observed at".

**`priceupdatedat`** — when the provider last refreshed Steam pricing:

| Age | Share |
|---|---|
| ≤ 1h | 23.17% |
| ≤ 6h | 67.68% |
| ≤ 24h | 1.61% |
| ≤ 72h | 0.63% |
| ≤ 168h | 3.42% |
| older | 0.01% |
| missing | 3.48% |

Newest 2026-09-30T18:29Z, oldest 2026-08-18T19:26Z — a **43-day spread**. The
universe is refreshed on a rolling basis, roughly 2% per 10 minutes, implying a
complete sweep every several hours.

**`lateststeamsellat`** — when the item last actually sold on Steam: 37.48%
within 24h, 18.29% within a week, 10.25% never (no recorded sale).

**Third-party prices** carry no per-asset timestamp inside `/items`. The only
timestamp available is on the dedicated market endpoint, and it is a **daily**
`createdat` — see §16.

Nothing in this source is real time. The freshest field family is Steam pricing
at a median age of a few hours.

---

## 11. Repeat-observation results

Two full-universe pulls, `18:29:14Z` and `18:39:21Z`, **10.1 minutes apart**.

- Response SHA-256 differed — the payload is not byte-stable.
- Rows identical at 39,703. **0 new, 0 disappeared.**
- Meaningful market state changed for 10,910 assets (27.48%).
- Steam-side state alone changed for **942 (2.37%)**.
- Third-party state changed for 10,715 (26.99%).

Provider timestamps advance independently: `priceupdatedat` moved for only 2.02%
of assets while 27.48% of state changed, confirming that the retrieval timestamp
and the market state are separate facts.

**Limitation, stated plainly:** 10.1 minutes is a short window. It bounds the
*floor* of the change rate and is corroborated by the independent freshness
histogram in §10, but it does not establish the daily change rate. A longer
repeat at the chosen cadence should be run before the collector is finalised.

---

## 12–15. Steam market, sales, buy-order and marketplace data

**Steam market.** Complete price surface: current listing, last sale, median and
average across four horizons, min/max/safe. Coverage 86–92% depending on field.
The provider's own status banner reads `healty: false — "Steam Prices Broken
because Steam updated their APIs"`. The data does **not** show a total outage:
`pricelatest` is null for 7.9%–15.5% depending on item group, and
`pricelatestsell` is null for 0% of knives. The banner appears partial or stale,
but it is a standing risk and a collector must tolerate null prices as normal.

**Sales volume.** `sold24h`, `sold7d`, `sold30d`, `sold90d`, `soldtotal`. FloatAlpha
has no sales data of any kind today — Skinport gives listings, not trades. This
is the single largest category of genuinely new evidence.

**Buy orders.** `buyorderprice`, `buyordermedian`, `buyorderavg`,
`buyordervolume`. A standing-bid book we cannot currently see.

**Marketplace.** Up to 13 third-party markets per asset with price and quantity.
`pricereal` present for 86.84%. Useful as cross-market context — but see §16
before treating any of it as an observation.

---

## 16. Direct Skinport comparison

This is the most consequential section.

`/market/skinport/prices` returned **47,976 rows** (cross-game — "Pixel
Chestplate" is Rust, so it is not a CS2 feed). **Every single row carried
`createdat: 2026-09-28T00:00:00+00:00`** — one date, for all of them.

Against our own `provider_asset_state` at the moment of the probe:

| Measure | Value |
|---|---|
| Overlap compared | 24,754 assets |
| Exact price match | 8,527 (34.45%) |
| Median abs. difference | **0.41%** |
| p75 / p90 / p99 | 0.99% / 7.27% / 51.60% |
| Within 1% / 5% / 10% | 18,570 / 21,530 / 22,896 |
| Quantity exact match | 17,762 / 24,754 (71.75%) |
| **Timestamp lag** | **~66.6 hours** |

Worst divergences are all thin, cheap items where their value is far higher than
ours — e.g. *Sticker Slab br0 (Foil) Austin 2025* at 0.07 (ours) vs 3.02
(theirs), +4,214%.

**Verdict: a delayed daily mirror, not an independent observation.** It agrees
closely for the liquid bulk and diverges wildly in the tail, which is exactly
what a three-day-old snapshot of a moving market looks like. It is *not* a
usable fallback for direct Skinport collection, and substituting it would
silently degrade every derived measure. It *is* acceptable as low-confidence
cross-market context, clearly labelled and never merged with direct evidence.

---

## 17–18. Historical capabilities and depth

`GET /steam/api/history` for *AK-47 | Redline (Field-Tested)* returned **461
points spanning 2014-02-19 → 2026-09-24 — 12.6 years**, each point carrying
both **price and `sold` volume**:

```json
{"createdat":"2014-02-19T00:00:00+00:00","price":42.85,"sold":1112}
```

At the default `interval=10` this is a ten-day sampling; `interval=1` should
yield daily granularity (not exercised, to conserve the OTHER allowance).

`POST /steam/api/items/history` returned **4,607 daily points** for a three-item
basket in one call — but as an *aggregated basket worth*, not per-item series.
It is a portfolio-value endpoint, priced at 1 credit regardless of basket size.

`/markets/history` (2 credits) and `/market/skinport/prices` are both authorized.

**Depth was measured on one asset only.** Depth almost certainly varies with
item age and liquidity, and §9 shows several representative assets with zero
recorded sales. Per-asset depth distribution is an explicit gap — see §30.

---

## 19. Backfill opportunity

| Scope | Assets | Credits | Fits plan? | Points | Est. size |
|---|---|---|---|---|---|
| **Canonical tracked** | **100** | **100** | **Yes — 100 of 500/period** | ~46,100 | ~3 MB |
| Skinport overlap | 24,846 | 24,846 | No | ~11.5 M | ~687 MB |
| Full universe | 39,703 | 39,703 | No | ~18.3 M | ~1.1 GB |

**Classification**

- **HIGH VALUE** — 12.6-year daily price *and sales volume* history for the 100
  tracked assets. It costs 100 credits, fits the plan with room to spare, and
  gives long-horizon context FloatAlpha cannot otherwise obtain at any price.
- **MEDIUM VALUE** — the embedded `latest10steamsales` array, free with every
  `/items` row, giving ten recent daily sale points for all 39,703 assets.
- **LOW VALUE** — basket history via `/items/history`; it answers a portfolio
  question we do not yet ask.
- **NOT RELIABLE ENOUGH YET** — any third-party/marketplace history, because
  §16 shows the marketplace layer is a stale daily mirror.

---

## 20. Canonical mapping results

Exact `market_hash_name` matching, no normalization applied, nothing modified:

| Comparison | Result |
|---|---|
| FloatAlpha canonical present in SteamWebAPI | **100 / 100 (100%)** |
| Canonical missing from SteamWebAPI | 0 |
| Direct Skinport present in SteamWebAPI | 24,846 / 24,906 (99.76%) |
| Direct Skinport missing from SteamWebAPI | 60 |
| SteamWebAPI assets absent from direct Skinport | **14,857** |

Exact string matching is sufficient for the tracked universe. The 60 misses and
the variant/phase handling in `prices[].variants` need examination before any
mapping rule changes — which this task deliberately did not touch.

---

## 21. Data-quality findings

**Zero is a real measurement for some fields and an absence marker for others.**
Both values occur for `sold24h` (18,469 zeros, 4,071 nulls), `soldtoday` and
`minfloat` (13,083 zeros — Factory New legitimately starts at 0.0 — against
22,038 nulls). These must not be normalized together.

More concerning, two fields encode absence *only one way*:

- `offervolume` — 4,904 zeros, **0 nulls**. A zero cannot be distinguished
  between "no listings" and "not measured".
- `buyordervolume` — 0 zeros, **3,682 nulls**. The mirror image.

Given FloatAlpha's existing rule that absence is recorded as absence and never
as quantity zero, **`offervolume = 0` must be stored as unknown unless an
accompanying field proves a measurement occurred.**

No negative values anywhere except `winloss`/`winlossprice`, where **2,800
negatives are correct** (Steam more expensive than third-party markets).

Stale values are real: `priceupdatedat` spans 43 days, so a small tail of assets
carries pricing over a month old inside an otherwise fresh response.

---

## 22. Provenance and fingerprint recommendation

Three distinct fingerprints, matching the existing Skinport design:

**RESPONSE FINGERPRINT** — SHA-256 of the delivered payload. Confirmed unstable
between pulls (differs at 10 minutes), so it identifies a delivery, not a state.

**STATE FINGERPRINT** — per asset, over meaningful market state only:

- *Include*: the Steam price surface, `buyorderprice`/`buyordermedian`/
  `buyordervolume`, `offervolume`, the sales counts, `marketvolume`, `points`.
- **Exclude `realmarketsquantity`** and ideally the whole third-party family.
  It alone churns 24.50% per ten minutes and is a cross-market aggregate, not an
  observation of one venue. Including it would multiply change rows by roughly
  **12×** for no evidential gain.
- *Exclude* all retrieval metadata: `priceupdatedat`, `createdat`,
  `hourstosold`, `lateststeamsellat`, `firstseenat`, `releasedat`.
- *Exclude* metadata entirely — it changed 0% and belongs in a static table.

**TRANSFORMER VERSION** — a FloatAlpha-side constant, as with
`skinport-universe@1` / `provider-state@1`.

---

## 23. 3D Viewer findings

**Included in Item Small.** `/steam/api/screenshot/usage` returned `active: true`
with its own allowance: **2/minute, 50/day, 500/month**, usage 0 before the probe.

A render against a real inspect link returned **HTTP 200 in 5.2 s, a 121 KB AVIF
data URI**, synchronously (no job/poll cycle). Authentication is the same
`X-Api-Key`; no separate viewer key was required and none was created.

Documented capability not exercised, to conserve the allowance: front/back/both
views, transparent cutouts, custom background colour/image, logo overlay and
opacity, float readout (requires width ≥ 960), custom item/paint labels, and
`download`/`base64`/inline formats. Doppler phases, stickers and charms are
carried by the inspect certificate itself.

**Economics decide the fit.** At 500 renders/month this cannot serve per-view
rendering on a public asset page. It suits a **pre-rendered, cached** use —
generating an image once per tracked asset and storing it — or a
Steam-connected inventory view where a user renders their own item occasionally.

---

## 24. Future Connect Steam relevance

`/steam/api/inventory` is authorized and returned rows for a public profile. It
carries **14 fields `/items` cannot**:

```
count, assetid, nametag, image, tags, descriptions, inspectlinkparsed,
float{floatvalue, paintseed, stickers, keychains, certificate},
tradelocked, contextid, owneronly, tradeprotected, tradeprotectedmaxdays
```

That is precisely the individual-item layer: **asset ID, inspect link, float
value, paint seed, applied stickers and charms, trade lock and trade-protection
window**. `/items` describes an item *type*; `/inventory` describes a *specific
physical item*.

In the probe's sample the `float` block came back all null (a cached/fallback
response), so per-item float resolution is **unverified** and must be confirmed
before any portfolio work depends on it.

The eventual chain — Steam auth → SteamID → inventory → market hash name →
canonical mapping → portfolio → intelligence → viewer — is supported by this
source. Nothing was implemented.

---

## 25. Potential new evidence-safe intelligence

Hypotheses only, each stated as an observation and never as a prediction. All
are grounded in fields this probe actually measured.

- **Steam sales activity** — "Steam recorded 59 sales in 24h against 2,396 in
  30 days." New: we have no trade data at all today.
- **Standing demand** — "48,296 buy orders stand at or below $33.93."
- **Listed supply** — "1,204 Steam listings are offered."
- **Cross-market dispersion** — lowest across 13 venues against the Steam
  figure, clearly labelled as a stale daily mirror.
- **Long-horizon context** — "current price against a 12.6-year observed range."
- **Supply/demand movement** — "offers fell while buy orders rose," reported as
  two measured counts, never as a causal claim about price.

Explicitly out of scope: buy/sell signals, price targets, forecasts,
"undervalued", or any statement that demand implies future price.

---

## 26. Source complementarity

**Skinport direct — strengths:** 5-minute cadence; true real-time listing price
and quantity for one venue; our own provenance, run ledger and change history;
no third-party interpretation between the venue and us.

**SteamWebAPI — strengths:** 1.6× wider universe (+14,857 assets); Steam
buy-order price and volume; Steam listing volume; Steam sales counts across four
horizons; 12.6 years of daily price-and-volume history; complete static metadata
including float ranges, collections and rarity; a 3D render capability.

**Overlap:** 24,846 assets by exact name. Both report a price and a quantity —
but for *different venues*, and SteamWebAPI's Skinport figure is ~66.6 h stale.

**Unique value:** everything Steam-side. Every field in §12–14 is evidence
FloatAlpha currently does not have from any source.

**Conflicts:** the Skinport mirror is the trap. It looks like our data, is named
like our data, agrees within 1% for 75% of assets — and is three days old.
Provider observations must stay distinguishable at the schema level so this can
never be merged in by accident.

**SteamWebAPI is not a replacement for Skinport.** No evidence suggested otherwise.

---

## 27. Recommended production cadence

| Cadence | Calls / 30d | Within 1,500? | Reserve |
|---|---|---|---|
| 5 min | 8,640 | No | — |
| 15 min | 2,880 | No | — |
| 30 min | 1,440 | Yes | **60 calls (4%) — not acceptable** |
| **Hourly** | **720** | **Yes** | **780 calls (52%)** |
| 6-hourly | 120 | Yes | 1,380 (92%) |

**Recommendation: hourly.**

It fits the allowance with a 52% operational reserve for probes, recovery and
manual investigation. It is justified by the data rather than by symmetry with
Skinport: only 2.37% of assets changed any Steam field in ten minutes, and the
freshness histogram shows the provider itself refreshes on a multi-hour rolling
sweep. Collecting faster than the provider updates would spend the allowance on
re-reading unchanged values.

**30-minute fits arithmetically and is called out explicitly as unsafe** — 60
spare calls for a whole month leaves no room for a failed run, a backfill or a
single investigation.

Nothing has been scheduled.

---

## 28. Storage projections

Estimated normalized change row: **664 bytes** (544 B of state payload + ~120 B
of keys, hashes, timestamps and run linkage).

At hourly cadence:

| Scope | Rows/day | Rows/30d | Rows/year | Storage/year |
|---|---|---|---|---|
| Steam-side state only | ~5,600 | ~168,000 | ~2.0 M | **~1.4 GB** |
| Including third-party churn | ~64,800 | ~1.9 M | ~23.7 M | **~15.7 GB** |

**Excluding the third-party family from change history cuts annual storage by
roughly 11×.** This is the same conclusion §22 reaches from the fingerprint side,
arrived at independently.

Static metadata is 39,703 rows written once (it changed 0%), not history.

*Caveat:* these projections extrapolate a single 10.1-minute observation and
saturate at longer intervals; treat them as an order of magnitude, not a budget.

---

## 29. Proposed provider #2 architecture

Fits the existing shape without altering it:

```
SteamWebAPI
  → provider_collection_runs   (own rows; response_sha256, collector/transformer version)
  → provider_assets            (own provider identity; market_hash_name + classid/instanceid)
  → provider_asset_state       (Steam-side state only, state_hash excludes third-party + retrieval)
  → provider_asset_state_history (change-only)
  → canonical mapping          (exact name; 100/100 on tracked assets)
  → derived intelligence       (source-tagged, never merged with Skinport evidence)
```

Four separations, each justified by a measurement in this report:

1. **Static metadata** in its own table — changed 0%.
2. **Current state** — Steam-side only.
3. **Historical state** — change-only, mirroring the Skinport design.
4. **Raw evidence** — response fingerprint and run row only. The full payload is
   63 MB per pull; storing it per asset would be absurd and per pull is 45 GB/year
   at hourly. Keep the hash, not the body.

**Change-only, not full snapshot.** At 2.37% Steam-side change per interval, a
full snapshot would write ~40× more rows than it carries information.

---

## 30. Risks and unknowns

1. **Provider status is `healty: false`** — "Steam Prices Broken because Steam
   updated their APIs". Partial in the data, but a standing dependency on a
   third party's relationship with Valve.
2. **The Skinport mirror is a silent trap** (§16). Schema-level separation is
   the mitigation.
3. **Repeat observation covered only 10.1 minutes** — the daily change rate is
   extrapolated, not measured.
4. **History depth measured on one asset.** Distribution across liquid and thin
   assets is unknown.
5. **Per-item float from `/inventory` came back null** and is unverified.
6. **`offervolume` cannot distinguish zero from unknown** (§21).
7. **`/market/{market}/prices` consumes the ITEMS allowance**, so any recurring
   use competes with the collector.
8. **`pricesafe` semantics are undocumented** — 21.58% null, provider-derived.
9. **Item Small has no stated SLA**; 39,703-row pulls took 7.9 s here but that is
   one sample.
10. **9,019 assets (22.7%) are flagged `unstable`** by the provider, with a
    reason field we have not interpreted.

---

## 31. Recommended V1 integration scope

The smallest batch that captures the unique value and none of the traps:

1. **Hourly `/items` collection**, `select`-limited, change-only, into
   SteamWebAPI-specific provider tables. ~720 calls/month of 1,500.
2. **Steam-side fields only in state and fingerprint** — prices, buy orders,
   offer volume, sales counts. Third-party fields stored separately or not at
   all in V1.
3. **Static metadata table** written once, refreshed rarely.
4. **One-off history backfill for the 100 canonical tracked assets** — 100
   credits, ~46,100 points, ~3 MB, 12.6 years of price *and* sales volume.
5. **Exact-name canonical mapping** for the tracked universe (100/100 verified);
   no mapping-rule changes.
6. **Nothing surfaced in the product** until the derived layer can label source
   and freshness per figure.

## 32. Explicitly deferred

Universe expansion beyond the tracked 100 · third-party marketplace ingestion ·
any use of the Skinport mirror · full-universe history backfill · the 3D viewer ·
Steam account connection and `/inventory` · new derived signals from Steam
volume or buy orders · cadence scheduling · migrations · deployment.

---

## Acceptance criteria

| # | Question | Answer |
|---|---|---|
| 1 | Useful CS2 assets exposed? | 39,703 unique, 0 duplicates |
| 2 | Useful fields? | 93 available; Steam demand/supply/volume are the new ones |
| 3 | Which change? | Steam-side 2.37%/10 min; third-party 26.99%; metadata 0% |
| 4 | Freshness? | Steam pricing 68% ≤6h; Skinport mirror ~66.6h stale; nothing real-time |
| 5 | Beyond Skinport? | +14,857 assets, buy orders, offer volume, sales counts, 12.6y history |
| 6 | Skinport match? | 34.45% exact, median 0.41%, p99 51.60%, ~66.6h lag |
| 7 | History on Item Small? | 12.6 years, price + volume, 1 credit/asset |
| 8 | Backfill? | Yes for 100 tracked assets (100 credits). No for the universe |
| 9 | Real costs? | Probe used ~22 credits; hourly = 720/1,500; 1.4 GB/yr Steam-only |
| 10 | Cadence? | Hourly. 30-min fits but leaves no reserve |
| 11 | Store permanently? | Steam price surface, buy orders, offer volume, sales counts |
| 12 | Source-specific? | Everything third-party, `pricesafe`, `winloss`, `unstable` |
| 13 | Fingerprints? | Response ≠ state; exclude third-party and retrieval from state |
| 14 | 3D viewer? | Included; 500 renders/month; pre-rendered use only |
| 15 | Connect Steam needs? | `/inventory` gives assetid, inspect link, float, seed, stickers |
| 16 | Provider #2 V1? | §31 |

**STOP.** No provider implementation follows this probe. Awaiting review.
