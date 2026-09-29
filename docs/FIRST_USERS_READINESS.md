# FloatAlpha — First Users Readiness

Audit of the first-time user experience, walked against production at commit
`2930f07`. **No product code was changed by this document.**

Every finding below was verified against the live site or the database, not
inferred from the repository.

---

## 1. Executive summary

**FloatAlpha is not ready for paid traffic today, and two findings are the
reason.** Both are small to fix. Neither is a missing feature.

**P0-1 — There is no way to sign up from any public market page.**
`/terminal`, `/assets`, `/screener`, `/cs2-skins` and every asset page render
**zero** signup links and **zero** login links to an anonymous visitor. Those
are precisely the pages that rank in search and that a Google Ads campaign
would land on. A high-intent visitor arriving on an asset page today has no
route to an account without navigating back to the home page.

**P0-2 — Search tells users we do not have assets we observe every five
minutes.** Searching `Medusa` returns *"No assets match. Try a different name,
category, or price range."* The provider universe holds **6 Medusa variants,
all 6 currently listed and observed on the five-minute cadence**. Gungnir: 3
observed, same message. The product says "we don't know this" about assets it
is actively collecting. For ad traffic searching famous skins, this is the
worst possible first impression.

**P0-3 — The funnel cannot be measured where it matters.** GA4 fires
`preview_signup_started` but there is **no signup-completion event**. Email
signup requires verification, so started ≠ completed, and the single most
important conversion in the business is unobservable. Of the four actions that
define Activated, only `watchlist_add` is instrumented.

Good news: **Market Intelligence Phase 1 is fully live** (§6), the public
product is genuinely useful anonymously, the evidence language holds up, and
mobile works. The product is closer to ready than the instrumentation is.

---

## 2. Current anonymous-user journey

**Landing (`/`)** — leads with *"THE MARKET BEHIND THE PRICE / See what price
alone doesn't show"* and *"Consider price, supply, and activity together, with
source evidence in view."* That is a clear, honest, differentiated
proposition. It does not read like a marketplace or a float database. Three
`/signup` links are present.

**Market pages** — `/terminal` opens with FloatAlpha Market Pulse (breadth
with denominators), `/assets` and `/screener` are fully usable without an
account, `/cs2-skins` gives category entry. All indexable, all fast.

**Asset page** — real observed data: median, minimum, listing quantity,
activity, chart, freshness, provenance disclosure.

**The break:** none of these pages offer registration (P0-1). The only
account-adjacent element is a "Free / Pro" chip linking to `/pricing`.

## 3. Current signup journey

| Path | Behaviour |
| --- | --- |
| Google SSO | One click → `/onboarding`. No verification step. Links to an existing account with the same email (verified in production). |
| Email + password | Creates the account, shows *"Check your email to verify your account"*, and **leaves the user on the signup page**. The verification link lands on `/onboarding`. |
| Login | → `/terminal` |

Both paths work in production and were verified end to end.

**Friction:** the email path ends on a dead page. The user must leave for their
inbox with nothing to do in the tab they are in.

## 4. Current authenticated-user journey

First authenticated screen is `/onboarding`: *"Personalize your terminal — Make
the market relevant."* It collects category and interest preferences and ends
with **"Open my terminal"** → `/terminal`.

**This is the signup → generic dashboard → "now what?" shape the brief warns
about.** Preferences are a reasonable idea, but:

- Saving preferences **is not** one of the four Activated actions, so a user
  can complete onboarding and remain unactivated by definition.
- Nothing on the path suggests watching an asset, which is the cheapest,
  most natural first action and the one already instrumented.

Empty states do exist and are decent — *"Keep your research in one place"*
(watchlist), *"Build your portfolio view"* (portfolio), *"No alert rules"* —
but they are reached only if the user navigates there unprompted.

## 5. Current returning-user journey

Login → `/terminal`, which shows current market breadth. That is a defensible
landing spot.

**Missing:** nothing tells a returning user *what changed since last time*.
The `watchlist_entries.checkpoint_observation_id` primitive exists and is
written, but is not surfaced (recorded in `MARKET_INTELLIGENCE_EVOLUTION.md`
§8). Alerts exist and work, but require setup the user has not been prompted
to do.

## 6. Market Intelligence Phase 1 status

