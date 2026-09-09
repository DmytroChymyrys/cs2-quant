import { afterEach, describe, expect, it, vi } from 'vitest';
import { authorized } from '../src/lib/auth';
import { skinportClient } from '../src/lib/sources/skinport/client';
import { itemSchema, historySchema, parseSourceJson } from '../src/lib/sources/skinport/schemas';
import { normalize } from '../src/lib/sources/skinport/normalize';
import { collectSkinport } from '../src/lib/collectors/skinport-collector';
import type { CollectorStore, Run, Observation } from '../src/lib/db/collector-store';
import { isStale, percentageChange, successRate } from '../src/lib/analytics';
import { item, history, name } from './fixtures';
const parsedItem = (value = item) => itemSchema.parse(parseSourceJson(JSON.stringify(value)));
const parsedHistory = () => historySchema.parse(parseSourceJson(JSON.stringify(history)));
function memory() {
  const runs = new Map<string, Run>(), rows: Observation[] = [];
  const store: CollectorStore = {
    claim: async run => { if ([...runs.values()].some(r => r.claimKey === run.claimKey)) return false; runs.set(run.id!, run); return true; },
    audit: async run => { runs.set(run.id!, run); },
    read: async id => runs.get(id),
    completeTiming: async (id, timing) => { const run = runs.get(id)!; if (!run.finishedAt && run.status !== 'RUNNING') runs.set(id, { ...run, ...timing }); },
    tracked: async () => [{ id: 'f7c99c1f-ec47-42db-aa08-6f362c728623', marketHashName: name }],
    finish: async (id, values, batch) => { if (runs.get(id)?.status && runs.get(id)?.status !== 'RUNNING') return; rows.push(...batch); runs.set(id, { ...runs.get(id)!, ...values }); },
  };
  return { store, runs, rows };
}
function mockClient(items: unknown = [item], histories: unknown = [history], status = 200) {
  const fetcher = vi.fn<typeof fetch>(async url => new Response(JSON.stringify(String(url).includes('sales/history') ? histories : items), { status }));
  return { client: skinportClient(fetcher), fetcher };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); });
