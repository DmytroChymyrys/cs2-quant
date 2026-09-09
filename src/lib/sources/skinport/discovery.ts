type SourceRow = { market_hash_name: string; version?: string | null };
export const categories = ['cases', 'capsules/stickers', 'weapons', 'knives', 'gloves', 'other/unknown'] as const;
export function heuristicCategory(name: string): typeof categories[number] {
  if (/^★.*(?:Gloves|Hand Wraps)\b/.test(name)) return 'gloves';
  if (/^★/.test(name)) return 'knives';
  if (/^(?:Sticker \||.*\bCapsule\b)/.test(name)) return 'capsules/stickers';
  if (/\bCase$/.test(name)) return 'cases';
  if (/^(?:(?:StatTrak™|Souvenir) )?(?:AK-47|AUG|AWP|CZ75-Auto|Desert Eagle|Dual Berettas|FAMAS|Five-SeveN|G3SG1|Galil AR|Glock-18|M249|M4A1-S|M4A4|MAC-10|MAG-7|MP5-SD|MP7|MP9|Negev|Nova|P2000|P250|P90|PP-Bizon|R8 Revolver|SCAR-20|SG 553|SSG 08|Sawed-Off|Tec-9|UMP-45|USP-S|XM1014|Zeus x27) \|/.test(name)) return 'weapons';
  return 'other/unknown';
}
export function analyzeDiscovery<T extends SourceRow>(rows: T[]) {
  const groups = new Map<string, T[]>();
  for (const row of rows) groups.set(row.market_hash_name, [...(groups.get(row.market_hash_name) ?? []), row]);
  const pairs = new Map<string, number>();
  for (const row of rows) {
    const key = JSON.stringify([row.market_hash_name, row.version ?? null]);
    pairs.set(key, (pairs.get(key) ?? 0) + 1);
  }
  const eligible: T[] = [];
  let excludedVersionedRows = 0;
  let excludedAmbiguousUnversionedRows = 0;
  const duplicates: { marketHashName: string; rowCount: number; excessDuplicateRows: number; reasons: string[]; rows: T[] }[] = [];
  for (const [name, group] of groups) {
    const unversioned = group.filter(row => row.version == null);
    excludedVersionedRows += group.length - unversioned.length;
    if (unversioned.length === 1) eligible.push(unversioned[0]);
    else excludedAmbiguousUnversionedRows += unversioned.length;
    if (group.length > 1) {
      const reasons = new Set<string>();
      for (const row of group) {
        if (row.version == null) reasons.add('unknown: unversioned row; no variant identity inferred');
        else if (/^Phase \d+$/.test(row.version)) reasons.add('phase: explicit source version');
        else if (/^(Ruby|Sapphire|Emerald|Black Pearl|Blue Gem|Tier [12]|FFI|Max Fake|\d+(?:st|nd|rd|th) Max)$/.test(row.version)) reasons.add('special: explicit source version label');
        else reasons.add('version: explicit source version label');
      }
      if (unversioned.length > 1) reasons.add('unknown: multiple unversioned rows are ambiguous and excluded');
      duplicates.push({ marketHashName: name, rowCount: group.length, excessDuplicateRows: group.length - 1, reasons: [...reasons], rows: group });
    }
  }
  duplicates.sort((a, b) => a.marketHashName.localeCompare(b.marketHashName));
  const eligibleByHeuristicCategory = Object.fromEntries(categories.map(category => [category, eligible.filter(row => heuristicCategory(row.market_hash_name) === category).length]));
  return { counts: { totalRows: rows.length, duplicateNameVersionGroups: [...pairs.values()].filter(count => count > 1).length, excessNameVersionRows: rows.length - pairs.size, uniqueMarketHashNames: groups.size, duplicateNameGroups: duplicates.length, excessDuplicateRows: rows.length - groups.size, excludedVersionedRows, excludedAmbiguousUnversionedRows, eligibleCandidates: eligible.length, eligibleByHeuristicCategory }, duplicates, eligible };
}
