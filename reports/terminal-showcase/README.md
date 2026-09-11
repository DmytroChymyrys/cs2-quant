# Landing Terminal showcase restoration

Baseline: `731832b`. The earlier cinematic asset was located in Git commit `e637af5`: `public/product-previews/terminal-art-full.jpg`, referenced by the original `LandingShowcase` component. The original file is preserved.

Only the landing workstation showcase changes: its Terminal child now displays the restored cinematic illustration, and its frame reads **CONCEPT ILLUSTRATION · SAMPLE METRICS · NOT LIVE**. Existing tab interaction, frame geometry, Screener preview and Asset Intel preview remain intact. Terminal-specific sizing uses a component CSS module.

Edited artwork: [terminal-concept.webp](../../public/product-previews/terminal-concept.webp), 1697 × 927, approximately 120 KB. The built-in imagegen tool edited the existing image; Sharp encoded the resulting PNG as WebP for delivery. No image was generated from scratch. The input's perspective/grid environment, floating panels, CS2 identity and layered curves were retained while unsupported claims were replaced.

## Verification

- All three tabs switch by click and keyboard at 1440, 1280, 1024, 768 and 390px. Frame height remains stable; no document horizontal overflow or browser errors.
- Screener and Asset Intel preview screenshots are **pixel-identical** to baseline at all five widths (10 matching SHA-256 comparisons).
- Real Terminal, Screener, Assets, Asset Intelligence, Portfolio and Watchlist have unchanged main content and geometry. No application-page, global-style, navigation, data, analytics, demo-generator, collector, deployment or experiment files were changed.
- 35 relevant existing tests passed (`craft-polish` and `preview-isolation`). Existing production build, including TypeScript, passed in an isolated demo-only checkout.
- Lint: zero errors; two pre-existing unused-variable warnings in earlier QA report scripts.
- Clean optimized-build screenshot: [restored-terminal.png](restored-terminal.png). Before/after evidence and replay script are in this directory. Screenshots remain local artifacts.
- Production and the existing Vercel Preview were not changed. The pre-existing generated `next-env.d.ts` working-tree change was preserved and excluded from this patch.

## Built-in image edit prompt

Use case: text-localization. Edit target: the supplied existing FloatAlpha cinematic Terminal artwork. This is a surgical typography correction, NOT a new composition. Preserve the original camera, wide 1408:768 framing, deep dark navy perspective grid room, translucent floating market panels, recognizable AK-47 | Fire Serpent identity, delicate cyan/rose layered signal curves, lighting, visual depth, panel positions, and overall institutional surveillance concept-art style. Change only unsupported text and metrics, matching original perspective, typography and light. Main overhead title: replace 'DIVERGENCE THESIS MODEL' with exact 'MARKET STRUCTURE'. Main foreground card: preserve 'AK-47 | Fire Serpent'; correct wear label to 'Battle-Scarred'. Replace its metric block with these exact lines: 'Listing price: $1,098.80', 'Activity: 19 / 100', 'Listing supply: 142', 'Realized volatility: 0.23%'. Replace its footer 'FloatAlpha Score: 74' with exact 'MARKET OBSERVATION'. Smaller background panels may use only 'PRICE STRUCTURE', 'LISTING SUPPLY', 'ACTIVITY', 'MARKET OBSERVATION', CS2 asset names, and abstract tiny unlabeled rows. Remove all occurrences of unsupported FloatAlpha Score, divergence thesis/model, sales or volume metrics from ALL panels. Do not add LIVE, connected, latency, predictions, buy/sell, forecasts or sync labels. Preserve rather than recreate the existing artwork; everything except these text substitutions stays visually identical. No new composition, extra cards, logos, borders or marketing text. Disclosure will be provided separately in the real webpage frame.
