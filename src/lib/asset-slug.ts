/**
 * Public URL identity for an asset.
 *
 * Asset pages were addressed by raw UUID, which says nothing to a reader or a
 * search engine. These slugs put the asset's name in the URL while the UUID
 * stays the internal identity — nothing downstream changes key.
 *
 * ## Why the id suffix
 *
 * A slug is derived from a name, and names do not guarantee unique slugs.
 * Slugification is lossy: "AK-47 | Redline" and "AK-47 Redline" both reduce to
 * "ak-47-redline". The production catalogue already proves the risk is real —
 * 153 slugs there map to more than one row.
 *
 * The alternative, disambiguating only on collision, is not stable: whichever
 * asset "wins" the bare slug depends on what else exists, so adding an asset
 * could silently move an already-indexed URL onto different content. That is
 * the one failure this must not have, because a URL Google has indexed would
 * then serve the wrong item.
 *
 * Appending eight hex characters of the asset's own id makes each slug unique
 * and permanent by construction: it depends on nothing but the asset itself,
 * so it cannot be disturbed by catalogue growth or a neighbour's rename. The
 * readable words still carry the search value.
 */

/** Length cap for the readable portion, so URLs stay manageable. */
const READABLE_MAX = 60;

/** The discriminator: the first block of the asset's UUID. */
const DISCRIMINATOR = /^[0-9a-f]{8}$/i;

export function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    // Strip combining marks left behind by decomposition.
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, READABLE_MAX)
    .replace(/-+$/g, "");
}

/** The public path segment for an asset. */
export function assetSlug(name: string, id: string): string {
  const readable = slugifyName(name);
  const discriminator = id.slice(0, 8).toLowerCase();
  return readable ? `${readable}-${discriminator}` : discriminator;
}

/** The public path for an asset, without query parameters. */
export function assetPath(name: string, id: string): string {
  return `/asset/${assetSlug(name, id)}`;
}

/**
 * The id fragment a slug points at, or null.
 *
 * Read from the end: the readable portion may itself contain hex-looking
 * words, but the discriminator is always last.
 */
export function discriminatorFromSlug(slug: string): string | null {
  const last = slug.split("-").at(-1);
  return last && DISCRIMINATOR.test(last) ? last.toLowerCase() : null;
}

/** True when a path segment is a bare UUID, i.e. a legacy asset URL. */
export function isLegacyAssetId(segment: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    segment,
  );
}

/**
 * Resolves a public segment to an asset.
 *
 * Accepts a slug or a bare UUID, so a legacy URL can be resolved well enough
 * to redirect it. A slug whose readable portion no longer matches the asset's
 * current name still resolves: the discriminator is the identity, and the
 * caller redirects to the current spelling.
 */
export function resolveAssetSegment<T extends { id: string }>(
  segment: string,
  assets: readonly T[],
): T | null {
  if (isLegacyAssetId(segment))
    return assets.find((a) => a.id.toLowerCase() === segment.toLowerCase()) ?? null;
  const discriminator = discriminatorFromSlug(segment);
  if (!discriminator) return null;
  const matches = assets.filter(
    (a) => a.id.slice(0, 8).toLowerCase() === discriminator,
  );
  // An eight-hex prefix is not guaranteed unique across arbitrarily many
  // assets. Refusing an ambiguous match is correct: serving an arbitrary one
  // would put the wrong item under an indexed URL.
  return matches.length === 1 ? matches[0] : null;
}
