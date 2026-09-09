import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { databaseUrl } from '../config';
import * as schema from './schema';
export function database() { return drizzle(neon(databaseUrl()), { schema }); }
