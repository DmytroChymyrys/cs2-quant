# Sources

Initial source: [ByMykel/CSGO-API](https://github.com/ByMykel/CSGO-API), an unofficial community extraction of CS2 item definitions, not a Valve-operated API. It is authoritative for the imported records and provenance, not for market observations or ownership rights.

Pinned revision: `be84e43a2eb379faf653158e409a2c90c4072312`, upstream commit time 2026-09-09T23:28:46Z. English datasets are fetched from immutable commit URLs. Exact bytes, SHA-256 and record counts are checked against [the manifest](../../config/catalog/upstream-manifest.json). Source dates are snapshot dates; records do not expose an individual update timestamp.

| Dataset | Records | Null market name | Purpose |
| --- | ---: | ---: | --- |
| skins_not_grouped.json | 21407 | 0 | Individual weapon, knife and glove variants; weapon/pattern/paint, wear, float bounds, StatTrak and Souvenir |
| stickers.json | 11134 | 701 | Sticker definitions and tournament/effect metadata |
| crates.json | 481 | 14 | Cases, capsule types, souvenir packages and other source containers |
| keychains.json | 78 | 0 | Charms and collection membership |
| agents.json | 63 | 0 | Agents, team and source model identifiers |
| patches.json | 112 | 0 | Patch definitions and rarity |
| graffiti.json | 2111 | 299 | Graffiti definitions including nonmarketable entries |
| music_kits.json | 189 | 6 | Music kits, exclusive flags and distinct market identities |
| collectibles.json | 667 | 590 | Coins, medals, pins, passes and trophies; source subtype retained |
| keys.json | 39 | 12 | Keys including nonmarketable definitions |
| tools.json | 4 | 4 | Four tool definitions emitted by the upstream tools generator |
| base_weapons.json | 67 | 67 | Base weapon/equipment definitions without market names |
| highlights.json | 926 | 0 | Souvenir highlight definitions; video/thumbnail references preserved as metadata only |
| sticker_slabs.json | 11134 | 701 | Distinct sticker-slab definitions, separate from stickers |

All selected records have an id and display name. Use only explicit market_hash_name for market matching; absent/null remains null. Never derive it from name. Every dataset supplies an image field in this snapshot; absent/null images are nevertheless supported. Rarity, collections, teams and type-specific fields are retained only where supplied. The ungrouped skin feed does not supply grouped collection memberships or support flags; do not infer them.

The 122 duplicated non-null market names are Doppler/Gamma Doppler paint variants in skins_not_grouped. Source IDs are unique in every selected dataset; there are no cross-dataset market-name collisions. Catalog identity uses provider + dataset + source ID, not market name. Source shape and host details for every dataset are in [source-inventory.json](../../reports/catalog/source-inventory.json).

## Selection and updates

Excluded all.json and inventory.json because they are aggregate/alternative projections, skins.json because it groups wear/state variants, and collections.json because collections are relationships rather than individual market assets. Existing collection references are retained where the item dataset supplies them. This prevents double counting and false identity merges. Tools are justified by the upstream [tools generator import](https://github.com/ByMykel/CSGO-API/blob/be84e43a2eb379faf653158e409a2c90c4072312/update.js), even though the README has no separate tools section.

The upstream [update generator](https://github.com/ByMykel/CSGO-API/blob/be84e43a2eb379faf653158e409a2c90c4072312/update.js) checks both the game manifest and image-map hash before regenerating language datasets; it supports forced regeneration. Its [README](https://github.com/ByMykel/CSGO-API/blob/be84e43a2eb379faf653158e409a2c90c4072312/README.md) describes scheduled workflow runs. FloatAlpha does not infer per-record source update times from this. A newer source revision must be explicitly reviewed and pinned; sync never follows mutable main silently.

No website scraping or market-provider metadata was used. Full upstream files live in an ignored download cache; small exact record fixtures are checked in for tests. Provenance includes the source revision and raw-record hash, so the original values remain recoverable from the pinned snapshot.
