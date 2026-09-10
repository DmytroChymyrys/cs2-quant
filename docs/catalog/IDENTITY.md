# Identity and reconciliation

Market observations continue referencing existing FloatAlpha `assets.id` UUIDs. The catalog never inserts into or updates that table.

A canonical ID is `fa_` plus SHA-256 of `provider:dataset:source_id`. It remains stable across metadata updates and is separate from market identity. A non-unique market-name index is intentional: several paint variants can share the same Steam market name.

Only byte-for-byte `market_hash_name` equality qualifies as a match. No lowercasing, Unicode substitution, wear stripping, StatTrak/Souvenir stripping, substring matching, or display-name fallback occurs. Null market names remain null, including nonmarketable/base definitions.

- One candidate: EXACT, preserving the FloatAlpha UUID.
- No candidate: MISSING, with an explicit reason and null catalog ID.
- Several candidates: AMBIGUOUS, with all canonical candidate IDs and no chosen media.

The pinned source has 122 shared skin market names due to Doppler/Gamma Doppler paints. For example, Bayonet Doppler Factory New has separate paint indexes 415–421 and distinct source IDs/artwork. Those are retained as distinct catalog records. A name-only market asset must not select a phase. All current 100 tracked assets happen to have unique exact matches.

Duplicate source IDs stop the import before writes. Invalid individual records produce indexed diagnostics; excessive invalidity stops the snapshot. Unrecognized skin/container categories are rejected for review, not guessed. Adding a dataset requires an explicit manifest entry, category/semantic review, validator/normalizer support, fixtures, and reconciliation.

Disappearance marks a catalog record with `deprecated_at` and excludes it from presentation; it never deletes historical catalog/media rows. A returning record clears that marker. Existing metadata timestamps do not churn on identical input; sync-run history records subsequent observations of the snapshot. A new source ID is a new catalog identity, even if it reuses a prior market name.
