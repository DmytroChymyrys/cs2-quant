type Identity = { market_hash_name: string; version?: string | null };
export function validateUniverse(names: string[], items: Identity[], history: Identity[]) {
  const counts = (rows: Identity[]) => {
    const map = new Map<string, number>();
    for (const row of rows) if (row.version == null) map.set(row.market_hash_name, (map.get(row.market_hash_name) ?? 0) + 1);
    return map;
  };
  const itemCounts = counts(items), historyCounts = counts(history);
  return names.map(marketHashName => ({ marketHashName, itemsMatches: itemCounts.get(marketHashName) ?? 0,
    historyMatches: historyCounts.get(marketHashName) ?? 0,
    uniqueProposalName: names.filter(name => name === marketHashName).length === 1 }));
}

/**
 * Canonical membership is not current market availability.
 *
 * `validateUniverse` above is an ADMISSION gate: it proves a newly proposed
 * name resolves to exactly one unambiguous Skinport identity, in both items
 * and history, before that name becomes a canonical asset. It answers "may
 * this become an asset?", never "is this asset listed today?".
 *
 * Those are different questions and conflating them breaks the universe in
 * both directions:
 *
 *   - A delisted member is not an identity error. The product already models
 *     that state as NO_ACTIVE_LISTING_OBSERVED, keeps the observations it
 *     recorded, and reports its current metrics as unavailable rather than
 *     inventing them. Dropping it would destroy real history.
 *   - Re-validating members on every seed would mean the universe can never be
 *     changed again once any single member delists, because each seed
 *     revalidates the whole list.
 *
 * So admission is strict and membership is durable. Relisting needs no new
 * canonical identity: the asset never stopped being one.
 */
export type UniverseDecision = {
  /** Names being admitted for the first time; strictly validated. */
  admissions: string[];
  /** Names already canonical; membership is not re-litigated. */
  retained: string[];
  /** Admission failures. Any of these must stop a seed. */
  failures: ReturnType<typeof validateUniverse>;
  /** Members with no current Skinport listing. Recorded, never a failure. */
  retainedWithoutCurrentListing: string[];
};

export function decideUniverse(args: {
  approved: readonly string[];
  /** Names that are already canonical, tracked assets. */
  alreadyCanonical: ReadonlySet<string>;
  items: Identity[];
  history: Identity[];
}): UniverseDecision {
  const validation = validateUniverse(
    [...args.approved],
    args.items,
    args.history,
  );
  const admissions = args.approved.filter((n) => !args.alreadyCanonical.has(n));
  const admitted = new Set(admissions);
  return {
    admissions,
    retained: args.approved.filter((n) => args.alreadyCanonical.has(n)),
    failures: validation.filter(
      (a) =>
        admitted.has(a.marketHashName) &&
        (a.itemsMatches !== 1 ||
          a.historyMatches !== 1 ||
          !a.uniqueProposalName),
    ),
    retainedWithoutCurrentListing: validation
      .filter(
        (a) =>
          !admitted.has(a.marketHashName) &&
          (a.itemsMatches !== 1 || a.historyMatches !== 1),
      )
      .map((a) => a.marketHashName),
  };
}
