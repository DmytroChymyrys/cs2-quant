import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import { analyzeDiscovery } from '../src/lib/sources/skinport/discovery';
import { skinportClient } from '../src/lib/sources/skinport/client';
try {
  const { data } = await skinportClient().items();
  const search = (process.argv[2] ?? '').toLowerCase();
  const candidates = analyzeDiscovery(data).eligible.filter(i => i.market_hash_name.toLowerCase().includes(search)).sort((a,b) => b.quantity-a.quantity);
  console.table(candidates.slice(0,100).map(i => ({ marketHashName: i.market_hash_name, quantity: i.quantity, minPrice: i.min_price })));
  await writeFile('config/candidates.json', JSON.stringify(candidates.map(i => ({ marketHashName: i.market_hash_name, category: null })), null, 2));
  console.info(`${candidates.length} candidates exported; manually approve a subset in config/tracked-assets.json.`);
} catch { console.error('Discovery failed; check connectivity and source configuration.'); process.exitCode = 1; }
