import { expect, it } from 'vitest';
import { validateUniverse } from '../src/lib/sources/skinport/validate-universe';
it('requires exactly one unversioned row in both sources and never substitutes variants', () => {
  const rows = [{ market_hash_name: 'A' }, { market_hash_name: 'A', version: 'Phase 1' }, { market_hash_name: 'B', version: 'Phase 2' }];
  expect(validateUniverse(['A'], rows, rows)[0]).toEqual({ marketHashName: 'A', itemsMatches: 1, historyMatches: 1, uniqueProposalName: true });
  expect(validateUniverse(['B'], rows, rows)[0].itemsMatches).toBe(0);
  expect(validateUniverse(['A'], [...rows, { market_hash_name: 'A', version: null }], [])[0]).toMatchObject({ itemsMatches: 2, historyMatches: 0 });
  expect(validateUniverse(['A', 'A'], rows, rows).every(row => !row.uniqueProposalName)).toBe(true);
});
