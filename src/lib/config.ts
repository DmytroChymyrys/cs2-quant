import { z } from 'zod';
export const WINDOW_MS = 5 * 60 * 1000;
export function sourceConfig() {
  return z.object({
    SKINPORT_CURRENCY: z.literal('USD').default('USD'),
    SKINPORT_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(20000),
    SOURCE_STALE_AFTER_MINUTES: z.coerce.number().positive().max(1440).default(15),
  }).parse(process.env);
}
export function databaseUrl() {
  const value = process.env.DATABASE_URL;
  if (!value || !/^postgres(ql)?:\/\//.test(value)) throw new Error('DATABASE_CONFIGURATION');
  return value;
}
