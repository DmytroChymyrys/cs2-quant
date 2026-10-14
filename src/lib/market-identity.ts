/**
 * The one canonical market-name normalisation.
 *
 * Every system that keys on a CS2 market hash name — provider matching, the
 * inventory matcher, cross-venue comparison and observed-asset URLs — must
 * agree byte for byte on what "the same item" means. Until now the same three
 * operations were written twice, in `inventory.ts` and `cross-venue.ts`. They
 * were identical, which is the dangerous kind of duplication: nothing fails
 * when one drifts, the two simply stop matching the same items and no test
 * notices.
 *
 * Both now delegate here, and so does observed-asset slug generation, which
 * makes a URL's identity provably the same identity the join uses.
 *
 * ## The transform, and why each part
 *
 * NFC, trimmed, internal whitespace collapsed, **case preserved**.
 *
 * Case folding is not safe: the broad provider catalogue contains
 * case-insensitive collisions, so lowering would merge genuinely different
 * items. NFC matters because roughly a fifth of names carry non-ASCII (★, ™,
 * and CJK numerals such as 壱 and 弐) which can arrive in more than one
 * Unicode encoding of the same text.
 *
 * Measured over 65,553 production provider rows: 39,999 distinct raw names
 * reduce to 39,999 distinct canonical names. The transform currently merges
 * nothing — it is insurance that the two providers' spellings cannot diverge,
 * not a deduplicator.
 */
export function canonicalMarketName(marketHashName: string): string {
  return marketHashName.normalize("NFC").trim().replace(/\s+/g, " ");
}

/**
 * The SQL expression that must stay equivalent to `canonicalMarketName`.
 *
 * Kept beside it so the two cannot be changed independently, and asserted
 * equivalent by test against the live catalogue. `$COL` is substituted by the
 * caller rather than interpolated here, because this is a fragment and not a
 * query.
 */
export const CANONICAL_MARKET_NAME_SQL =
  `normalize(regexp_replace(btrim($COL), '\\s+', ' ', 'g'), NFC)`;

/** The fragment with a column substituted in. */
export function canonicalMarketNameSql(column: string): string {
  return CANONICAL_MARKET_NAME_SQL.replace("$COL", column);
}
