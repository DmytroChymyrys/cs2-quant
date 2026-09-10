# Adding a source

1. Confirm usage approval for FloatAlpha's use case, select a documented endpoint and check in sanitized authoritative raw fixtures. Preserve numeric token text and real endpoint structure. Mark synthetic edge-case mutations as tests; never represent them as live provider responses.
2. Identify the provider independently from every venue in its records. Verify capabilities per provider/venue pair. Unknown capability support is not a null observed value.
3. Implement a provider client, native DTO/schema and `MarketSourceAdapter`. Own URL/auth/timeout/decoding/error classification there. Preserve documented rate limits and retries; avoid retries by default unless explicitly required. Never log credentials.
4. Implement `MarketObservationTransformer` with a fixed version. Map canonical listing/ask/bid, sales statistic/window, currency and source timestamps only where the endpoint supports them. Never create a bid from an ask, zero from missing data, or one sale statistic from another. OHLC requires a candle type, not a scalar sale-price alias.
5. Validate canonical observations before resolving internal identity. Use the existing `asset_source_mappings` table and provider/venue-qualified source keys. Map to approved internal UUIDs; don't create separate provider-specific assets. Keep version handling explicit and do not enable variants under the current unversioned policy.
6. Add a lazy registry entry with disabled configuration and isolated error handling. Absent credentials for a disabled provider must not affect startup or Skinport. Do not add it to the protected Skinport scheduling endpoint.
7. Before any shadow writes, implement separate storage and a separate run/claim scope keyed by provider and venue. Persist provenance and normalization version. The existing Skinport compatibility writer explicitly rejects other providers. A future shadow table should store the canonical provider/venue/identity/statistic shape so promotion changes read eligibility rather than rewriting measurements.
8. Test endpoints/headers, disabled zero-request behavior, credentials, lossless decimals, missing/zero values, timestamps, malformed records, exact statistic mappings, identity failures and provider health isolation. Test two providers observing Skinport as one venue with two provenance paths. Add provider fixtures for each actually supported venue; do not invent missing API contracts.
9. Keep production disabled until shadow results and deployment/configuration are separately approved. Do not alter UI, analytics, preferred-provider selection logic or the existing schedule merely to add a source.

## cs2.sh next step

Its client/adapter/transformer boundaries exist but mapping remains pending. Confirm commercial-use approval for FloatAlpha's exact use case, obtain a development key and authoritative endpoint fixtures, then implement those mappings and an isolated shadow runner/storage. After these prerequisites, run 24–72 hours of shadow collection against the same approved 100 assets. Review provider freshness, nullable statistics, zero values, errors and source agreement without enabling active multi-source analytics or Price Confidence.

`CS2SH_ENABLED=true` alone currently requires a key and then fails closed with `SOURCE_MAPPING_PENDING`; it is not an activation shortcut.
