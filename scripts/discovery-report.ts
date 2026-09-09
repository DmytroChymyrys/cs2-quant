import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { stringify } from 'lossless-json';
import { analyzeDiscovery } from '../src/lib/sources/skinport/discovery';
import { itemsSchema, historiesSchema, parseSourceJson } from '../src/lib/sources/skinport/schemas';

const [itemsPath, historyPath, output = 'reports'] = process.argv.slice(2);
if (!itemsPath || !historyPath) throw new Error('Usage: tsx scripts/discovery-report.ts <items.json> <history.json> [output-directory]');
async function snapshot(path: string) {
  const body = await readFile(path, 'utf8');
  const info = await stat(path);
  return { body, provenance: { path: resolve(path), fileModifiedAt: info.mtime.toISOString(), bytes: info.size, sha256: createHash('sha256').update(body).digest('hex'), origin: 'Existing local Skinport snapshot supplied from earlier session fetch; file mtime is not a verified API fetch timestamp. No request made by this report.' } };
}
const [items, history] = await Promise.all([snapshot(itemsPath), snapshot(historyPath)]);
// Validate using production schemas but report untouched lossless payloads, retaining original fields and numeric tokens.
const rawItems = parseSourceJson(items.body);
const rawHistory = parseSourceJson(history.body);
itemsSchema.parse(rawItems);
historiesSchema.parse(rawHistory);
type Row = { market_hash_name: string; version?: string | null };
const itemReport = analyzeDiscovery(rawItems as Row[]);
const historyReport = analyzeDiscovery(rawHistory as Row[]);
const historyNames = new Set(historyReport.eligible.map(row => row.market_hash_name));
const report = {
  generatedAt: new Date().toISOString(),
  policy: 'Exclude every non-null version row. Exclude all unversioned rows when their name has multiple unversioned rows in that endpoint. A single unversioned row may coexist with excluded versioned rows. No assets are approved or tracked by this report.',
  provenance: { items: items.provenance, history: history.provenance },
  items: { counts: itemReport.counts, duplicates: itemReport.duplicates },
  history: { counts: historyReport.counts, duplicates: historyReport.duplicates },
  eligibleItemNamesWithEligibleHistory: itemReport.eligible.filter(row => historyNames.has(row.market_hash_name)).length,
};
await mkdir(output, { recursive: true });
await writeFile(`${output}/discovery-details.json`, stringify(report, undefined, 2)! + '\n');
const metrics = ['totalRows', 'uniqueMarketHashNames', 'duplicateNameGroups', 'excessDuplicateRows', 'duplicateNameVersionGroups', 'excessNameVersionRows', 'excludedVersionedRows', 'excludedAmbiguousUnversionedRows', 'eligibleCandidates'] as const;
const examples = [
  { endpoint: 'items', group: itemReport.duplicates.find(group => group.rows.some(row => row.version === 'Phase 1'))! },
  { endpoint: 'items', group: itemReport.duplicates.find(group => group.rows.some(row => row.version === 'Emerald'))! },
  { endpoint: 'history', group: historyReport.duplicates.find(group => group.rows.some(row => row.version === 'Blue Gem'))! },
].map(({ endpoint, group }) => `### ${endpoint}: ${group.marketHashName}\n\nReasons: ${group.reasons.join('; ')}.\n\n\`\`\`json\n${stringify(group.rows.map(row => {
  const fields = row as Row & Record<string, unknown>;
  return Object.fromEntries(['version', 'item_page', 'market_page', ...(endpoint === 'items' ? ['min_price', 'quantity'] : ['last_24_hours'])].filter(key => key in fields).map(key => [key, fields[key]]));
}), undefined, 2)}\n\`\`\`\n`).join('\n');
const summary = `# Skinport discovery report\n\nGenerated: ${report.generatedAt}\n\n${report.policy}\n\n| Metric | Items | Sales history |\n| --- | ---: | ---: |\n${metrics.map(key => `| ${key} | ${itemReport.counts[key]} | ${historyReport.counts[key]} |`).join('\n')}\n\nDuplicate name groups count names occurring more than once; excess duplicate rows sum (group size − 1). Exclusions count rows, not names.\n\n## Eligible rows by name heuristic\n\n| Category | Items | Sales history |\n| --- | ---: | ---: |\n${Object.entries(itemReport.counts.eligibleByHeuristicCategory).map(([key, count]) => `| ${key} | ${count} | ${historyReport.counts.eligibleByHeuristicCategory[key]} |`).join('\n')}\n\nCategories are local name heuristics, not source taxonomy: star-prefixed gloves/hand wraps, remaining star-prefixed knives, sticker prefix or Capsule word, Case suffix, known firearm prefixes, then other/unknown. They do not establish identity.\n\n## Identity conclusion\n\nmarket_hash_name alone is not unique in either complete endpoint snapshot. Explicit version labels explain many variants; phase and special labels in this report come only from the source version field. Repeated URLs or a version label do not establish a globally unique variant key. Observed duplicate (market_hash_name, version) groups and excess rows are counted separately above, treating missing and null version alike. Even zero observed collisions does not establish (market_hash_name, version) as a guaranteed identity.\n\nThe unversioned, unambiguous subset is eligible for manual review under the current policy; snapshot uniqueness does not guarantee future uniqueness. ${report.eligibleItemNamesWithEligibleHistory} eligible item names have eligible history rows. Discovery and seed exclude ambiguous unversioned names. The collector retains its stricter fail-visible duplicate guard after version filtering. No approved asset list was changed.\n\n## Representative duplicate groups\n\n${examples}\n## Provenance and complete duplicate details\n\nThis report reads saved files and makes no network requests. Source URL/request parameters and exact acquisition times are not independently recorded in the files; file modification times below are filesystem evidence only. Production schemas validated both payloads.\n\n${Object.entries(report.provenance).map(([key, value]) => `- ${key}: ${value.path}; modified ${value.fileModifiedAt}; ${value.bytes} bytes; SHA-256 ${value.sha256}`).join('\n')}\n\n[Complete duplicate details](discovery-details.json) includes every duplicate name group for both endpoints, all original source fields for every member row, and reason labels. Numeric tokens are preserved losslessly.\n`;
await writeFile(`${output}/discovery-summary.md`, summary);
console.info(summary);
