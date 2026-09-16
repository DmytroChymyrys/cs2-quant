/**
 * L1 content-addressed History dedup.
 *
 * `market_observations` is append-only by trigger, so the observation→payload
 * link lives in its own table and is only ever INSERTed. `raw_history_payload`
 * remains the authoritative copy; nothing here reads from or writes to it except
 * to copy and to verify.
 */
export type Queryable = {
  query: (
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
};

// Candidate observations for one batch: not yet linked, and carrying a payload.
const UNLINKED = `select o.id, o.asset_id, o.source, o.observed_at, o.raw_history_payload,
       encode(sha256(o.raw_history_payload::text::bytea),'hex') as sha
  from market_observations o
  left join market_observation_history l on l.observation_id = o.id
  where l.observation_id is null and o.raw_history_payload is not null
  order by o.observed_at, o.id
  limit $1`;

/** Inserts distinct payloads for one batch. Safe to repeat. */
export async function upsertPayloads(db: Queryable, batchSize: number) {
  await db.query(
    `insert into market_history_payloads(asset_id,source,payload_sha256,payload,first_seen_at,last_seen_at,observation_count)
     select b.asset_id, b.source, b.sha, b.raw_history_payload, min(b.observed_at), max(b.observed_at), 0
     from (${UNLINKED}) b
     group by b.asset_id, b.source, b.sha, b.raw_history_payload
     on conflict on constraint history_payload_identity do update
       set first_seen_at = least(market_history_payloads.first_seen_at, excluded.first_seen_at),
           last_seen_at  = greatest(market_history_payloads.last_seen_at, excluded.last_seen_at)`,
    [batchSize],
  );
}

/** Links one batch of observations. Returns how many rows were linked. */
export async function linkPayloads(db: Queryable, batchSize: number) {
  const linked = await db.query(
    `insert into market_observation_history(observation_id,history_payload_id)
     select b.id, p.id
     from (${UNLINKED}) b
     join market_history_payloads p
       on p.asset_id = b.asset_id and p.source = b.source and p.payload_sha256 = b.sha
     on conflict (observation_id) do nothing`,
    [batchSize],
  );
  return linked.rowCount ?? 0;
}

export async function refreshPayloadCounts(db: Queryable) {
  await db.query(
    `update market_history_payloads p set observation_count = coalesce(c.n,0)
     from (select history_payload_id, count(*)::int as n from market_observation_history group by 1) c
     where c.history_payload_id = p.id and p.observation_count is distinct from c.n`,
  );
}

export type Verification = {
  byteIdenticalMismatches: number;
  withPayload: number;
  linked: number;
  unlinked: number;
  distinctPayloads: number;
  dedupRatio: number | null;
};

/**
 * Every link must resolve to exactly the payload that observation recorded.
 * Uses jsonb equality, not the stored hash, so the check is independent of the
 * hash function and of any text-rendering differences between versions.
 */
export async function verifyLinks(db: Queryable): Promise<Verification> {
  const { rows } = await db.query(
    `select
      (select count(*)::int from market_observation_history l
         join market_observations o on o.id = l.observation_id
         join market_history_payloads p on p.id = l.history_payload_id
        where p.payload is distinct from o.raw_history_payload
           or p.asset_id <> o.asset_id or p.source <> o.source) as mismatches,
      (select count(*)::int from market_observations where raw_history_payload is not null) as with_payload,
      (select count(*)::int from market_observation_history) as linked,
      (select count(*)::int from market_observations o
         left join market_observation_history l on l.observation_id=o.id
        where l.observation_id is null and o.raw_history_payload is not null) as unlinked,
      (select count(*)::int from market_history_payloads) as distinct_payloads`,
  );
  const r = rows[0];
  const distinct = Number(r.distinct_payloads);
  return {
    byteIdenticalMismatches: Number(r.mismatches),
    withPayload: Number(r.with_payload),
    linked: Number(r.linked),
    unlinked: Number(r.unlinked),
    distinctPayloads: distinct,
    dedupRatio: distinct ? Number(r.with_payload) / distinct : null,
  };
}

/** Runs the whole backfill to completion. Idempotent and resumable. */
export async function backfill(
  db: Queryable,
  batchSize: number,
  onBatch?: (linked: number, total: number) => void,
) {
  let total = 0,
    batches = 0;
  for (;;) {
    await upsertPayloads(db, batchSize);
    const linked = await linkPayloads(db, batchSize);
    if (!linked) break;
    total += linked;
    batches++;
    onBatch?.(linked, total);
  }
  await refreshPayloadCounts(db);
  return { linked: total, batches };
}
