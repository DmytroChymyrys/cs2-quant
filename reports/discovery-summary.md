# Skinport discovery report

Generated: 2026-09-09T15:59:49.406Z

Exclude every non-null version row. Exclude all unversioned rows when their name has multiple unversioned rows in that endpoint. A single unversioned row may coexist with excluded versioned rows. No assets are approved or tracked by this report.

| Metric | Items | Sales history |
| --- | ---: | ---: |
| totalRows | 25425 | 36864 |
| uniqueMarketHashNames | 25163 | 36010 |
| duplicateNameGroups | 78 | 279 |
| excessDuplicateRows | 262 | 854 |
| duplicateNameVersionGroups | 0 | 0 |
| excessNameVersionRows | 0 | 0 |
| excludedVersionedRows | 360 | 974 |
| excludedAmbiguousUnversionedRows | 0 | 0 |
| eligibleCandidates | 25065 | 35890 |

Duplicate name groups count names occurring more than once; excess duplicate rows sum (group size − 1). Exclusions count rows, not names.

## Eligible rows by name heuristic

| Category | Items | Sales history |
| --- | ---: | ---: |
| cases | 40 | 40 |
| capsules/stickers | 8203 | 10488 |
| weapons | 10908 | 12430 |
| knives | 1960 | 3270 |
| gloves | 406 | 470 |
| other/unknown | 3548 | 9192 |

Categories are local name heuristics, not source taxonomy: star-prefixed gloves/hand wraps, remaining star-prefixed knives, sticker prefix or Capsule word, Case suffix, known firearm prefixes, then other/unknown. They do not establish identity.

## Identity conclusion

market_hash_name alone is not unique in either complete endpoint snapshot. Explicit version labels explain many variants; phase and special labels in this report come only from the source version field. Repeated URLs or a version label do not establish a globally unique variant key. Observed duplicate (market_hash_name, version) groups and excess rows are counted separately above, treating missing and null version alike. Even zero observed collisions does not establish (market_hash_name, version) as a guaranteed identity.

The unversioned, unambiguous subset is eligible for manual review under the current policy; snapshot uniqueness does not guarantee future uniqueness. 25065 eligible item names have eligible history rows. Discovery and seed exclude ambiguous unversioned names. The collector retains its stricter fail-visible duplicate guard after version filtering. No approved asset list was changed.

## Representative duplicate groups

### items: ★ Bayonet | Doppler (Factory New)

Reasons: special: explicit source version label; phase: explicit source version.

```json
[
  {
    "version": "Ruby",
    "item_page": "https://skinport.com/item/bayonet-doppler-factory-new+ruby",
    "market_page": "https://skinport.com/market/knife/bayonet?item=Doppler&phase=7",
    "min_price": 1771.85,
    "quantity": 6
  },
  {
    "version": "Sapphire",
    "item_page": "https://skinport.com/item/bayonet-doppler-factory-new+sapphire",
    "market_page": "https://skinport.com/market/knife/bayonet?item=Doppler&phase=6",
    "min_price": 1764.48,
    "quantity": 4
  },
  {
    "version": "Phase 4",
    "item_page": "https://skinport.com/item/bayonet-doppler-factory-new+phase-4",
    "market_page": "https://skinport.com/market/knife/bayonet?item=Doppler&phase=5",
    "min_price": 412.06,
    "quantity": 26
  },
  {
    "version": "Phase 3",
    "item_page": "https://skinport.com/item/bayonet-doppler-factory-new+phase-3",
    "market_page": "https://skinport.com/market/knife/bayonet?item=Doppler&phase=4",
    "min_price": 409.07,
    "quantity": 27
  },
  {
    "version": "Phase 2",
    "item_page": "https://skinport.com/item/bayonet-doppler-factory-new+phase-2",
    "market_page": "https://skinport.com/market/knife/bayonet?item=Doppler&phase=3",
    "min_price": 457.89,
    "quantity": 21
  },
  {
    "version": "Phase 1",
    "item_page": "https://skinport.com/item/bayonet-doppler-factory-new+phase-1",
    "market_page": "https://skinport.com/market/knife/bayonet?item=Doppler&phase=2",
    "min_price": 410.8,
    "quantity": 24
  }
]
```

### items: ★ Bayonet | Gamma Doppler (Minimal Wear)

Reasons: special: explicit source version label; phase: explicit source version.

```json
[
  {
    "version": "Emerald",
    "item_page": "https://skinport.com/item/bayonet-gamma-doppler-minimal-wear+emerald",
    "market_page": "https://skinport.com/market/knife/bayonet?item=Gamma%20Doppler&phase=9",
    "min_price": 2355.53,
    "quantity": 1
  },
  {
    "version": "Phase 4",
    "item_page": "https://skinport.com/item/bayonet-gamma-doppler-minimal-wear+phase-4",
    "market_page": "https://skinport.com/market/knife/bayonet?item=Gamma%20Doppler&phase=5",
    "min_price": 613.33,
    "quantity": 3
  },
  {
    "version": "Phase 3",
    "item_page": "https://skinport.com/item/bayonet-gamma-doppler-minimal-wear+phase-3",
    "market_page": "https://skinport.com/market/knife/bayonet?item=Gamma%20Doppler&phase=4",
    "min_price": 659.22,
    "quantity": 2
  },
  {
    "version": "Phase 1",
    "item_page": "https://skinport.com/item/bayonet-gamma-doppler-minimal-wear+phase-1",
    "market_page": "https://skinport.com/market/knife/bayonet?item=Gamma%20Doppler&phase=2",
    "min_price": 681.11,
    "quantity": 1
  }
]
```

### history: ★ Bayonet | Case Hardened (Battle-Scarred)

Reasons: special: explicit source version label; unknown: unversioned row; no variant identity inferred.

```json
[
  {
    "version": "Blue Gem",
    "item_page": "https://skinport.com/item/bayonet-case-hardened-battle-scarred",
    "market_page": "https://skinport.com/market?item=Case%20Hardened&cat=Knife&type=Bayonet",
    "last_24_hours": {
      "min": null,
      "max": null,
      "avg": null,
      "median": null,
      "volume": 0
    }
  },
  {
    "version": null,
    "item_page": "https://skinport.com/item/bayonet-case-hardened-battle-scarred",
    "market_page": "https://skinport.com/market?item=Case%20Hardened&cat=Knife&type=Bayonet",
    "last_24_hours": {
      "min": null,
      "max": null,
      "avg": null,
      "median": null,
      "volume": 0
    }
  }
]
```

## Provenance and complete duplicate details

This report reads saved files and makes no network requests. Source URL/request parameters and exact acquisition times are not independently recorded in the files; file modification times below are filesystem evidence only. Production schemas validated both payloads.

- items: /tmp/cs2-quant-items.json; modified 2026-09-09T15:44:57.562Z; 10452436 bytes; SHA-256 3e86ce2ae58308709126183cdca18084bdde1f8f2739fec8cb2dcd95c42f5742
- history: /tmp/cs2-quant-history.json; modified 2026-09-09T15:43:43.847Z; 20864033 bytes; SHA-256 9d2216b714f572f896d4490b777e5a720269e7a54dbf35350249770a3bee63ed

[Complete duplicate details](discovery-details.json) includes every duplicate name group for both endpoints, all original source fields for every member row, and reason labels. Numeric tokens are preserved losslessly.
