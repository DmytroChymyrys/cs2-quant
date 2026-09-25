> STRATEGY / HYPOTHESES — NOT AN IMPLEMENTATION SPEC. Individual initiatives require separate approval.

# FloatAlpha business model, contributor network, API and MCP strategy

Living business/product strategy, preserved from **FloatAlpha_Business_Model_Data_Network_API_MCP_Strategy.docx**, September 2026. Added to the repository on **2026-09-15**.

This document records direction, hypotheses and decision gates. It does not authorize implementation, deployment, new pricing, data collection or commercial redistribution.

## Status and scope

- **CURRENT:** The foundation is stored market observations, the controlled collection experiment and the existing web product work. See [implementation status](../product/IMPLEMENTATION_STATUS.md), [product intelligence](../product/INTELLIGENCE.md) and [optional Steam connection](../product/steam-connection.md) for implementation and validation details. Existing implementation does not establish production availability, commercial demand or validated predictive value.
- **NEXT:** Complete, freeze and audit the initial seven-day experiment; research the usefulness of the collected data. A move toward 30 days is a conditional decision, not approval supplied by this document.
- **LATER:** Inventory-aware benefits, contributor participation, a higher subscription tier, commercial API, MCP and B2B feeds are proposals requiring separate validation and approval.
- **REQUIRES LEGAL/LICENSING REVIEW:** Contributor data collection and compensation, Steam inventory/history access, commercial data use and redistribution depend on permissions, platform terms, privacy and licensing review. This label can apply alongside LATER; it is a prerequisite, not a completed review.

## Business thesis

FloatAlpha is intended to become a CS2 market-intelligence and research platform built on trustworthy historical observations, derived intelligence and eventually differentiated or proprietary data. The long-term opportunity extends beyond the consumer web terminal.

The proposed flywheel is:

```text
Clean data and history
  → useful intelligence
  → users and retention
  → connected high-value market participants
  → richer / proprietary data
  → better intelligence
  → Pro / API / MCP / B2B revenue
  → further data acquisition and contributor investment
```

This is a business hypothesis, not evidence that the flywheel or a proprietary data moat already exists.

## Revenue and product layers

These are potential value propositions, not a current feature or entitlement catalog. In particular, inventory-aware intelligence is a later proposal even where listed under Pro.

| Layer | Intended customer | Potential value | Business role |
| --- | --- | --- | --- |
| Free Web | CS2 collectors and traders | Search, assets, core market views and limited intelligence | Acquisition and activation |
| Pro Web | Serious traders and collectors | Deeper history, screeners, alerts, portfolio intelligence and later inventory-aware research | Subscription; first recurring-revenue hypothesis |
| Higher tier / Platinum — LATER | Power users | Advanced analytics, larger limits and richer workflows | Higher subscription only after value is validated |
| Contributor Network — LATER | Selected valuable Steam users and traders | Status, benefits and potentially compensation for useful permitted data | Data-acquisition investment, not direct revenue |
| Developer API — LATER | Developers, tools and research products | Programmatic normalized history and derived intelligence | Usage or subscription plans |
| MCP — LATER | Claude/Codex-compatible agent users and builders | Agent access to market evidence and tools | Pro/developer entitlement or separate paid usage; undecided |
| B2B / Data Feeds — LATER | Marketplaces, analytics companies and professional operators | Higher-volume normalized/derived datasets and historical intelligence | Commercial contracts or data licensing |

## Steam-connected account strategy

**CURRENT product constraint:** Steam connection remains optional and recommended, never a universal signup requirement. Email/classic authentication remains valid. Users may connect during onboarding or later in Settings, with the benefit explained clearly. Core Terminal, Screener, Assets, Watchlist and manual Portfolio functionality must remain usable without Steam.

The [Steam connection documentation](../product/steam-connection.md) governs the existing identity-linking scope and its validation status. Account linking is not inventory ingestion or contributor enrollment.

**LATER · REQUIRES LEGAL/LICENSING REVIEW:** Connected users may receive inventory-aware research, faster portfolio setup, owned-asset intelligence and collection monitoring where technically and legally supported. Do not promise private inventory, complete trade history or transaction history without supported interfaces.

Contributor/data-sharing participation must be a separate, explicit opt-in. Connecting Steam alone must never silently enroll someone in data contribution or monetization, or imply that FloatAlpha sells their personal data.

