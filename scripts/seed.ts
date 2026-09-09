import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { database } from '../src/lib/db';
import { assets, mappings } from '../src/lib/db/schema';
import { skinportClient } from '../src/lib/sources/skinport/client';
import { validateUniverse } from '../src/lib/sources/skinport/validate-universe';
try {
  const promote = process.argv.includes('--promote-poc');
  const configPath = promote ? 'config/poc-100-proposed.json' : 'config/tracked-assets.json';
  const configText = await readFile(configPath, 'utf8');
  const approved = z.array(z.object({ marketHashName: z.string().min(1), category: z.string().nullable().optional() })).max(200).parse(JSON.parse(configText));
  if (!approved.length) throw new Error('EMPTY_APPROVAL_LIST');
  if (new Set(approved.map(a => a.marketHashName)).size !== approved.length) throw new Error('DUPLICATE_APPROVAL');
  if (promote && approved.length !== 100) throw new Error('EXPECTED_EXACTLY_100');
  const client = skinportClient();
  const [items, history] = await Promise.all([client.items(), client.history()]);
  const validation = validateUniverse(approved.map(a => a.marketHashName), items.data, history.data);
  const failures = validation.filter(a => a.itemsMatches !== 1 || a.historyMatches !== 1 || !a.uniqueProposalName);
  const report = { validatedAt: new Date().toISOString(), assets: validation, failures,
    items: { ...items, data: undefined }, history: { ...history, data: undefined } };
  await writeFile('reports/poc-100-preseed-validation.json', JSON.stringify(report, null, 2) + '\n');
  if (failures.length) { console.error(JSON.stringify({ identityFailures: failures })); throw new Error('IDENTITY_VALIDATION_FAILED'); }
  if (promote) await writeFile('config/tracked-assets.json', configText);
  const db = database();
  // Approved list is authoritative; catalog rows and historical UUIDs survive untracking.
  await db.batch([
    db.update(assets).set({ isTracked: false, updatedAt: new Date() }),
    db.insert(assets).values(approved.map(a => ({ ...a, isTracked: true }))).onConflictDoUpdate({ target: assets.marketHashName, set: { isTracked: true, category: sql`excluded.category`, updatedAt: new Date() } }),
    db.insert(mappings).select(db.select({ id: sql<string>`gen_random_uuid()`.as('id'), assetId: assets.id, source: sql<string>`'SKINPORT'`.as('source'), sourceItemId: assets.marketHashName, sourceMarketHashName: assets.marketHashName, createdAt: sql<Date>`now()`.as('created_at'), updatedAt: sql<Date>`now()`.as('updated_at') }).from(assets)).onConflictDoNothing(),
  ]);
  const actual = await db.select({ marketHashName: assets.marketHashName }).from(assets).where(sql`${assets.isTracked}=true`);
  if (actual.length !== approved.length || actual.some(a => !approved.some(p => p.marketHashName === a.marketHashName))) throw new Error('POST_SEED_TRACKING_MISMATCH');
  await writeFile('reports/poc-100-seed-result.json', JSON.stringify({ seededAt: new Date().toISOString(), tracked: actual.length, assets: actual }, null, 2) + '\n');
  console.info(`cs2-quant: ${approved.length} approved assets tracked.`);
} catch { console.error('Seed failed; verify approved list (1–200 unique real names), source availability and database configuration.'); process.exitCode = 1; }
