-- Supports the Inventory read model's current-reference price lookup.
--
-- Index only. No table change, no backfill, no trigger, no data touched.
--
-- MARKET family, despite being driven by a product feature. provider_assets is
-- a market table, so this belongs to the market stream; putting it in the
-- product stream made `classifyMigration` return MARKET and the family guard
-- refused it, which is the guard working correctly rather than an obstacle to
-- route around.
--
-- WHAT IT SERVES
--
-- Inventory resolves a user's holdings to Skinport references by the NORMALISED
-- market key, because the Steam inventory response and the provider universe do
-- not always agree on whitespace or Unicode composition:
--
--   where a.provider = 'SKINPORT_DIRECT'
--     and normalize(regexp_replace(btrim(a.market_hash_name), '\s+', ' ', 'g'), NFC)
--           in (<the holding's keys>)
--
-- Matching on an expression meant no existing index applied, so every page load
-- sequentially scanned all 65,138 provider_assets rows.
--
-- WHY THE FULL COMPOSITE AND NOT A PARTIAL INDEX
--
-- The smaller, more obviously-targeted shapes were built and measured against
-- real production cardinalities inside a transaction that was rolled back:
--
--   (expr) WHERE provider='SKINPORT_DIRECT'            1560 kB  NOT CHOSEN  239 ms
--   (provider, expr) WHERE provider='SKINPORT_DIRECT'  2016 kB  NOT CHOSEN  231 ms
--   (provider, expr)                                   5048 kB  Index Scan  2.2 ms
--
-- The planner declined both partial variants and kept the sequential scan, so
-- they would have cost disk and bought nothing. Only the full composite is
-- selected: the leading provider column turns the lookup into an equality probe
-- per key, which is exactly this query's access pattern. The choice is planner
-- evidence, not a preference for the larger index.
--
-- btrim, regexp_replace and normalize are all IMMUTABLE, which is what makes
-- the expression indexable; it is written against the bare column because an
-- index cannot reference a query alias.
CREATE INDEX IF NOT EXISTS "provider_assets_normalized_name" ON "provider_assets"
  USING btree (
    "provider",
    (normalize(regexp_replace(btrim("market_hash_name"), '\s+', ' ', 'g'), NFC))
  );