**Fully live.** Verified against production, not assumed — commit `f577277`:

| | Evidence on production |
| --- | --- |
| **P1-A** Market Pulse | `FloatAlpha Market Pulse`, `Rising · 1h`, `of 99 observed` |
| **P1-B** Row-level why | `Venue listings -33.33% / 24h ≤ …` under the contracting preset |
| **P1-C** CS2 filters | `CS2 asset filters` · `Weapon or item` · `Wear` · `StatTrak` |

Nothing remains outstanding from Phase 1.

## 7. Activation-path audit

Activated = a user with a watchlist entry, portfolio holding, alert rule, or
saved screen. Current production count: **0 of 3 registered users.**

| Action | Discoverable? |
| --- | --- |
| Watchlist entry | Button on the asset page. **Cheapest and best first action.** Not suggested anywhere. |
| Portfolio holding | Requires navigating to Portfolio and entering quantity/cost. High friction. |
| Alert rule | Requires an asset plus a condition. Highest friction. |
| Saved screen | Requires running a screen first. |

**The product never asks for any of them.** Onboarding asks for preferences
instead — which do not count.

## 8. Empty-state audit

Watchlist, portfolio and alerts all have written empty states with titles and
CTAs. This is better than most products at this stage. The gap is not empty
states; it is that users never arrive at them.

## 9. Mobile audit

Verified on iPhone 14 Pro Max viewport: Market Pulse reflows to two columns,
tables scroll horizontally within their container, **0px page overflow** on
`/terminal` and `/screener`, asset artwork renders (26 images, all opaque).
Founder Ops also verified at 0px overflow.

**No mobile P0.** P0-1 applies equally on mobile — arguably worse, since the
header has less room for a CTA.

## 10. GA4 / instrumentation audit

Events that exist, by their real names in `src/lib/ga.ts`:

| Event | Fired from | Funnel role |
| --- | --- | --- |
| `page_view` | GA4 enhanced measurement | Landing / traffic |
| `view_asset` | asset page | Discovery |
| `category_viewed` | category page | Discovery |
| `screener_used` | screener | Discovery |
| `search_used` | screener (result count only) | Discovery |
| `pricing_viewed` | pricing | Intent |
| `preview_signup_started` | auth form | Signup **intent** |
| `watchlist_add` | watch button | **Activation (1 of 4)** |
| `portfolio_opened` | portfolio page | Engagement, not activation |

**Gaps, in priority order:**

1. **No signup completion event.** `preview_signup_started` fires on attempt.
   With `requireEmailVerification: true`, a large share of attempts never
   complete. Signup conversion is currently unmeasurable.
2. **3 of 4 activation actions uninstrumented** — alert created, saved screen,
   portfolio holding added. Only `watchlist_add` exists.
3. **No terminal or assets-directory event.** Two of the most likely ad
   landing pages emit only `page_view`.

## 11. Funnel observability

| Stage | Server (Founder Ops) | GA4 |
| --- | --- | --- |
| Visitor | ✗ no source | ✓ `page_view` |
| Signup | ✓ `auth_users` | ✗ intent only |
| Activated | ✓ four tables | ✗ 1 of 4 actions |
| Returning | ✓ `auth_sessions` | ✓ (GA4 native) |

Neither half sees the whole funnel, and **no join exists between them** — GA4
cannot attribute a signup to a landing page or campaign, because the
completion event does not fire. For a paid campaign that is a real problem:
spend cannot be tied to registrations.

## 12. Google Ads landing-page readiness

Strongest existing pages, by intent — **no new routes needed**:

| Intent | Page | Why it fits |
| --- | --- | --- |
| *"AWP Asiimov price"* — specific item | `/asset/{slug}` | Observed price, supply, history, freshness. Highest intent, most convincing. |
| *"CS2 skin prices"* — browse | `/assets` | Full tracked universe with price and supply. |
| *"CS2 knife prices"* — category | `/cs2-skins/{category}` | 5 substantive categories already indexed. |
| *"CS2 market trends"*, *"gainers"* | `/screener` | Presets map directly to these queries. |
| *"CS2 market today"* | `/terminal` | Market Pulse answers it above the fold. |

**All five are blocked by P0-1** — none offers registration — and asset/assets
pages are additionally exposed to P0-2 when the searched skin is outside the
intelligence universe.

