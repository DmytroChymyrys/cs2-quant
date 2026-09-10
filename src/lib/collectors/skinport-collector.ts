import { randomUUID } from 'node:crypto';
import { MarketSourceError } from '../../market-data/domain/source-errors';
import { WINDOW_MS } from '../config';
import { type CollectorStore, type Run, type Observation } from '../db/collector-store';
import { skinportClient, SourceError } from '../sources/skinport/client';
import { createSkinportSource } from '../../market-data/registry/source-registry';
import { prepareSkinport, skinportProvenance } from '../../market-data/transformers/skinport/skinport.transformer';
import { identityResolver, trackedSkinportMappings } from '../../market-data/ingestion/identity-resolver';
import { ingestObservation } from '../../market-data/ingestion/ingestion.service';
import { toSkinportObservation } from '../../market-data/ingestion/observation-writer';
export async function collectSkinport(store: CollectorStore, client = skinportClient(), now = () => new Date()) {
  const startedAt = now();
  const id = randomUUID();
  const windowStart = new Date(Math.floor(startedAt.getTime() / WINDOW_MS) * WINDOW_MS);
  const base: Run = { id, source: 'SKINPORT', startedAt, windowStart, claimKey: `SKINPORT:${windowStart.toISOString()}` };
  const operation = { requestCount: 0, recordsReceived: 0, recordsTransformed: 0, recordsValid: 0, recordsRejected: 0 };
  const log = (event: string, fields: object) => console.info(JSON.stringify({ event, collectorRunId: id, source: 'SKINPORT', provider: 'SKINPORT_DIRECT', venue: 'SKINPORT', ...operation, ...fields }));
  const completeTiming = async () => {
    const finishedAt = now();
    const timing = { finishedAt, durationMs: finishedAt.getTime() - startedAt.getTime() };
    await store.completeTiming(id, timing);
    return timing;
  };
  log('collector.start', { startedAt });
  if (!await store.claim(base)) {
    const duplicate = { ...base, claimKey: null, status: 'PARTIAL' as const, errorCode: 'DUPLICATE_WINDOW', errorMessage: 'Window already claimed; no upstream requests made.' };
    await store.audit(duplicate);
    const timing = await completeTiming();
    log('collector.end', { ...duplicate, ...timing });
    return { collectorRunId: id, status: 'PARTIAL', skipped: true, errorCode: 'DUPLICATE_WINDOW' };
  }
  const stats: Partial<Run> = { trackedAssets: 0, itemsReceived: 0, historyItemsReceived: 0, itemsMatched: 0, itemsMissing: 0, observationsInserted: 0 };
  const metadata: Record<string, unknown> = { provenance: skinportProvenance, collectedAt: startedAt, operation };
  try {
    const source = createSkinportSource(client);
    const tracked = await store.tracked();
    stats.trackedAssets = tracked.length;
    // Fetch concurrently to minimize snapshot skew; always await both for complete diagnostics.
    operation.requestCount = source.enabled ? 2 : 0;
    const { items: itemsResult, history: historyResult } = await source.adapter.collect();
    const errors: SourceError[] = [];
    for (const [key, result] of [['items', itemsResult], ['history', historyResult]] as const) {
      if (result.status === 'fulfilled') {
        stats[key === 'items' ? 'itemsHttpStatus' : 'historyHttpStatus'] = result.value.status;
        stats[key === 'items' ? 'itemsReceived' : 'historyItemsReceived'] = result.value.data.length;
        metadata[`${key}Fetch`] = { startedAt: result.value.startedAt, finishedAt: result.value.finishedAt, bodyReceivedAt: result.value.bodyReceivedAt, bodySha256: result.value.bodySha256, responseBytes: result.value.responseBytes };
      } else {
        const error = result.reason instanceof SourceError ? result.reason : new SourceError('NETWORK_ERROR', key);
        stats[key === 'items' ? 'itemsHttpStatus' : 'historyHttpStatus'] = error.httpStatus;
        errors.push(error);
      }
    }
    operation.recordsReceived = (stats.itemsReceived ?? 0) + (stats.historyItemsReceived ?? 0);
    metadata.upstreamErrors = errors.map(e => ({ endpoint: e.endpoint, code: e.code, httpStatus: e.httpStatus, details: e.details }));
    if (errors.length) throw errors[0];
    if (itemsResult.status !== 'fulfilled' || historyResult.status !== 'fulfilled') throw new Error('UPSTREAM_FAILED');
    const { items, history } = prepareSkinport(itemsResult.value.data, historyResult.value.data, metadata);
    const observedAt = now();
    const rows: Observation[] = [];
    const resolve = identityResolver(trackedSkinportMappings(tracked));
    const missing: string[] = [], missingHistory: string[] = [];
    for (const asset of tracked) {
      const item = items.get(asset.marketHashName);
      if (!item) { missing.push(asset.marketHashName); continue; }
      const sales = history.get(asset.marketHashName);
      if (!sales) missingHistory.push(asset.marketHashName);
      const [observation] = source.transformer.transform({ item, history: sales }, { runId: id, startedAt, observedAt });
      operation.recordsTransformed++;
      try { rows.push(ingestObservation(observation, resolve, toSkinportObservation)); operation.recordsValid++; }
      catch (error) { operation.recordsRejected++; throw error; }
    }
    stats.itemsMatched = rows.length;
    stats.itemsMissing = missing.length;
    metadata.missingAssets = missing;
    metadata.missingHistory = missingHistory;
    const partial = !tracked.length || missing.length > 0 || missingHistory.length > 0;
    const status = partial ? 'PARTIAL' : 'SUCCESS';
    const finish = { ...stats, status, observationsInserted: rows.length, metadata,
      errorCode: partial ? (!tracked.length ? 'NO_TRACKED_ASSETS' : 'INCOMPLETE_COVERAGE') : null,
      errorMessage: partial ? 'See metadata for absent items or history; configure tracked assets if empty.' : null } satisfies Partial<Run>;
    await store.finish(id, finish, rows);
    const timing = await completeTiming();
    log('collector.end', { ...finish, ...timing });
    return { collectorRunId: id, ...finish, ...timing, metadata: undefined };
  } catch (error) {
    const code = error instanceof SourceError ? error.code : error instanceof MarketSourceError ? error.sourceCode : error instanceof Error && error.message === 'DUPLICATE_SOURCE_NAME' ? error.message : 'PERSISTENCE_OR_PROCESSING_ERROR';
    const finish = { ...stats, status: 'FAILED' as const, observationsInserted: 0, errorCode: code, errorMessage: 'Collection failed; inspect errorCode, HTTP statuses and metadata.', metadata };
    // Do not expose raw exception messages: driver errors may contain credentials or payloads.
    let persisted: Run | undefined;
    try {
      await store.finish(id, finish, []);
      persisted = await store.read(id);
      if (persisted && !persisted.finishedAt) {
        await completeTiming();
        persisted = await store.read(id);
      }
    }
    catch { log('collector.audit_failed', { errorCode: 'DATABASE_UNAVAILABLE' }); throw new Error('DATABASE_UNAVAILABLE'); }
    // A commit may succeed even if its HTTP acknowledgement was lost. Preserve database truth.
    const reconciled = { ...finish, ...persisted };
    log('collector.end', reconciled);
    return { ...reconciled, collectorRunId: id, metadata: undefined };
  }
}
