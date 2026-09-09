import 'dotenv/config';
import { migrate } from 'drizzle-orm/neon-http/migrator';
import { database } from '../src/lib/db';
try { await migrate(database(), { migrationsFolder: './drizzle' }); console.info('cs2-quant migrations complete'); }
catch { console.error('Migration failed; check database connectivity and migration state.'); process.exitCode = 1; }
