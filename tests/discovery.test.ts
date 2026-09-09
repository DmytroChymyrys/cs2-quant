import { describe, expect, it } from 'vitest';
import { analyzeDiscovery, heuristicCategory } from '../src/lib/sources/skinport/discovery';
describe('discovery eligibility and accounting', () => {
  it('distinguishes duplicate groups from excess rows and excludes ambiguity', () => {
    const result = analyzeDiscovery([
      { market_hash_name: 'A', version: null }, { market_hash_name: 'A' }, { market_hash_name: 'A', version: 'Phase 1' },
      { market_hash_name: 'B', version: null }, { market_hash_name: 'B', version: 'Ruby' },
      { market_hash_name: 'C' }, { market_hash_name: 'D', version: '' },
    ]);
    expect(result.counts).toMatchObject({ totalRows: 7, duplicateNameVersionGroups: 1, excessNameVersionRows: 1, uniqueMarketHashNames: 4, duplicateNameGroups: 2, excessDuplicateRows: 3, excludedVersionedRows: 3, excludedAmbiguousUnversionedRows: 2, eligibleCandidates: 2 });
    expect(result.eligible.map(row => row.market_hash_name)).toEqual(['B', 'C']);
    expect(result.duplicates[0].rows).toHaveLength(3);
    expect(result.duplicates[0].reasons).toContain('unknown: multiple unversioned rows are ambiguous and excluded');
  });
  it('uses conservative name categories including unknown', () => {
    for (const [name, expected] of [['★ Sport Gloves | Vice', 'gloves'], ['★ Hand Wraps | Leather', 'gloves'], ['★ Bayonet', 'knives'], ['Dreams & Nightmares Case', 'cases'], ['Sticker | Test', 'capsules/stickers'], ['Test Capsule', 'capsules/stickers'], ['StatTrak™ AK-47 | Redline', 'weapons'], ['Case Key', 'other/unknown']]) expect(heuristicCategory(name)).toBe(expected);
  });
});
