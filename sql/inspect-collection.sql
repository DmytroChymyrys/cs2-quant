-- Run after the first real collection. Keep both queries identical to the review request.
SELECT *
FROM collector_runs
ORDER BY started_at DESC
LIMIT 10;

SELECT
    a.market_hash_name,
    COUNT(*) observations,
    MIN(o.observed_at),
    MAX(o.observed_at)
FROM market_observations o
JOIN assets a ON a.id = o.asset_id
GROUP BY a.id, a.market_hash_name
ORDER BY observations DESC;