describe('authentication', () => {
  it.each([['Bearer secret', true], [null, false], ['Bearer wrong', false], ['secret', false], ['Bearer  secret', false], ['Basic secret', false], ['Bearer sec ret', false]])('%s -> %s', (header, expected) => {
    expect(authorized(new Request('http://localhost', { headers: header ? { authorization: header } : {} }), 'secret')).toBe(expected);
  });
  it('fails closed without a configured secret', () => expect(authorized(new Request('http://localhost'), '')).toBe(false));
});
describe('source schema and normalization', () => {
  it('validates both payloads', () => { expect(parsedItem().quantity).toBe(25); expect(parsedHistory().last_24_hours.volume).toBe(100); });
  it('rejects schema drift and other currencies', () => {
    expect(() => parsedItem({ ...item, quantity: '25' } as unknown as typeof item)).toThrow();
    expect(() => parsedItem({ ...item, currency: 'EUR' })).toThrow();
    expect(() => historySchema.parse(parseSourceJson(JSON.stringify({ ...history, last_24_hours: {} })))).toThrow();
  });
  it('preserves source timestamps and precise decimals', () => {
    const row = normalize('asset', 'run', new Date(0), parsedItem(), parsedHistory());
    expect(row.minPrice).toBe('11.33000000'); expect(row.suggestedPrice).toBe('13.18000000');
    expect(row.sourceUpdatedAt).toEqual(new Date(1568073728000)); expect(row.observedAt).toEqual(new Date(0));
    const exact = itemSchema.parse(parseSourceJson(JSON.stringify(item).replace('13.18', '999999999999.12345678')));
    expect(exact.suggested_price).toBe('999999999999.12345678');
    expect(() => itemSchema.parse(parseSourceJson(JSON.stringify(item).replace('13.18','13.123456789')))).toThrow();
  });
  it('handles legitimate nullable prices and no listings', () => {
    const value = { ...item, min_price: null, max_price: null, mean_price: null, median_price: null, quantity: 0 };
    const row = normalize('asset','run',new Date(), parsedItem(value as unknown as typeof item));
    expect(row.minPrice).toBeNull(); expect(row.quantity).toBe(0); expect(row.rawHistoryPayload).toBeNull();
  });
});
describe('collector', () => {
  it('matches both sources by name, counts rows and issues only two market-wide requests', async () => {
    const { store, rows } = memory(), { client, fetcher } = mockClient();
    const result = await collectSkinport(store, client);
    expect(result.status).toBe('SUCCESS'); expect(rows).toHaveLength(1); expect(rows[0].sales24hVolume).toBe(100);
    expect(result).toMatchObject({ observationsInserted: 1, itemsMatched: 1 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [url, options] of fetcher.mock.calls) {
      expect(String(url)).toContain('app_id=730'); expect(String(url)).toContain('currency=USD'); expect(String(url)).not.toContain('market_hash_name');
      expect(options?.headers).toEqual({ 'Accept-Encoding': 'br' });
    }
  });
  it('missing expected item is PARTIAL', async () => {
    const { store, rows } = memory();
    const result = await collectSkinport(store, mockClient([{ ...item, market_hash_name: 'Glove Case' }]).client);
    expect(result).toMatchObject({ status: 'PARTIAL', itemsMissing: 1, observationsInserted: 0 }); expect(rows).toHaveLength(0);
  });
  it('missing history is PARTIAL but preserves marketplace observation', async () => {
    const { store, rows } = memory();
    expect(await collectSkinport(store, mockClient([item], [{ ...history, market_hash_name: 'Glove Case' }]).client)).toMatchObject({ status: 'PARTIAL' });
    expect(rows[0].rawHistoryPayload).toBeNull();
  });
  it('excludes named variants from both sources instead of mixing prices', async () => {
    const { store, rows, runs } = memory();
    const client = mockClient([item, { ...item, version: 'Ruby', min_price: 2000 }], [history, { ...history, version: 'Ruby' }]).client;
    expect(await collectSkinport(store,client)).toMatchObject({ status: 'SUCCESS' });
    expect(rows[0].minPrice).toBe('11.33000000');
    expect([...runs.values()][0].metadata).toMatchObject({ excludedVariantItemRows: 1, excludedVariantHistoryRows: 1 });
  });
  it('zero listings and null prices still SUCCESS', async () => {
    expect(await collectSkinport(memory().store, mockClient([{ ...item, quantity: 0, min_price: null }]).client)).toMatchObject({ status: 'SUCCESS' });
  });
  it.each([500, 429, 403])('HTTP %i recorded without retry', async status => {
    const { store, rows } = memory(), { client, fetcher } = mockClient([item],[history],status);
    expect(await collectSkinport(store, client)).toMatchObject({ status: 'FAILED', itemsHttpStatus: status, historyHttpStatus: status, errorCode: status === 429 ? 'RATE_LIMITED' : 'HTTP_ERROR' });
    expect(rows).toHaveLength(0); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('network failure is FAILED without leaking exception text', async () => {
    const client = skinportClient(async () => { throw new Error('sensitive upstream detail'); });
    const result = await collectSkinport(memory().store, client);
    expect(result).toMatchObject({ status: 'FAILED', errorCode: 'NETWORK_ERROR' }); expect(JSON.stringify(result)).not.toContain('sensitive');
  });
  it('aborts an upstream request at the configured timeout', async () => {
    vi.useFakeTimers(); vi.stubEnv('SKINPORT_REQUEST_TIMEOUT_MS','1000');
    const client = skinportClient((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const result = collectSkinport(memory().store,client);
    await vi.advanceTimersByTimeAsync(1001);
    expect(await result).toMatchObject({ status: 'FAILED', errorCode: 'TIMEOUT' });
  });
  it.each(['{broken', '[{"quantity":"wrong"}]'])('malformed JSON/schema is FAILED', async body => {
    const result = await collectSkinport(memory().store, skinportClient(async () => new Response(body)));
    expect(result.status).toBe('FAILED'); expect(['MALFORMED_JSON','INVALID_SCHEMA']).toContain('errorCode' in result && result.errorCode);
  });
  it('duplicate source identities fail visibly', async () => {
    expect(await collectSkinport(memory().store, mockClient([item,item]).client)).toMatchObject({ status: 'FAILED', errorCode: 'DUPLICATE_SOURCE_NAME' });
  });
  it('empty configured universe does not report SUCCESS', async () => {
    const { store } = memory(); store.tracked = async () => [];
    expect(await collectSkinport(store, mockClient().client)).toMatchObject({ status: 'PARTIAL', errorCode: 'NO_TRACKED_ASSETS' });
  });
  it('appends unchanged later snapshots, skips overlapping windows, audits every attempt', async () => {
    const { store, rows, runs } = memory(), { client, fetcher } = mockClient();
    const time = () => new Date('2026-09-09T09:00:00Z');
    const results = await Promise.all([collectSkinport(store,client,time), collectSkinport(store,client,time)]);
    expect(results.filter(r => 'skipped' in r && r.skipped)).toHaveLength(1);
    expect(rows).toHaveLength(1);
    await collectSkinport(store,client,() => new Date('2026-09-09T09:05:00Z'));
    expect(rows).toHaveLength(2); expect(rows[0].minPrice).toBe(rows[1].minPrice); expect(runs.size).toBe(3); expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it('preserves committed SUCCESS if the database acknowledgement is lost', async () => {
    const { store, rows } = memory(); const finish = store.finish;
    store.finish = async (id, values, batch) => {
      await finish(id,values,batch);
      if (batch.length) throw new Error('acknowledgement lost after commit');
    };
    expect(await collectSkinport(store,mockClient().client)).toMatchObject({ status: 'SUCCESS', observationsInserted: 1 });
    expect(rows).toHaveLength(1);
  });
  it.each(['SUCCESS', 'PARTIAL', 'FAILED'] as const)('records %s completion after persistence latency', async status => {
    let elapsed = 0;
    const now = () => new Date(Date.UTC(2026,8,9,9) + elapsed);
    const { store, runs } = memory();
    if (status === 'PARTIAL') store.tracked = async () => [];
    const finish = store.finish;
    store.finish = async (id, values, batch) => {
      expect(values.finishedAt).toBeUndefined();
      expect(values.durationMs).toBeUndefined();
      elapsed += 750; // Slow final database write, not upstream time.
      await finish(id,values,batch);
    };
    const result = await collectSkinport(store, mockClient([item],[history], status === 'FAILED' ? 500 : 200).client, now);
    expect(result).toMatchObject({ status, durationMs: 750, finishedAt: now() });
    expect([...runs.values()][0]).toMatchObject({ durationMs: 750, finishedAt: now() });
  });
  it('records duplicate completion after its audit insertion', async () => {
    let elapsed = 0;
    const now = () => new Date(Date.UTC(2026,8,9,9) + elapsed);
    const { store, runs } = memory();
    await collectSkinport(store,mockClient().client,now);
    const audit = store.audit;
    store.audit = async run => { elapsed += 125; await audit(run); };
    await collectSkinport(store,mockClient().client,now);
    expect([...runs.values()].find(run => run.errorCode === 'DUPLICATE_WINDOW')).toMatchObject({ durationMs: 125, finishedAt: now() });
  });
  it('preserves committed observations and completion time if timing acknowledgement is lost', async () => {
    let elapsed = 0;
    const now = () => new Date(Date.UTC(2026,8,9,9) + elapsed);
    const { store, rows, runs } = memory();
    const finish = store.finish, stamp = store.completeTiming;
    store.finish = async (id,values,batch) => { if(batch.length) elapsed += 500; await finish(id,values,batch); };
    store.completeTiming = async (id,timing) => { await stamp(id,timing); elapsed += 200; throw new Error('lost telemetry acknowledgement'); };
    const result = await collectSkinport(store,mockClient().client,now);
    expect(result).toMatchObject({ status: 'SUCCESS', durationMs: 500, observationsInserted: 1 });
    expect(rows).toHaveLength(1);
    expect([...runs.values()][0].durationMs).toBe(500);
  });
  it('retries a failed timing write without converting committed SUCCESS into FAILED', async () => {
    let elapsed = 0, attempts = 0;
    const now = () => new Date(Date.UTC(2026,8,9,9) + elapsed);
    const { store, rows } = memory();
    const stamp = store.completeTiming;
    store.completeTiming = async (id,timing) => {
      if (++attempts === 1) { elapsed += 100; throw new Error('telemetry write unavailable'); }
      await stamp(id,timing);
    };
    expect(await collectSkinport(store,mockClient().client,now)).toMatchObject({ status: 'SUCCESS', observationsInserted: 1, durationMs: 100 });
    expect(rows).toHaveLength(1);
    expect(attempts).toBe(2);
  });
  it('records persistence failure without claiming inserted observations', async () => {
    const { store, runs } = memory(); const finish = store.finish;
    store.finish = async (id, values, rows) => { if(rows.length) throw new Error('write rejected'); await finish(id,values,rows); };
    expect(await collectSkinport(store,mockClient().client)).toMatchObject({ status: 'FAILED', observationsInserted: 0 });
    expect([...runs.values()][0].status).toBe('FAILED');
  });
});
describe('analytics', () => {
  it('calculates safe success fractions', () => { expect(successRate(287,288)).toBeCloseTo(0.996527); expect(successRate(0,0)).toBeNull(); });
  it('detects staleness only beyond the boundary and includes never-observed assets', () => {
    const now = new Date('2026-09-09T09:15:00Z');
    expect(isStale(new Date('2026-09-09T09:00:00Z'),now,15)).toBe(false);
    expect(isStale(new Date('2026-09-09T08:59:59.999Z'),now,15)).toBe(true); expect(isStale(null,now,15)).toBe(true);
  });
  it('calculates money changes with decimal arithmetic and honest null baselines', () => {
    expect(percentageChange('0.10','0.11')).toBe('10.00000000'); expect(percentageChange(0,12)).toBeNull(); expect(percentageChange(null,'1')).toBeNull();
  });
});

it('records whole-response hashes independently of normalized values', async () => {
  const body = JSON.stringify([history]);
  const client = skinportClient(async () => new Response(body));
  const first = await client.history(), second = await client.history();
  const whitespace = await skinportClient(async () => new Response(body + '\n')).history();
  expect(first.bodySha256).toMatch(/^[a-f0-9]{64}$/);
  expect(second.bodySha256).toBe(first.bodySha256);
  expect(whitespace.bodySha256).not.toBe(first.bodySha256);
  expect(whitespace.data).toEqual(first.data);
  expect(first.responseBytes).toBe(Buffer.byteLength(body));
  expect(first.bodyReceivedAt.getTime()).toBeGreaterThanOrEqual(first.startedAt.getTime());
  expect(first.finishedAt.getTime()).toBeGreaterThanOrEqual(first.bodyReceivedAt.getTime());
});
