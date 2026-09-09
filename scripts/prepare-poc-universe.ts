import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import Decimal from 'decimal.js';
import { z } from 'zod';
import { itemsSchema, historiesSchema, parseSourceJson } from '../src/lib/sources/skinport/schemas';
import { analyzeDiscovery, heuristicCategory } from '../src/lib/sources/skinport/discovery';

// Offline validation/reporting of an explicit proposal; this script never writes to a database.
const categories = ['cases', 'capsules/stickers', 'weapons', 'knives', 'gloves'] as const;
type Category = typeof categories[number];
const target: Record<Category, number> = { cases: 20, 'capsules/stickers': 20, weapons: 30, knives: 15, gloves: 15 };
const activityBounds: Record<Category, [number, number]> = { cases: [50, 500], 'capsules/stickers': [5, 50], weapons: [5, 50], knives: [5, 20], gloves: [5, 30] };
const priceBounds: Record<Category, [number, number]> = { cases: [2, 15], 'capsules/stickers': [1, 100], weapons: [5, 100], knives: [100, 500], gloves: [100, 500] };
const [itemsPath, historyPath] = process.argv.slice(2);
if (!itemsPath || !historyPath) throw new Error('Usage: node --import tsx scripts/prepare-poc-universe.ts <items.json> <history.json>');
const [itemText, historyText, proposedText, trackedText, provenanceText] = await Promise.all([
  readFile(itemsPath, 'utf8'), readFile(historyPath, 'utf8'), readFile('config/poc-100-proposed.json', 'utf8'),
  readFile('config/tracked-assets.json', 'utf8'), readFile('reports/poc-100-snapshot-provenance.json', 'utf8'),
]);
const items = itemsSchema.parse(parseSourceJson(itemText));
const history = historiesSchema.parse(parseSourceJson(historyText));
const proposed = z.array(z.object({ marketHashName: z.string().min(1), category: z.enum(categories), reason: z.string().min(20) })).length(100).parse(JSON.parse(proposedText));
const tracked = z.array(z.object({ marketHashName: z.string() })).parse(JSON.parse(trackedText));
const provenance = JSON.parse(provenanceText) as {endpoint:string;url:string;status:number;startedAt:string;finishedAt:string;sha256:string}[];
for (const [endpoint, body] of [['items',itemText],['sales/history',historyText]]) {
  if (provenance.find(p => p.endpoint === endpoint)?.sha256 !== createHash('sha256').update(body).digest('hex')) throw new Error('SNAPSHOT_PROVENANCE_HASH_MISMATCH');
}
const itemDiscovery = analyzeDiscovery(items), historyDiscovery = analyzeDiscovery(history);
const group = <T extends { market_hash_name: string; version?: string | null }>(rows: T[]) => {
  const result = new Map<string,T[]>();
  for (const row of rows) if (row.version == null) result.set(row.market_hash_name,[...(result.get(row.market_hash_name) ?? []),row]);
  return result;
};
const itemGroups = group(items), historyGroups = group(history);
const failures: {marketHashName:string;reason:string}[] = [];
const seen = new Set<string>();
const assets = proposed.flatMap(proposal => {
  const { marketHashName: name, category } = proposal;
  if (seen.has(name)) { failures.push({marketHashName:name,reason:'Repeated proposal name'}); return []; }
  seen.add(name);
  const matchedItems = itemGroups.get(name) ?? [], matchedHistory = historyGroups.get(name) ?? [];
  if (matchedItems.length !== 1) { failures.push({marketHashName:name,reason:`Expected one unversioned Items row; found ${matchedItems.length}`}); return []; }
  if (matchedHistory.length !== 1) { failures.push({marketHashName:name,reason:`Expected one unversioned History row; found ${matchedHistory.length}`}); return []; }
  if (heuristicCategory(name) !== category) failures.push({marketHashName:name,reason:'Assigned category differs from conservative name classification'});
  const item = matchedItems[0], sales = matchedHistory[0];
  const [low,high] = activityBounds[category];
  const volume = sales.last_7_days.volume;
  const liquidity = volume < low ? 'low' : volume < high ? 'medium' : 'high';
  const [cheap,expensive] = priceBounds[category];
  const priceBand = item.min_price === null ? 'no price' : new Decimal(item.min_price).lt(cheap) ? 'cheap' : new Decimal(item.min_price).lt(expensive) ? 'mid-priced' : 'expensive';
  return [{ ...proposal, minPrice: item.min_price, medianPrice: item.median_price, quantity: item.quantity, sales24hVolume: sales.last_24_hours.volume, sales7dVolume: volume,
    liquidity, priceBand, retainedSmokeAsset: tracked.some(a => a.marketHashName === name), itemsMatches: matchedItems.length, historyMatches: matchedHistory.length,
    sourceItem: item, sourceHistory: sales }];
});
const frequencies = (values: string[]) => Object.fromEntries([...new Set(values)].sort().map(value => [value, values.filter(v => v === value).length]));
const numericRange = (values: number[]) => ({ min: Math.min(...values), max: Math.max(...values) });
const decimalRange = (values: (string|null)[]) => {
  const sorted = values.filter((v): v is string => v !== null).sort((a,b) => new Decimal(a).cmp(b));
  return { min: sorted[0] ?? null, max: sorted.at(-1) ?? null };
};
const distributions = categories.map(category => {
  const rows = assets.filter(a => a.category === category);
  if (rows.length !== target[category]) failures.push({marketHashName:category,reason:`Expected ${target[category]} assets; found ${rows.length}`});
  if (!['low','medium','high'].every(band => rows.some(a => a.liquidity === band))) failures.push({marketHashName:category,reason:'Missing an activity band'});
  if (!['cheap','mid-priced','expensive'].every(band => rows.some(a => a.priceBand === band))) failures.push({marketHashName:category,reason:'Missing a price band'});
  return {category,count:rows.length,minPriceRange:decimalRange(rows.map(a=>a.minPrice)),medianPriceRange:decimalRange(rows.map(a=>a.medianPrice)),listingQuantityRange:numericRange(rows.map(a=>a.quantity)),sales24hRange:numericRange(rows.map(a=>a.sales24hVolume)),sales7dRange:numericRange(rows.map(a=>a.sales7dVolume)),liquidity:frequencies(rows.map(a=>a.liquidity)),priceBands:frequencies(rows.map(a=>a.priceBand))};
});
for (const asset of tracked) if (!seen.has(asset.marketHashName)) failures.push({marketHashName:asset.marketHashName,reason:'Current smoke asset not retained'});
const previousDiscovery = JSON.parse(await readFile('reports/discovery-details.json', 'utf8')) as { provenance: { history: { sha256: string } } };
const unchangedHistory = provenance.find(p=>p.endpoint==='sales/history')?.sha256 === previousDiscovery.provenance.history.sha256;
const report = {
  generatedAt:new Date().toISOString(),status:failures.length ? 'VALIDATION_FAILED' : 'VALIDATED_PROPOSAL_NOT_SEEDED',
  provenance, unchangedHistorySinceEarlierDiscovery: unchangedHistory, sourceUniverse:{items:itemDiscovery.counts,history:historyDiscovery.counts},
  validation:{proposed:proposed.length,uniqueProposedNames:seen.size,uniqueUnversionedItems:assets.length,uniqueUnversionedHistory:assets.length,retainedSmokeAssets:assets.filter(a=>a.retainedSmokeAsset).length,failures},
  definitions:{liquidity:'Descriptive proxy based only on source 7d sales volume. Category-specific thresholds below; no liquidity score or investment recommendation.',activityBounds,priceBounds},
  distributions, overall:{minPriceRange:decimalRange(assets.map(a=>a.minPrice)),listingQuantityRange:numericRange(assets.map(a=>a.quantity)),sales24hRange:numericRange(assets.map(a=>a.sales24hVolume)),liquidity:frequencies(assets.map(a=>a.liquidity)),
    zeroListings:assets.filter(a=>a.quantity===0).length,nullMinPrices:assets.filter(a=>a.minPrice===null).length,zeroSales24h:assets.filter(a=>a.sales24hVolume===0).length,zeroSales7d:assets.filter(a=>a.sales7dVolume===0).length,
    null24hPriceStatistics:assets.filter(a=>Object.values(a.sourceHistory.last_24_hours).some(v=>v===null)).length,
    quantityBands:frequencies(assets.map(a=>a.quantity===0?'0':a.quantity<=5?'1–5':a.quantity<=25?'6–25':a.quantity<=100?'26–100':a.quantity<=1000?'101–1,000':a.quantity<=10000?'1,001–10,000':'>10,000')),
    volume24hBands:frequencies(assets.map(a=>a.sales24hVolume===0?'0':a.sales24hVolume<=4?'1–4':a.sales24hVolume<=19?'5–19':a.sales24hVolume<=99?'20–99':'>=100')),
    absolutePriceBands:frequencies(assets.map(a=>a.minPrice===null?'null':new Decimal(a.minPrice).lt(1)?'< $1':new Decimal(a.minPrice).lt(10)?'$1–<10':new Decimal(a.minPrice).lt(100)?'$10–<100':new Decimal(a.minPrice).lt(1000)?'$100–<1,000':'>= $1,000'))},
  assets,
};
await writeFile('reports/poc-100-assets.json',JSON.stringify(report,null,2)+'\n');
const money = (v: string|null) => v === null ? 'null' : new Decimal(v).toFixed(Math.max(2, new Decimal(v).decimalPlaces()));
const range = (r:{min:number;max:number}) => `${r.min.toLocaleString('en-US')}–${r.max.toLocaleString('en-US')}`;
const escape = (v:string) => v.replaceAll('|','\\|');
const lines = [
  '# cs2-quant — proposed 100-asset POC universe', '',
  `Generated ${report.generatedAt}. **${report.status}**. Exactly 100 individually selected names; no database writes or tracking changes are performed by this report. Current tracked universe remains the five approved smoke assets.`, '',
  '## Selection and identity rules', '',
  'Selection is deliberately stratified by observed sales activity, listing supply, price, wear and item family. It is not random and is not an investable or market-representative portfolio. Rare singleton listings and zero-sales periods are intentional stress cases. All five smoke assets are retained. Prices below are USD from one fresh Items response; sales volumes are source aggregates from one fresh History response.', '',
  'Only names resolving to exactly one null/absent-version row in each endpoint are eligible. Named versions are excluded even if their market_hash_name matches an eligible unversioned row. No arbitrary duplicate winner or variant aggregation is used. StatTrak/Souvenir prefixes, wear, Fade and Crimson Web may form part of a real market_hash_name; they are not permission to ingest a non-null source version.', '',
  `The full snapshots still contain duplicate market_hash_name groups (Items ${itemDiscovery.counts.duplicateNameGroups}, History ${historyDiscovery.counts.duplicateNameGroups}). Observed duplicate (market_hash_name, version) groups: Items ${itemDiscovery.counts.duplicateNameVersionGroups}, History ${historyDiscovery.counts.duplicateNameVersionGroups}. This retains the earlier finding: the full market needs variant-aware identity, while zero composite collisions in these snapshots do not guarantee a durable key. The proposed subset has one canonical unversioned row per asset.`, '',
  '## Activity and price labels', '',
  'Low/medium/high liquidity below means a **descriptive seven-day sales-activity proxy**, not an execution guarantee, derived score or valuation. Thresholds differ by category because knife/glove turnover is lower than case turnover. Listing quantity is reported independently; large supply does not imply sales liquidity. Cheap/mid/expensive is likewise relative to category.', '',
  '| Category | Low activity (7d) | Medium activity (7d) | High activity (7d) | Cheap min price | Mid price | Expensive |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  ...categories.map(c=>`| ${c} | <${activityBounds[c][0]} | ${activityBounds[c][0]}–${activityBounds[c][1]-1} | >=${activityBounds[c][1]} | <$${priceBounds[c][0]} | $${priceBounds[c][0]}–<$${priceBounds[c][1]} | >=$${priceBounds[c][1]} |`), '',
  '## Distribution', '',
  '| Category | Assets | Min-price range (USD) | Median-price range (USD) | Listing quantity range | 24h volume range | 7d volume range | Low / medium / high activity | Cheap / mid / expensive |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ...distributions.map(d=>`| ${d.category} | ${d.count} | ${money(d.minPriceRange.min)}–${money(d.minPriceRange.max)} | ${money(d.medianPriceRange.min)}–${money(d.medianPriceRange.max)} | ${range(d.listingQuantityRange)} | ${range(d.sales24hRange)} | ${range(d.sales7dRange)} | ${d.liquidity.low??0} / ${d.liquidity.medium??0} / ${d.liquidity.high??0} | ${d.priceBands.cheap??0} / ${d.priceBands['mid-priced']??0} / ${d.priceBands.expensive??0} |`), '',
  `Overall activity: ${JSON.stringify(report.overall.liquidity)}.`, '',
  `Absolute min-price bins: ${JSON.stringify(report.overall.absolutePriceBands)}.`, '',
  `Listing-quantity bins: ${JSON.stringify(report.overall.quantityBands)}.`, '',
  `24h sales-volume bins: ${JSON.stringify(report.overall.volume24hBands)}.`, '',
  `Edge coverage: ${report.overall.zeroSales24h} assets with zero 24h sales; ${report.overall.zeroSales7d} with zero 7d sales; ${report.overall.null24hPriceStatistics} with at least one null 24h price statistic. ${report.overall.zeroListings} zero-listing assets and ${report.overall.nullMinPrices} null-min-price assets were selected. ${itemDiscovery.eligible.filter(a=>a.quantity===0).length} zero-listing canonical candidates exist in this tradable Items snapshot; no missing name/state was invented.`, '',
  '## Proposed assets', '',
  'Each row passed the unique-unversioned Items and History checks. “Retained” identifies the existing approved smoke assets. Full eight-decimal monetary strings and matched source fields are in [poc-100-assets.json](poc-100-assets.json).', '',
];
for (const category of categories) {
  lines.push(`### ${category}`, '', '| market_hash_name | Category | Min USD | Median USD | Quantity | 24h sales | 7d sales | Activity | Selection reason |', '| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |');
  for (const a of assets.filter(a=>a.category===category)) lines.push(`| ${escape(a.marketHashName)} | ${category} | ${money(a.minPrice)} | ${money(a.medianPrice)} | ${a.quantity} | ${a.sales24hVolume} | ${a.sales7dVolume} | ${a.liquidity} | ${a.retainedSmokeAsset?'**Retained.** ':''}${escape(a.reason)} |`);
  lines.push('');
}
lines.push('## Validation results', '', `- Proposed: ${proposed.length}; distinct names: ${seen.size}.`, `- Exactly one unversioned Items row: ${assets.length}/100.`, `- Exactly one unversioned History row: ${assets.length}/100.`, `- Current smoke assets retained: ${report.validation.retainedSmokeAssets}/5.`, `- Candidate failures: ${failures.length}.`, ...(failures.length ? failures.map(f=>`- ${f.marketHashName}: ${f.reason}`) : ['- No proposed candidate failed identity, history, category-count, activity-band or price-band checks.']), '',
  '## Snapshot provenance and limits', '',
  ...provenance.map(p=>`- ${p.endpoint}: HTTP ${p.status}; ${p.startedAt} → ${p.finishedAt}; ${p.url}; SHA-256 ${p.sha256}.`), '',
  `History body unchanged since earlier discovery: ${unchangedHistory}. A matching hash proves unchanged returned aggregates, not whether every underlying sale was freshly processed; History exposes no per-row update timestamp. Requests are near-synchronous, not an atomic cross-endpoint snapshot. Quantities, prices and eligibility can change after report generation; rerun live name validation at seeding time.`, '',
  'The explicit proposal is [config/poc-100-proposed.json](../config/poc-100-proposed.json). The approved seed input remains [config/tracked-assets.json](../config/tracked-assets.json) with five names. No automatic promotion, seeding, collection, schedule change or commit was performed.');
await writeFile('reports/poc-100-assets.md',lines.join('\n')+'\n');
console.info(JSON.stringify({validation:report.validation,distributions,overall:report.overall},null,2));
if (failures.length) process.exitCode = 1;