## Verified Contributor / Market Partner network

**LATER · REQUIRES LEGAL/LICENSING REVIEW.** Recruit a small selected cohort of high-value traders, sellers, collectors or inventory holders whose permitted data materially expands coverage. Do not pay every Steam-connected user.

The initial hypothesis is roughly **10–20 invitees**, followed by measurement of incremental data value before any scaling decision. A potential internal contributor value assessment would consider:

- Unique assets beyond existing coverage.
- Market relevance and scarcity of those assets.
- Freshness of permitted observations.
- Continuity and uptime of contribution.
- Data quality and consistency.
- Incremental information value, rather than account size alone.

This contributor assessment is not a predictive asset score or a marketing “FloatAlpha Score.” Possible incentives include free Pro, verified contributor/market-partner status and early features; cash compensation only when justified by measurable data value. Avoid flat payments to everyone.

The proposed contributor flywheel is to select and potentially compensate valuable traders, gain useful users and differentiated data, improve intelligence, attract more traders and developers, monetize through Pro/API/MCP/B2B and reinvest part of revenue. Its economics require validation.

Before a program starts, review platform terms, permissions, privacy, consent, retention and commercial use. Explicit consent must explain what is shared, why, retention duration and how to stop. Prefer aggregate/normalized market intelligence over resale of raw personal account data. Reward only data permitted for collection and commercial use. Keep identity and permission records separate from observations where appropriate, and establish deletion/revocation behavior before scaling.

## API strategy

**LATER · commercial exposure REQUIRES LEGAL/LICENSING REVIEW.** Do not launch an API merely because raw observations exist. The stronger commercial hypothesis is normalized history and proprietary derived intelligence whose usefulness grows with data maturity.

Candidate surfaces include:

- Asset search and canonical identifiers.
- Current observed state with provenance and freshness.
- Price history and returns.
- Listing-supply history and changes.
- Realized volatility and market-structure features.
- Activity context where supported.
- Cross-asset comparisons and market screener results.
- Later, portfolio/account-aware analytics with appropriate authorization.

Derived intelligence may be more defensible than upstream raw-data redistribution; derivation does not establish redistribution rights. Review upstream licenses and terms before any paid API or feed exposes raw, normalized or derived data.

## MCP strategy

**LATER.** An MCP server could let Claude/Codex-compatible agents query FloatAlpha evidence through the same internal intelligence/service layer used by the web app and API. It must not become a separate source of truth.

Candidate tool names, not implemented contracts:

```text
search_assets
get_asset_intelligence
get_market_structure
get_price_history
get_listing_history
compare_assets
screen_market
get_portfolio
analyze_portfolio
get_watchlist
```

FloatAlpha supplies deterministic data, provenance, timestamps, evidence tiers and derived features. The LLM/agent provides reasoning and explanation. Responses must not invent unsupported predictive claims, and account-aware tools require appropriate authorization.

## B2B and data-feed strategy

**LATER · REQUIRES LEGAL/LICENSING REVIEW.** Explore professional use cases for marketplaces, analytics firms and other operators after data rights and quality are established. Potential offerings include higher-volume normalized or derived datasets and historical intelligence.

Commercial contracts and pricing would depend on coverage, permitted rights, freshness, history and volume. Neither the availability of stored observations nor a derived calculation automatically authorizes a sale or feed.

## Shared intelligence architecture

**LATER conceptual architecture; not an implementation instruction:**

```text
Collectors / licensed sources / contributor inputs
        ↓
Canonical observations + historical store
        ↓
Derived intelligence / feature service
        ↓
Web App | Developer API | MCP | B2B Data Feeds
        ↓
Free / Pro / higher tiers / developer & commercial entitlements
```

Future separately approved work should favor reusable intelligence functions across web, API and MCP. Important calculations should not exist only inside UI components. This direction does not authorize a refactor of the current collector or product.

## Evidence and trust rules

Preserve these distinctions across product and future programmatic surfaces:

- **Observed:** A directly stored provider or permitted contributor observation with provenance.
- **Derived:** A deterministic calculation from observations.
- **Experimental:** A research feature not validated as a reliable signal.
- **Unavailable:** Data FloatAlpha does not possess or cannot support.

Do not market correlations as predictive alpha before sufficient validation. Do not invent a proprietary “FloatAlpha Score” for marketing; establish evidence first. Unsupported real-time claims are also out of scope.

