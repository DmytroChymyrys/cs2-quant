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