**Do not** send ads to `/pricing`. Preview is free; a pricing page is the wrong
destination and the landing copy still uses subscription framing
("Subscription tiers", "Compare plans & capabilities").

## 13. Broad-catalog vs intelligence-ready UX

The three states from `MARKET_INTELLIGENCE_EVOLUTION.md` §11 are **not
represented in the UI at all**. Search filters `dataset.assets` — the ~100
derived universe — and everything else falls off the edge:

| State | Count | UI today |
| --- | --- | --- |
| Catalog / recognised | 48,412 | invisible |
| Observed (provider universe) | ~25,000 | invisible |
| Intelligence-ready | 99 | the only thing searchable |

Verified: `Medusa` → 6 provider assets, 6 currently listed, 0 tracked → UI says
**"No assets match."** This is P0-2, and it is the single most damaging thing a
searching visitor can encounter.

## 14. Trust / evidence review

**No violations found.** Public copy stays descriptive: *"Price rising +
listings contracting"* is presented as a descriptive market state with an
explicit note that it is not a signal. Prohibited vocabulary is absent and
enforced by `tests/seo-architecture.test.ts`. Pro-tier price anchoring was
removed; no `$14.99` appears anywhere public.

Depth qualification ("thin market") and freshness disclosure are present on
asset pages. Engineering provenance — snapshot IDs, method strings, transformer
versions — is correctly confined to Founder Ops.

## 15. Friction points

1. Public market pages offer no registration (**P0-1**)
2. Search denies assets we observe (**P0-2**)
3. Signup completion unmeasurable (**P0-3**)
4. Email signup dead-ends on the signup page (**P1**)
5. Onboarding collects preferences but drives no activation (**P1**)
6. Landing CTAs point at `/pricing` with subscription framing on a free Preview (**P1**)
7. Returning users are not told what changed (**P2**)

## 16. P0 — before external traffic

- **P0-1** Signup CTA on public market pages, for anonymous visitors only.
- **P0-2** Honest out-of-universe result: recognise the asset, state plainly
  that deep intelligence covers a tracked selection. Never "no match" for
  something we observe.
- **P0-3** `preview_signup_completed` event, fired on actual success.

## 17. P1 — after first users

- **P1-1** Email signup should not dead-end.
- **P1-2** Onboarding should end on an activation action, not preferences alone.
- **P1-3** Instrument the remaining three activation actions.
- **P1-4** Soften pricing-led CTAs while Preview is free.

## 18. Things explicitly NOT to build

Marketplace features, trade-up or case tools, float/pattern data, 3D inspect,
marketplace logos. No new SEO route family (the freeze holds). No derived-scope
expansion. No GA4 Data API integration. No Founder Ops changes. No forced
multi-step onboarding wizard. No pricing or monetization work.

## 19. Exact proposed implementation scope

Smallest batch that makes external traffic defensible — **three P0s**:

| File | Change |
| --- | --- |
| `src/components/shell.tsx` | Anonymous-only "Join the Preview" + "Sign in" in the app header |
| `src/lib/product/intelligence/screener.ts` or a small lookup | Recognise a searched name against provider/catalog data |
| `src/components/intelligence-market.tsx` | Replace "No assets match" with a recognised-but-not-tracked state |
| `src/components/auth-form.tsx` | Fire `preview_signup_completed` on success |
| `src/lib/ga.ts` | Add that event to the typed union |
| `tests/` | CTA presence for anonymous users; recognised-asset copy; event fires only on success |

No schema change. No new route. No collector, derived-pipeline, auth, billing,
SEO or Founder Ops change.

## 20. Acceptance criteria

1. An anonymous visitor on `/terminal`, `/assets`, `/screener`, `/cs2-skins`
   and any asset page can reach signup in one click; a signed-in user sees no
   such CTA.
2. Searching an asset FloatAlpha observes but does not track returns a
   recognised state naming the coverage limit — never "no assets match".
3. No fabricated intelligence is shown for an untracked asset.
4. `preview_signup_completed` fires only on a completed registration, and GA4
   can compute signup conversion from landing.
5. Prohibited vocabulary still absent; keyword-safety tests pass.
6. SEO freeze intact; no new indexable route family.
7. Mobile: 0px horizontal overflow on every changed page.
8. Full suite, typecheck, lint and build pass.