## Data maturity roadmap

The initial seven-day experiment is intended to establish collection reliability and support descriptive research. It does not by itself establish a mature commercial data moat. This strategy does not assert that the experiment has finished or passed its audit.

| Status / stage | Primary question or goal | Conditional business action |
| --- | --- | --- |
| CURRENT → NEXT: seven-day experiment | Does collection work reliably, and what price/listing/activity structures are useful? | Freeze, audit and research; no predictive claims |
| NEXT decision → later 30-day history | Are rolling features, lead/lag hypotheses, usefulness and retention supported? | Strengthen Pro intelligence and define API candidates |
| LATER: larger universe / more sources | Can scale and breadth be supported? | Expand only after storage/retention readiness and licensing review |
| LATER: contributor pilot | Do selected users add unique permitted data? | Invite a small verified cohort after review; measure incremental value |
| LATER: API beta | Is there external developer demand for derived intelligence? | Limited keys and quotas; learn from usage |
| LATER: MCP beta | Are agent research workflows useful? | Expose evidence-first tools |
| LATER: B2B/data feeds | Which professional use cases justify contracts? | Proceed only after rights and quality are established |

These are conditional stages, not delivery dates or implementation approvals. Experiment operations and constraints remain in the [waiting-week plan](../product/WAITING_WEEK.md) and [derived-market documentation](../derived-market/README.md).

## Monetization hypotheses

Pricing remains a hypothesis until retention and willingness to pay are measured. Earlier concepts proposed a lower Pro subscription first, then a higher power-user tier, followed by API/MCP/B2B as the data matures. No new price or entitlement is established here.

- Free supports acquisition and discovery.
- Pro is the first recurring-revenue layer for deeper intelligence.
- A higher tier / Platinum comes later, only when power-user functionality justifies it.
- API access prioritizes derived intelligence and usage limits.
- MCP may be bundled with Pro/developer access or separately metered; decide after understanding usage.
- B2B pricing reflects coverage, rights, freshness, history and volume.
- Contributor compensation is a data-acquisition cost and must demonstrate measurable return on investment.

## Strategic metrics

These are measurement goals, not claims that instrumentation or results already exist:

- Free-to-registered and registered-to-Pro conversion.
- Retention by user type.
- Steam connection rate during onboarding versus Settings.
- Connected-user versus unconnected-user retention.
- Contributor incremental unique-asset and data coverage.
- Contributor freshness, continuity and quality.
- Cost per useful contributed observation or asset.
- API active keys, requests, retained developers and high-value endpoints.
- MCP active users/agents, tool-call mix and repeat usage.
- Revenue by Web, API, MCP and B2B.
- Gross margin after provider, data and contributor costs.

## Legal and licensing dependencies

**REQUIRES LEGAL/LICENSING REVIEW** means an unresolved gate, not permission or a conclusion about what any platform allows. Before applicable initiatives proceed, establish:

- Steam/platform access terms and technical support for the specific data sought.
- Permission for collection, commercial use and contributor compensation.
- Upstream rights for raw, normalized and derived redistribution through APIs or feeds.
- Explicit consent, privacy disclosures, retention, revocation and deletion behavior.
- Appropriate authorization for personal account and portfolio access.

Keep ordinary account linking separate from contributor consent. Prefer aggregate intelligence over personal-data resale, and do not promise unsupported access or rights.

## Explicit non-goals

- No payments to all users merely for connecting Steam.
- No mandatory Steam authentication.
- No inventory or trade-history ingestion before technical and legal validation.
- No upstream raw-data sales without redistribution rights.
- No unsupported real-time, predictive-alpha or proprietary-score claims.
- No independent MCP data stack.
- No aggressive asset-universe expansion before storage/retention readiness.
- No monetization changes that modify or destabilize the production collector.
- No contributor payments, API billing, MCP implementation, new pricing or collector changes as part of storing this document.
- No attempt to implement this strategy as one large engineering project.

## Immediate next decision

**NEXT:** Complete the initial experiment, freeze the full seven-day dataset and audit it. Then determine what useful intelligence can be extracted from price, listing supply, volatility and activity. If useful structure is confirmed, consider extending the **same controlled universe** toward 30 days before making strong predictive or data-moat claims.

Use this strategy to keep future API, MCP and contributor options open. The immediate priority remains proving the intelligence layer; each later initiative requires its own decision and approval.
