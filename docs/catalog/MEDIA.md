# Canonical media

`source_url` preserves the source image reference. In V1, `served_url = source_url` for valid media references. Browsers fetch those URLs directly; the page does not download image bytes, resolve identity, or query upstream catalogs. URLs are passed to the existing component before HTML rendering.

Artwork is externally sourced CS2 item representation. FloatAlpha controls its mappings, verification metadata, hashes and presentation code, not the underlying third-party artwork rights. No AI-generated substitute, whole-catalog rehosting, or canonical artwork alteration was introduced.

| State | Meaning | UI |
| --- | --- | --- |
| UNVERIFIED | Allowlisted source URL, not yet decoded or temporarily unreachable | Direct source image with graceful error fallback |
| AVAILABLE | Successfully fetched and decoded by optional sync inspection | Direct source image |
| MISSING | No source URL or verified HTTP 404/410 | No image request |
| INVALID | Malformed URL, unsupported MIME or invalid artwork | No image request |

Source references are limited to HTTPS Steam economy images, Steam app 730 assets, and the specific ByMykel image-tracker repository. Credentials, arbitrary hosts, redirects, and unsupported URL paths are rejected. Future controlled served URLs can be introduced without changing the UI contract; their ingestion policy must be reviewed separately.

`catalog:sync --verify-tracked` inspects only mapped tracked items, at most three concurrent downloads, bounded to 16 MB compressed and 32 million decoded pixels per image. It records original-byte hashes, dimensions, content type and alpha bounds. Bytes are discarded, not rehosted or cropped. Verification is reused for seven days when the source URL is unchanged; changing the URL clears stale verification. The bound is specific to offline inspection and does not weaken the old proxy's 2 MB limit.

All 100 tracked media files verified successfully in the initial run. The other 48,312 media references are UNVERIFIED; URL coverage must not be presented as proof of upstream availability. Blank URLs are supported even though this snapshot has none. Failures during optional verification are explicit and never affect global provider health.

## Previously failing capsules

Antwerp 2022 Legends Sticker Capsule, Paris 2023 Contenders Sticker Capsule, and Stockholm 2021 Legends Sticker Capsule each have one exact `crates.json` record with type Sticker Capsule. Their Steam sources return usable PNG artwork of roughly 6 MB, exceeding the legacy proxy's 2 MB download bound. That proxy originally surfaced generic 404s, later recorded UNUSABLE/SIZE_LIMIT, and suppressed retries. This was neither missing catalog coverage nor a provider outage.

The canonical mapping now serves the supplied source URL directly. The same generic rule applies to every item; no capsule names are special-cased in application code. All three decoded during sync and loaded in desktop/mobile browser tests.

## Presentation and tradeoffs

Wells retain 44×36 table and 160×104 detail geometry, neutral borders/backgrounds, and no rarity glow. No slots appear after client-side identity discovery. A load failure hides the image while keeping its well. Global off removes imagery from initial render. Alpha bounds are stored for future presentation research and are not applied to alter artwork in V1.

Direct sources may be larger and contain more transparent padding than the old thumbnail proxy. Browser bandwidth is not bounded to thumbnail size. Original source caching is controlled by the source provider. A later controlled media/CDN pipeline can solve this while retaining provenance and the same presentation contract.

Existing health sentinels test Steam delivery, which serves all current tracked media. Additional host-specific health policy should be reviewed before promoting other source-host cohorts into product surfaces. No separate health policy or 3D system was added here.
