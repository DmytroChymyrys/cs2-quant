import { z } from 'zod';
import Decimal from 'decimal.js';
import { isLosslessNumber, parse } from 'lossless-json';
// All JSON numeric tokens arrive as strings of exact decimal digits, never binary floats.
const decimalToken = z.custom<import('lossless-json').LosslessNumber>(isLosslessNumber);
export const price = decimalToken.transform(v => v.value).refine(v => {
  const n = new Decimal(v);
  return n.isFinite() && n.gte(0) && n.lt('1000000000000') && n.decimalPlaces() <= 8;
}, 'Price outside numeric(20,8)').transform(v => new Decimal(v).toFixed(8)).nullable();
const integerToken = decimalToken.refine(v => new Decimal(v.value).isInteger(), 'Expected integer');
const count = integerToken.transform(v => Number(v.value)).pipe(z.number().int().min(0).max(2147483647));
const epoch = integerToken.transform(v => Number(v.value)).pipe(z.number().int().min(0).max(8640000000000));
const identity = { market_hash_name: z.string().min(1), version: z.string().nullable().optional(), currency: z.literal('USD'), item_page: z.string().url(), market_page: z.string().url() };
export const itemSchema = z.object({ ...identity, suggested_price: price, min_price: price, max_price: price, mean_price: price, median_price: price, quantity: count, created_at: epoch, updated_at: epoch }).passthrough();
const periodSchema = z.object({ min: price, max: price, avg: price, median: price, volume: count }).passthrough();
export const historySchema = z.object({ ...identity, version: z.string().nullable().optional(), last_24_hours: periodSchema, last_7_days: periodSchema, last_30_days: periodSchema, last_90_days: periodSchema }).passthrough();
export const itemsSchema = z.array(itemSchema).min(1);
export const historiesSchema = z.array(historySchema).min(1);
export const parseSourceJson = (body: string): unknown => parse(body);
export type SkinportItem = z.infer<typeof itemSchema>;
export type SkinportHistory = z.infer<typeof historySchema>;
