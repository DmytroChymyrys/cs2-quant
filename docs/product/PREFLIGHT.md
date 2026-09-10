# cs2-quant product preflight

User instruction overrides the imported handoff's brand: use **cs2-quant** throughout the product. Imported specifications and images retain their original wording as reference provenance.

Starting point: clean `main`, commit abaefe6; remote main matches. Work branch: `feat/cs2-quant-product`.

Existing: Next.js 16.3.4, React 19.2.8, TypeScript 6.0.3; App Router with an unstyled placeholder root, three protected internal API routes, Drizzle/Neon HTTP, four market tables, two migrations, exact decimal normalization, append-only observations, five-minute unique claims. No styling system, component library, user accounts, billing, watchlists, alerts, or portfolio. Baseline: 55 tests, typecheck, lint, production build pass.

Protected boundary: collector, market schemas/migrations, identity, normalization, schedule and experiment must remain unchanged. Product additions use separate modules and additive migrations. No product migrations or deployments are applied to production as part of local implementation without first validating the new integration requirements.

Current branding override: the user subsequently selected FloatAlpha as the public product name. Existing cs2-quant repository and infrastructure identifiers remain unchanged. Source facts and DATA_SEMANTICS override invented price indices, unsupported order books, trade feeds, confidence scores and historical windows. Confidence has no approved calibrated methodology: show UNAVAILABLE and an explanation, not invented HIGH/MEDIUM/LOW classifications. Free/Pro prices come from configured Stripe products, never screenshot numbers.

Integration prerequisites currently absent: Better Auth secret/base URL, Google OAuth client credentials, transactional email provider credentials/sender, Turnstile site/secret keys, Stripe secret/webhook keys and price IDs. Configuration absence must produce explicit unavailable states; no fabricated successful login, email, checkout, or paid account.

Phases: (1) reusable tokens/primitives/shells; (2) public/auth; (3) grounded market services/screens; (4) watchlist/checkpoints; (5) durable transition alerts; (6) manual portfolio; (7) centralized entitlements/Stripe; (8) visual, accessibility, security and workflow validation. Each phase is a separate reviewable checkpoint.

Dependency note: Better Auth 1.7.3 declares an optional Vitest 2/3/4 peer. The existing collector tests use Vitest 5. An explicit Better Auth-only optional peer override retains the existing test runner; no runtime collector dependency is downgraded.
