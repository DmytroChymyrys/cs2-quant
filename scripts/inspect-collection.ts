import 'dotenv/config';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { sql } from 'drizzle-orm';
import { database } from '../src/lib/db';

try {
  const db = database();
  // Static, checked-in SQL only; command-line input never enters raw SQL.
  const queries = (await readFile('sql/inspect-collection.sql', 'utf8'))
    .split(';').map(query => query.trim()).filter(Boolean);
  const [runs, observations] = await Promise.all(queries.map(query => db.execute(sql.raw(query))));
  const report = {
    inspectedAt: new Date().toISOString(),
    collectorRuns: runs.rows,
    assetObservationCounts: observations.rows,
  };
  await mkdir('reports', { recursive: true });
  await writeFile(process.argv[2] ?? 'reports/collection-inspection.json', `${JSON.stringify(report, null, 2)}\n`);
  console.info(JSON.stringify(report, null, 2));
} catch {
  console.error('Collection inspection failed; check database configuration, connectivity and migrations.');
  process.exitCode = 1;
}
