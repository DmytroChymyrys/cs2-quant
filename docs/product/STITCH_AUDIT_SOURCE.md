# FloatAlpha (CS2 Market Intelligence) — Comprehensive Mockup Review & Design Audit Package

> **Instructions for Reviewer (ChatGPT / Senior Staff Product & Design Systems Auditor):**
> You are conducting an exhaustive, screen-by-screen design review, UX critique, and frontend implementation audit of **FloatAlpha**, an institutional-grade quantitative market analytics terminal for Counter-Strike 2 (CS2) digital assets.
>
> Below is the complete design specification, including the architectural principles, design system tokens, and **full visual and structural breakdowns of all 15 approved screens** (including their exact component hierarchies, data states, and layout blueprints).

---

## Table of Contents
1. [Product Overview & Architectural Mental Model](#1-product-overview--architectural-mental-model)
2. [Canonical Design System Specifications (`DESIGN.md`)](#2-canonical-design-system-specifications-designmd)
3. [Terminology Governance & Anti-Pattern Standards](#3-terminology-governance--anti-pattern-standards)
4. [Complete Screen Mockups & Visual Architecture](#4-complete-screen-mockups--visual-architecture)
   - [Screen 1: Market Overview Terminal (`/terminal`)](#screen-1-market-overview-terminal-terminal)
   - [Screen 2: CS2 Asset Screener (`/screener`)](#screen-2-cs2-asset-screener-screener)
   - [Screen 3: Asset Intelligence (`/asset/:id`)](#screen-3-asset-intelligence-assetid)
   - [Screen 4: CS2 Assets Explorer (`/assets`)](#screen-4-cs2-assets-explorer-assets)
   - [Screen 5: Watchlist Surveillance (`/watchlist`)](#screen-5-watchlist-surveillance-watchlist)
   - [Screen 6: Alerts & Quantitative Triggers (`/alerts`)](#screen-6-alerts--quantitative-triggers-alerts)
   - [Screen 7: Portfolio Intelligence & Risk Workstation (`/portfolio`)](#screen-7-portfolio-intelligence--risk-workstation-portfolio)
   - [Screen 8: New User Onboarding Flow (`/onboarding`)](#screen-8-new-user-onboarding-flow-onboarding)
   - [Screen 9: Account & Billing Console (`/settings`)](#screen-9-account--billing-console-settings)
   - [Screen 10: Public Landing Page (`/`)](#screen-10-public-landing-page-)
   - [Screen 11: Pricing & Capability Entitlements (`/pricing`)](#screen-11-pricing--capability-entitlements-pricing)
   - [Screen 12: Authentication — Sign In (`/login`)](#screen-12-authentication--sign-in-login)
   - [Screen 13: Authentication — Create Account (`/signup`)](#screen-13-authentication--create-account-signup)
   - [Screen 14: Authentication — Forgot Password (`/forgot-password`)](#screen-14-authentication--forgot-password-forgot-password)
   - [Screen 15: System States & Component Behavior Board](#screen-15-system-states--component-behavior-board)
5. [Targeted Review Questions & Prompts for ChatGPT](#5-targeted-review-questions--prompts-for-chatgpt)
6. [Expected Review Output Framework](#6-expected-review-output-framework)

---

## 1. Product Overview & Architectural Mental Model

* **Product Name:** FloatAlpha
* **Descriptor / Sub-brand:** CS2 Market Intelligence
* **Target Users:** Serious digital asset investors, algorithmic traders, quantitative analysts, market makers, and high-capital portfolio managers holding significant inventory in virtual economies.
* **Mental Model:** *Bloomberg Terminal × TradingView × Finviz × Koyfin* adapted specifically for virtual asset economies.
* **Core Philosophy:** Grounded credibility, institutional density, neutral mathematical terminology, and strict avoidance of gaming, gambling, or speculative crypto tropes.
* **Data Posture:** Honest provenance — explicitly separating verified raw venue observations (Skinport API ingestion pipeline) from derived statistical models and experimental benchmarks. Non-custodial tracking with zero fake Steam sync claims.

---

## 2. Canonical Design System Specifications (`DESIGN.md`)

### 2.1 Surfaces & Geometry
* **Root Background Canvas:** `#080B10`
* **Primary Panels & Cards:** `#0E121A` (border: `1px solid #263145`, radius: `4px` / `rounded`)
* **Elevated Surfaces / Headers:** `#141923`
* **Input Fields:** `#111622` (border: `#263145`, focus ring: `#00B4D8`)
* **Hover State:** `#1A2232`
* **Active State:** `#202B3F`
* **Dividers & Hairlines:** `1px solid #1B2230`
* **Shadows:** Flat architecture; zero decorative drop shadows. Modals/tooltips use `0 4px 16px rgba(0, 0, 0, 0.65), 0 0 0 1px #263145`.

### 2.2 Typography & Formatting
* **Structural & Body Font:** Inter (`font-sans`), weights 400, 500, 600, 700, 800.
* **Numerical Metrics, Codes & Timestamps:** JetBrains Mono (`font-mono`, tabular numbers `tabular-nums`).
* **Currency Formatting:** Tabular dollar notation with cents on sub-$1000 items (`$5,480.00`, `$920.00`, `$1.13`).
* **Delta Formatting:** Always signed with directional arrows (`+1.42% ↑`, `-3.10% ↓`).
* **Standard Deviations / Multipliers:** Represented with Greek $\sigma$ (`3.8σ`, `2.1σ`).

### 2.3 Semantic Color Tokens
* **Brand / Focus Accent:** `#00B4D8` (Cyan) — active indicator tabs, focus outlines, primary line charts.
* **Advancing / Positive:** `#10B981` (Emerald) — net supply accumulation, positive 24h price movement.
* **Declining / Negative:** `#EF4444` (Crimson) — net supply contraction, negative price deltas.
* **Warning / Latency / Medium:** `#F59E0B` (Amber) — data latency warnings, low observation depth.
* **Text Hierarchy:** Primary `#F1F5F9` | Secondary `#94A3B8` | Muted `#64748B` | Disabled `#475569`.

---

## 3. Terminology Governance & Anti-Pattern Standards

FloatAlpha strictly enforces a regulatory-grade vocabulary standard across all UI copy:

| ❌ Strictly Prohibited (Gaming / Hype / Speculative) |  Mandatory Approved Replacement (Neutral & Factual) |
| :--- | :--- |
| `Buy / Strong Buy / Buy Signal` | `Volume Spike (Z-Score > 3.0σ)` / `Activity Accelerating` |
| `Sell / Dump` | `Supply Contraction` / `Net Listing Depletion` |
| `Bullish / Bearish` | `Advancing Breadth (>50%)` / `Declining Breadth (>50%)` |
| `Undervalued / Overvalued` | `Trading Below 30D VWAP` / `Historical High Percentile` |
| `Fair Value / Target Price` | `Volume-Weighted Benchmark` / `Median Venue Price` |
| `Moon / To the Moon / Crash` | `24H Volatility > +18.4%` / `Max Drawdown Exceeded` |
| `Accumulation Zone` | `Net Listing Decline + Activity Acceleration` |
| `Total CS2 Market Cap ($4.8B)` | `Tracked Sample Value ($482.6K / 100 SKUs)` |

---

## 4. Complete Screen Mockups & Visual Architecture

---

### Screen 1: Market Overview Terminal (`/terminal`)
* **Reference Asset ID:** `{{DATA:SCREEN:SCREEN_25}}`
* **Route:** `/terminal`
* **Target Viewport:** 1440px desktop, fixed 12-column terminal grid.

```
+----------------------------------------------------------------------------------------------------------------+
| TOP NAVIGATION: [Logo] FLOATALPHA v4.19 | Terminal* Screener Assets Watchlist Portfolio Alerts | Search [/] | Pro |
+----------------------------------------------------------------------------------------------------------------+
| MACRO RIBBON (6 Cells): Total Obs Value | 24H Volume | Market Breadth | 30D Volatility | Median Delta | Quorum |
+-----------------------------------------------------------------------+----------------------------------------+
|                                                                       | MARKET BREADTH GAUGE (140px)           |
| FLOATALPHA CS2 100-ASSET COMPOSITE INDEX CHART (440px)                | Advancing 58% | Unchanged 6% | Dec 36% |
| - Cyan primary index line + 30D SMA benchmark (dashed slate)          +----------------------------------------+
| - Volume histogram bars (Emerald positive / Crimson negative)         | TOP MOVERS (5 Rows, Tabular, 200px)    |
| - Timeframe segment: 24H | 7D | 30D | 90D | 1Y                        +----------------------------------------+
| - Scope Tag: [PILOT 100-SKU BENCHMARK • SKINPORT GROUNDED]            | ACTIVITY LEADERS (4 Rows, ~100px)      |
+-----------------------------------+-----------------------------------+----------------------------------------+
| SUPPLY CONTRACTION MONITOR (360px)| VOLUME ANOMALIES (Z > 2.0σ)       | [Right rail extends to bottom]         |
| 8 rows, 34px height, listing deltas| 8 rows, 34px height, z-scores     |                                        |
+-----------------------------------+-----------------------------------+----------------------------------------+
| STATUS BAR (30px): Quorum 99.8% Sync • Skinport Feed • Latency 14ms • Hotkeys: [/] Search [T] Term [S] Screen        |
+----------------------------------------------------------------------------------------------------------------+
```

#### Key Visual Components & Layout Elements:
1. **Top Navigation (48px):** Brand wordmark + `v4.19` badge, horizontal primary tabs (`Terminal`, `Screener`, `Assets`, `Watchlist`, `Portfolio`, `Alerts`), global search dock (`/`), verified data quorum badge (`99.8% DATA COVERAGE`), and user tier badge (`PRO ANALYST`).
2. **Macro Status Ribbon (68px):** 6 compact cells displaying Total Observed Sample Value (`$482,610.00`), 24H Volume (`$38,420.00`), Advancing Breadth (`58.0% Advancing`), 30D Volatility (`14.2%`), Median Listing Delta (`-2.4%`), and Venue Coverage Quorum (`100 SKUs Verified`).
3. **Primary Index Chart:** Dual-line financial chart displaying the 100-SKU composite index curve with volume sub-histogram, High/Low extreme pills, and timeframe toggles.
4. **Right Intelligence Rail:** Market breadth horizontal segmented bar, top advancing/declining movers with signed percentages, and activity leaders.
5. **Dual Bottom Analytical Tables:** 8-row Supply Contraction Monitor and 8-row Volume Anomalies Table with 34px row heights, monospace tabular numbers, and category filter pills (`ALL`, `CASES`, `WEAPONS`, `KNIVES`, `GLOVES`, `STICKERS`).
6. **Footer Status Bar (30px):** Provenance telemetry, engine latency (`14ms`), and interactive keyboard shortcuts (`/`, `T`, `S`, `Esc`).

---

### Screen 2: CS2 Asset Screener (`/screener`)
* **Reference Asset ID:** `{{DATA:SCREEN:SCREEN_22}}`
* **Route:** `/screener`
* **Target Viewport:** 1440px desktop, multi-variable query dock + tabular data grid.

```
+----------------------------------------------------------------------------------------------------------------+
| TOP NAVIGATION (Same persistent app chrome)                                                                    |
+----------------------------------------------------------------------------------------------------------------+
| FILTER DOCK: Categories (Pills) | Wear (FN, MW, FT, WW, BS) | Float Range [0.00 - 1.00] | Min Price | Anomaly Flags |
+----------------------------------------------------------------------------------------------------------------+
| ACTIVE QUERY SUMMARY: 142 SKUs Matching • Sort: [24H Volume Desc] • Export CSV • Saved Screens [Default Pro]   |
+----------------------------------------------------------------------------------------------------------------+
| HIGH-DENSITY QUANTITATIVE DATA TABLE (14 Columns, 34px Rows):                                                  |
| Asset | Category | Wear | Floor Price | 24H Delta | 7D VWAP | 24H Vol | Active Listings | Net Delta | Confidence | Signal |
| - Tabular JetBrains Mono numbers, right-aligned monetary values                                                |
| - Signal badges: SUPPLY CONTRACTING (cyan), VOLUME SPIKE (emerald), ACTIVITY ACCELERATING (blue)               |
| - Price Confidence: HIGH (green dot), MED (cyan dot), LOW (amber dot)                                          |
+----------------------------------------------------------------------------------------------------------------+
| PAGINATION & STATUS: Showing 1-25 of 142 Assets | Ingestion Latency 14ms | Skinport Verified Quorum              |
+----------------------------------------------------------------------------------------------------------------+
```

#### Key Visual Components & Layout Elements:
1. **Multi-Parameter Filter Dock:** Category segmented pills, wear tier selector, range sliders for float tolerances (`0.00` to `1.00`), bid/ask spread tolerance, and anomaly triggers (`Volume Z > 2.0σ`, `Rapid Listing Depletion`).
2. **Dense 14-Column Table:** Complete institutional metrics including 24H Volume, Active Venue Depth, 7D VWAP Drift, Listing Depletion Velocity, and Price Confidence classification.
3. **SignalBadges:** Inline monospace chips (`SUPPLY CONTRACTING`, `VOLUME SPIKE`, `PRICE MOMENTUM`).
4. **Data Confidence Indicator:** High/Med/Low classification based on order book depth without predictive speculation.

---

### Screen 3: Asset Intelligence (`/asset/:id`)
* **Reference Asset ID:** `{{DATA:SCREEN:SCREEN_20}}` (Reference: `AK-47 | Fire Serpent`)
* **Route:** `/asset/ak47-fire-serpent`
* **Target Viewport:** 1440px desktop, asset surveillance cockpit.

```
+----------------------------------------------------------------------------------------------------------------+
| TOP NAVIGATION (Same persistent app chrome)                                                                    |
+----------------------------------------------------------------------------------------------------------------+
| ASSET HEADER: AK-47 | Fire Serpent (Covert Rifle, Operation Bravo) • Floor: $920.00 (+3.2% 24H) • Track [★]   |
+------------------------------------------------------+---------------------------------------------------------+
| HISTORICAL PRICING & VOLUME (420px)                  | ORDER BOOK DEPTH LADDER (L1/L2 Liquidity)               |
| - 7D / 30D / 90D VWAP line with rolling deviation    | - Bid / Ask depth columns with cumulative bar fills     |
| - Daily execution volume histogram                   | - Spread: 1.42% ($13.10) • Confidence: HIGH             |
+------------------------------------------------------+---------------------------------------------------------+
| FLOAT VALUE DISTRIBUTION HISTOGRAM                   | COMPARABLE ASSET CORRELATION MATRIX                     |
| - Float range bins (0.00 to 0.70)                    | - Correlation vectors with M4A4 Howl, AWP Desert Hydra   |
| - Active listings mapped against wear brackets       | - 30D rolling beta & covariance metrics                 |
+------------------------------------------------------+---------------------------------------------------------+
| BOTTOM ACTIONS & AUDIT: Condition Alert Trigger | Download Ingestion Ledger (CSV) | Provenance: Skinport API   |
+----------------------------------------------------------------------------------------------------------------+
```

#### Key Visual Components & Layout Elements:
1. **Asset Identity Banner:** High-resolution asset descriptor, rarity tag (`Covert Rifle`), collection origin (`Operation Bravo`), live floor price with signed 24h delta, and Watchlist trigger.
2. **Order Book Depth Ladder:** Level-2 bid/ask depth visualization with horizontal liquidity volume bars and explicit bid/ask spread monitoring.
3. **Float Distribution Curve:** Wear bracket breakdown mapping observed inventory across Factory New, Minimal Wear, Field-Tested, Well-Worn, and Battle-Scarred thresholds.
4. **Historical Microstructure Panel:** 7D and 30D volume-weighted price trends, median drift calculations, and statistical standard deviation overlays.
5. **Correlation Matrix:** Quantitative beta and price covariance comparisons against peer assets in the same market sector.

---

### Screen 4: CS2 Assets Explorer (`/assets`)
* **Reference Asset ID:** `{{DATA:SCREEN:SCREEN_10}}`
* **Route:** `/assets`
* **Target Viewport:** 1440px desktop, broad multi-category catalog & quick inspection drawer.

```
+----------------------------------------------------------------------------------------------------------------+
| TOP NAVIGATION (Same persistent app chrome)                                                                    |
+----------------------------------------------------------------------------------------------------------------+
| SEARCH & CATEGORY BAR: Global SKU Search | Cases | Weapons | Knives | Gloves | Stickers | Sort by Market Depth  |
+-------------------------------------------------------------------+--------------------------------------------+
| MAIN ASSET CATALOG GRID (Table / Card hybrid)                    | QUICK INSPECTION DOCK (360px persistent)   |
| - Asset name & high-contrast preview thumbnail                    | - Selected Asset: Butterfly Knife | Fade   |
| - Wear condition pill group (FN, MW, FT, WW, BS)                  | - Active Listings Count: 34 Units          |
| - 24H Price delta & transaction velocity                          | - Order Book Depth Gauge (L1/L2)           |
| - Active listing depth badge & liquidity confidence               | - 7D Mini Trend Sparkline                  |
| - Hover triggers instant update of right inspection dock          | - Direct Actions: [View Intel] [Add Alert] |
+-------------------------------------------------------------------+--------------------------------------------+
| FOOTER STATUS: 3,240 Total SKUs Ingested • Realized Sample: 100 SKUs Grounded • Engine: v4.19-LTS              |
+----------------------------------------------------------------------------------------------------------------+
```

#### Key Visual Components & Layout Elements:
1. **Exploration Grid:** High-density list featuring 100 verified SKUs with wear condition badges and instantaneous price deltas.
2. **Persistent 360px Inspection Dock:** Selecting or hovering any row instantly hydrates the right dock with active listing counts, order book depth, mini-sparklines, and deep-dive shortcuts.
3. **Category Breadcrumb Filtering:** Rapid filtering across weapons, knives, gloves, cases, and tournament sticker capsules.

---

### Screen 5: Watchlist Surveillance (`/watchlist`)
* **Reference Asset ID:** `{{DATA:SCREEN:SCREEN_9}}`
* **Route:** `/watchlist`
* **Target Viewport:** 1440px desktop, customized asset surveillance grid.

```
+----------------------------------------------------------------------------------------------------------------+
| TOP NAVIGATION (Same persistent app chrome)                                                                    |
+----------------------------------------------------------------------------------------------------------------+
| WATCHLIST HEADER: My Institutional Watchlist (8 Tracked Assets) • Last Visit Delta: +$1,240.00 • Manage Lists  |
+----------------------------------------------------------------------------------------------------------------+
| SURVEILLANCE DATA GRID:                                                                                        |
| Asset Name | Condition | Tracked Since | Spot Price | Δ Since Added | 24H Net Listing Δ | Signals | Actions   |
| - AWP | Dragon Lore (FT)  | $4,120.00  | +8.4% (+$320.00) | -4 Listings (Depleting)  | [SUPPLY CONTRACTING]  |
| - M4A4 | Howl (MW)         | $3,650.00  | -1.2% (-$44.00)  | +1 Listing (Neutral)     | [LOW VOLATILITY]      |
| - Karambit | Case Hardened| $1,280.00  | +0.4% (+$5.00)   | 0 Listings (Unchanged)   | [PRICE MOMENTUM]      |
+----------------------------------------------------------------------------------------------------------------+
| BATCH MONITORING CONTROLS: Set Price Alerts | Set Depletion Trigger | Export CSV | Clear Inactive Assets       |
+----------------------------------------------------------------------------------------------------------------+
```

#### Key Visual Components & Layout Elements:
1. **Portfolio-Style Delta Tracking:** Tracks price and supply drift specifically since the user added the asset to their watchlist.
2. **Net Listing Depletion Tracking:** Monitors listing supply contractions in real time.
3. **Batch Surveillance Actions:** One-click triggers to assign quantitative alert rules across all tracked inventory.

---

### Screen 6: Alerts & Quantitative Triggers (`/alerts`)
* **Reference Asset ID:** `{{DATA:SCREEN:SCREEN_8}}`
* **Route:** `/alerts`
* **Target Viewport:** 1440px desktop, algorithmic condition rule dispatch console.

```
+----------------------------------------------------------------------------------------------------------------+
| TOP NAVIGATION (Same persistent app chrome)                                                                    |
+----------------------------------------------------------------------------------------------------------------+
| ALERTS HEADER: Quantitative Surveillance Daemon • Active Rules: 4 • Collecting: 1 • Paused: 1 • [+ New Alert]  |
+----------------------------------------------------------------------------------------------------------------+
| ACTIVE RULES MONITOR:                                                                                          |
| Target Asset | Rule Condition Trigger               | Current Metric | Threshold | Status      | Destinations |
| AK-47 Fire S | Listing Depletion Velocity > 3/hr    | 4.2 / hr       | 3.0 / hr  | [ACTIVE]    | Webhook, In-App|
| AWP Gungnir  | 30D Volatility Exceedance            | 22.4%          | 18.0%     | [ACTIVE]    | Email, Webhook |
| Butterfly F  | Order Book Bid Wall Depleted (<$1.8k)| $1,840.00      | $1,800.00 | [ACTIVE]    | In-App Only  |
| Case Hardened| 7D Listing History Accumulation      | 1D 04H Obs     | 7D Req    | [COLLECTING]| Standby      |
+----------------------------------------------------------------------------------------------------------------+
| ALERT DISPATCH SETTINGS: Webhook URL Configuration | SMTP Relay Integrity | Daily Digest Delivery Timing       |
+----------------------------------------------------------------------------------------------------------------+
```

#### Key Visual Components & Layout Elements:
1. **Algorithmic Condition Engine:** Rules based on mathematically verifiable triggers (e.g., listing depletion velocity, volatility spikes, order book wall removal) rather than crude price-only alerts.
2. **Lifecycle Status Indicators:** Clear separation between `ACTIVE`, `COLLECTING` (waiting for historical observation window to accumulate), and `PAUSED`.
3. **Multi-Channel Dispatch:** Webhook endpoints, in-app notifications, and instant email triggers.

---

### Screen 7: Portfolio Intelligence & Risk Workstation (`/portfolio`)
* **Reference Asset ID:** `{{DATA:SCREEN:SCREEN_7}}`
* **Route:** `/portfolio`
* **Target Viewport:** 1440px desktop, institutional portfolio exposure workstation.

```
+----------------------------------------------------------------------------------------------------------------+
| TOP NAVIGATION (Same persistent app chrome)                                                                    |
+----------------------------------------------------------------------------------------------------------------+
| PORTFOLIO METRICS (4 Large Cards):                                                                             |
| Total Observed Value: $24,850.00 | 24H Unrealized Δ: +$420.00 (+1.7%) | Top 3 Concentration: 58.2% | Assets: 14 |
+------------------------------------------------------+---------------------------------------------------------+
| VALUE BY PRICE CONFIDENCE LIQUIDITY BREAKDOWN        | CONCENTRATION & SECTOR EXPOSURE AUDIT                   |
| - High Depth Liquidity: $15,410.00 (62.0%)           | - Knives: 42.4% ($10,540.00)                            |
| - Medium Depth Liquidity: $5,020.00 (20.2%)          | - Covert Rifles: 31.8% ($7,900.00)                      |
| - Low Depth / Thin Book: $4,420.00 (17.8%)           | - Discontinued Cases: 25.8% ($6,410.00)                 |
+------------------------------------------------------+---------------------------------------------------------+
| HOLDINGS INVENTORY AUDIT TABLE (Tabular, Monospace Cost Basis):                                                |
| Asset Name | Condition | Qty | Floor Spot | Total Observed | Cost Basis | Unrealized P&L | Confidence Tier     |
| (Assets marked COST NOT PROVIDED maintain rigorous value totals without fabricating purchase prices)            |
+----------------------------------------------------------------------------------------------------------------+
| NON-CUSTODIAL DISCLOSURE: Manual entry & CSV lot import only. Never requests Steam credentials or trade URLs. |
+----------------------------------------------------------------------------------------------------------------+
```

#### Key Visual Components & Layout Elements:
1. **Institutional Exposure Surveillance:** Answers *"What market exposure do I hold across owned digital assets?"*
2. **Total Observed Value ($\sum \text{Qty} \times \text{Spot}$):** Explicitly ground-truthed against current floor prices.
3. **Value by Price Confidence Breakdown:** Classifies holdings into High, Med, and Low liquidity depth so fund managers understand exit slippage risks.
4. **Strict Non-Custodial Posture:** Manual entry and CSV lot import; zero fake Steam API sync claims.
5. **Cost-Basis Integrity:** Missing purchase prices are explicitly tagged `COST NOT PROVIDED` rather than guessing.

---

### Screen 8: New User Onboarding Flow (`/onboarding`)
* **Reference Asset ID:** `{{DATA:SCREEN:SCREEN_13}}`
* **Route:** `/onboarding`
* **Target Viewport:** 1440px desktop, 3-step coordinated configuration wizard.

```
+----------------------------------------------------------------------------------------------------------------+
| HEADER: FLOATALPHA | Step Indicator: [01 INTERESTS] ===> [02 CRITERIA] ===> [03 COMPLETE]                      |
+----------------------------------------------------------------------------------------------------------------+
| STEP 01: SELECT MARKET SECTORS OF INTEREST (Choose categories to focus terminal surveillance)                 |
| [X] Cases & Discontinued Containers     [X] Covert & Classified Rifles     [X] Rare Finishes & Knives         |
| [ ] Sport & Specialist Gloves           [X] Major Holos & Tournament Capsules                                  |
+----------------------------------------------------------------------------------------------------------------+
| STEP 02: SELECT SURVEILLANCE ANOMALY TRIGGERS                                                                  |
| [X] Rapid Listing Depletion (Supply Contraction)      [X] Volume Spikes (Z-Score > 2.0σ)                       |
| [X] 30D Annualized Volatility Thresholds              [ ] Price / Supply Divergence Tracking                   |
+----------------------------------------------------------------------------------------------------------------+
| STEP 03: TERMINAL INITIALIZATION                                                                              |
| - Configuring default 1440px terminal grid                                                                     |
| - Calibrating 100-SKU Skinport grounded baseline                                                              |
| [CONTINUE TO TERMINAL →]                                                                 [Skip to default]     |
+----------------------------------------------------------------------------------------------------------------+
```

#### Key Visual Components & Layout Elements:
1. **Coordinated 3-Step Breadcrumb:** Clear visual roadmap (`01 INTERESTS`, `02 CRITERIA`, `03 COMPLETE`).
2. **Factual Preference Configuration:** Tailors initial dashboard presets without modifying underlying market observations.
3. **Instant Terminal Launch:** Transparent baseline initialization into the live terminal workspace.

---

### Screen 9: Account & Billing Console (`/settings`)
* **Reference Asset ID:** `{{DATA:SCREEN:SCREEN_5}}`
* **Route:** `/settings`
* **Target Viewport:** 1440px desktop, calm 2-column configuration console.

```
+----------------------------------------------------------------------------------------------------------------+
| TOP NAVIGATION (Same persistent app chrome)                                                                    |
+----------------------------------------------------------------------------------------------------------------+
| LEFT INDEX (280px)  | MAIN CONFIGURATION AREA (Generous whitespace, calm utility UI)                           |
| 01 ACCOUNT          | 01 ACCOUNT IDENTITY: analyst@floatalpha.com [VERIFIED] • Argon2 Hash Derivation          |
| 02 PREFERENCES      | 02 MARKET PREFERENCES: Edit followed sectors & anomaly triggers (Reset / Save)           |
| 03 SUBSCRIPTION     | 03 SUBSCRIPTION & BILLING: FLOATALPHA PRO ($14.99/mo) • Next Invoice: Nov 14, 2025      |
| 04 SECURITY         |    - [MANAGE BILLING (STRIPE PORTAL) ↗] • Entitlement comparison matrix (Free vs Pro)   |
| ! DANGER ZONE       | 04 SECURITY & SESSIONS: Master password (rotated 42d ago) • Active Chrome & PWA sessions |
|                     | ! DANGER ZONE: Permanent Account Erasure (Type "DELETE" confirmation modal)              |
+----------------------------------------------------------------------------------------------------------------+
```

#### Key Visual Components & Layout Elements:
1. **Calm Utility Layout:** Purged of live chart streams and tickers to maximize focus on account security and settings.
2. **Stripe Customer Portal Integration:** Explicitly discloses that credit cards are managed via Stripe; no fabricated in-app card inputs.
3. **Entitlement Matrix:** Objective feature-by-feature comparison of Free vs. Pro Analyst tiers.
4. **Security & Session Management:** Argon2 password verification, active device management, and NIST SP 800-63B hygiene notices.
5. **Irreversible Danger Zone:** Strict, multi-step account erasure with retention SLA disclosures.

---

### Screen 10: Public Landing Page (`/`)
* **Reference Asset ID:** `{{DATA:SCREEN:SCREEN_19}}`
* **Route:** `/`
* **Target Viewport:** 1440px desktop, institutional marketing surface.

```
+----------------------------------------------------------------------------------------------------------------+
| PUBLIC NAV: [Logo] FLOATALPHA | Platform  Methodology  Pricing  Data Provenance | [Sign In] [EXPLORE TERMINAL] |
+----------------------------------------------------------------------------------------------------------------+
| HERO SECTION:                                                                                                  |
| Quantitative Market Intelligence for Digital Virtual Economies                                                |
| Institutional valuation architecture, high-density order book feeds, and algorithmic market surveillance.      |
| [LAUNCH TERMINAL →]   [VIEW METHODOLOGY DISCLOSURE]                                                            |
+----------------------------------------------------------------------------------------------------------------+
| LIVE TERMINAL FEATURE PREVIEWS: High-density interactive teasers of the 100-SKU Index, Screener, and Depth    |
+----------------------------------------------------------------------------------------------------------------+
| DATA PROVENANCE & COVERAGE TRANSPARENCY: Skinport Ingestion Pipeline • Quorum Verification • Zero Gaming Cliché|
+----------------------------------------------------------------------------------------------------------------+
| FOOTER: Valve Corporation Non-Affiliation Disclaimer • Terms of Service • Privacy Policy • Status Engine       |
+----------------------------------------------------------------------------------------------------------------+
```

#### Key Visual Components & Layout Elements:
1. **Institutional Value Proposition:** Framed for serious capital allocators and quantitative researchers.
2. **Live Teaser Widgets:** Non-hyperbolic product screenshots showcasing genuine terminal density.
3. **Regulatory & Provenance Transparency:** Full disclosure of data sources, calculation methodologies, and Valve Corporation disclaimers.

---

### Screen 11: Pricing & Capability Entitlements (`/pricing`)
* **Reference Asset ID:** `{{DATA:SCREEN:SCREEN_18}}`
* **Route:** `/pricing`
* **Target Viewport:** 1440px desktop, factual pricing & capability tier matrix.

```
+----------------------------------------------------------------------------------------------------------------+
| PUBLIC NAV (Same persistent marketing chrome)                                                                  |
+----------------------------------------------------------------------------------------------------------------+
| PRICING HEADER: Factual Institutional Pricing • No Hidden Fees • Cancel Anytime via Stripe                     |
+------------------------------------------------------+---------------------------------------------------------+
| FREE ANALYST ($0 / month)                            | FLOATALPHA PRO ($14.99 / month)                         |
| Core Market Overview Terminal                        | Complete Terminal Suite + Screener Multi-Variable Query |
| 100-SKU Grounded Pilot Universe                      | Full Historical Ingestion Depth & CSV Raw Exports       |
| Basic Price Screener & 1 Condition Alert             | Unlimited Real-Time Condition Alerts (Email + Webhook)  |
| 5 Watchlist Assets                                   | Unlimited Watchlists + Last-Visit Price Drift Tracking  |
| Basic Manual Portfolio Lots                          | Portfolio Risk Rail, Concentration Audit & Liquidity Tier|
| [GET STARTED FREE]                                   | [UPGRADE TO PRO ANALYST →]                              |
+------------------------------------------------------+---------------------------------------------------------+
| FAQ & BILLING INTEGRITY: Stripe Customer Portal Guarantee • Non-Custodial Data SLA • Enterprise Seat Calculator|
+----------------------------------------------------------------------------------------------------------------+
```

#### Key Visual Components & Layout Elements:
1. **Factual Tier Breakdown:** No artificial urgency timers or crossed-out fake prices.
2. **Direct Stripe Integration:** Plain explanation of billing mechanics and subscription cancellation.
3. **Self-Serve Team Seat Calculator:** Transparent pricing estimation for institutional desks.

---

### Screen 12: Authentication — Sign In (`/login`)
* **Reference Asset ID:** `{{DATA:SCREEN:SCREEN_15}}`
* **Route:** `/login`
* **Target Viewport:** 1440px desktop, split-pane authentication layout.

```
+----------------------------------------------------------------------------------------------------------------+
| LEFT TEASER (55%): Terminal Telemetry Teaser         | RIGHT AUTH FORM (45%):                                  |
| - Live 100-SKU Composite Index mini chart preview    | - Header: Welcome Back to FloatAlpha                    |
| - Macro market breadth status summary                | - Email Input field (with validation state)             |
| - Institutional security commitment note             | - Password Input field (with show/hide toggle)          |
|                                                      | - [ ] Remember session for 30 days                      |
|                                                      | - [SIGN IN TO TERMINAL →]                               |
|                                                      | - Google Workspace Single Sign-On button                |
|                                                      | - Links: [Create an account] [Forgot password?]         |
+----------------------------------------------------------------------------------------------------------------+
```

---

### Screen 13: Authentication — Create Account (`/signup`)
* **Reference Asset ID:** `{{DATA:SCREEN:SCREEN_17}}`
* **Route:** `/signup`
* **Target Viewport:** 1440px desktop, split-pane registration flow.

```
+----------------------------------------------------------------------------------------------------------------+
| LEFT TEASER (55%): Entitlement & Security Overview   | RIGHT REGISTRATION FORM (45%):                          |
| - 14-day Pro trial entitlement disclosure            | - Work Email Address Input                              |
| - Non-custodial privacy commitment                   | - Password Input + NIST SP 800-63B Entropy Meter        |
| - Quorum verified telemetry preview                  | - [X] Agreement to Terms of Service & Privacy Policy    |
|                                                      | - [CREATE FLOATALPHA ACCOUNT →]                         |
|                                                      | - Transition immediately into 3-step Onboarding flow    |
+----------------------------------------------------------------------------------------------------------------+
```

---

### Screen 14: Authentication — Forgot Password (`/forgot-password`)
* **Reference Asset ID:** `{{DATA:SCREEN:SCREEN_16}}`
* **Route:** `/forgot-password`
* **Target Viewport:** 1440px desktop, focused recovery console.

```
+----------------------------------------------------------------------------------------------------------------+
| CENTERED MODAL / CONSOLE:                                                                                      |
| - Title: Reset Master Access Credentials                                                                       |
| - Subtitle: Enter your verified email to receive a rate-limited cryptographic password reset link.             |
| - Email Input Field (`analyst@company.com`)                                                                    |
| - [DISPATCH RESET LINK →]                                                                                      |
| - Safety notice: Links expire in 15 minutes; maximum 3 dispatch attempts per hour.                             |
| - [← Return to Sign In]                                                                                        |
+----------------------------------------------------------------------------------------------------------------+
```

---

### Screen 15: System States & Component Behavior Board
* **Reference Asset ID:** `{{DATA:SCREEN:SCREEN_3}}`
* **Purpose:** The definitive 1440px design-specification board formalizing all 27 application edge states for frontend developers.

#### The 27 Formalized Edge States:
1. **Skeletons & Hydration (Req 1):** Zero Cumulative Layout Shift (`CLS = 0.0000 STRICT`). Skeletons match exact hydrated geometry (68px metric card, 34px table row, 360px rail, 320px chart).
2. **Collecting History (Req 2):** Timeframe buttons with `COLLECTING (1D 04H)` labels; table cells displaying collection status without showing blank DOM elements.
3. **Insufficient History (Req 3):** Compact hover disclosure card explaining why 30D rolling volatility requires more observation history without triggering an error alarm.
4. **No Data vs. Zero (Req 4):** Explicit visual distinction between `— UNAVAILABLE` (missing data) and a legitimate `0.00% / 0 Tx` (zero value).
5. **Stale Data Treatment (Req 5):** Unified persistent banner (`DATA STALE // Global deviation warning — last observation 27m ago`), status bar warning, and cached metric display.
6. **Source Degraded (Req 6):** Amber non-catastrophic notice for ingestion pipeline delays with `VIEW DATA STATUS` action.
7. **Source Unavailable (Req 7):** Circuit-breaker state preserving historical data while marking live feeds unavailable.
8. **Network Error (Req 8):** `UNABLE TO LOAD THIS VIEW` with retry triggers while keeping global navigation usable.
9. **General Application Error (Req 9):** Isolated widget crash boundary (`SOMETHING WENT WRONG`) preventing full-page crashes.
10. **Filter Exhaustion (Req 10):** `NO ASSETS MATCH` with `CLEAR FILTERS` and `RESET SCREEN` actions.
11. **Empty Watchlist (Req 11):** `YOUR WATCHLIST IS EMPTY` with descriptive preview and browsing shortcuts.
12. **Empty Portfolio (Req 12):** `BUILD YOUR PORTFOLIO VIEW` with non-custodial disclosures and manual lot add CTA.
13. **Empty Alerts (Req 13):** `NO SURVEILLANCE RULES` with template library triggers.
14. **Alert Inactive / Collecting (Req 14):** Explicit rule status: `STATUS: COLLECTING (Requires 7D listing-change history)`.
15. **Pro Locked (Req 15):** Inline locked condition builder with `UPGRADE TO PRO` trigger without full-page blur or hijacking modals.
16. **Auth Required Gating (Req 16):** Contextual sign-in prompt explaining the specific feature being unlocked.
17. **Rate Limited (Req 17):** Restrained HTTP 429 countdown banner without internal threshold exposure.
18. **Form Validation Matrix (Req 18):** 6 primitives (Text Search, Numeric, Select, Rule Clause, Password, Checkbox) across 6 lifecycle states (`Default`, `Focused`, `Valid`, `Invalid`, `Disabled`, `Loading`).
19. **Button State Matrix (Req 19):** Complete token specifications for Primary, Secondary, Ghost, Danger, and Pro buttons.
20. **Feedback Toasts (Req 20):** Compact transient notifications for Success, Info, Warning, and Error operations.
21. **Data Semantic Tokens (Req 21):** Visual standards distinguishing `GROUNDED`, `DERIVED`, `EXPERIMENTAL`, `COLLECTING`, `UNAVAILABLE`, and `STALE`.
22. **Price Confidence Classification (Req 22):** High (spread <1.2%), Medium (1.2%–4.5%), and Low (>4.5%, thin book) liquidity ratings without numerical score fabrications.
23. **SignalBadge Vocabulary (Req 23):** Canonical tokens (`SUPPLY CONTRACTING`, `VOLUME SPIKE`, `ACTIVITY ACCELERATING`) and explicit ban on hype terms (`BUY`, `SELL`, `BULLISH`, `BEARISH`).
24. **Destructive Confirmation Hierarchy (Req 24):** 3 tiers: Level 1 (inline alert deletion), Level 2 (portfolio holding deletion with loss warning), Level 3 (type `"DELETE"` account erasure).
25. **Responsive Adaptations (Req 25):** Detailed behavior across 1440px desktop, 1280px compact, 1024px landscape, and <768px mobile.
26. **404 Resource Not Found (Req 26):** Restrained missing resource card with direct terminal and asset search links.
27. **Maintenance & System Outage (Req 27):** Honest downtime notice with data preservation assurances.

---

## 5. Targeted Review Questions & Prompts for ChatGPT

When reviewing this design package, evaluate the design against these four core dimensions:

1. **Information Architecture & Density:**
   - *Does the 1440px layout strike the optimal balance between high-signal financial density (TradingView/Bloomberg) and modern visual scannability?*
   - *Are data tables readable with 34px row heights, and is tabular alignment preserved via monospace fonts across currency, percentages, and standard deviations?*

2. **Compliance with Grounding & Financial Credibility:**
   - *Are there any residual gaming or crypto tropes (e.g., hype terms like 'moon', speculative ratings like 'buy/sell', lootbox motifs)?*
   - *Does the UI clearly distinguish between grounded observations, derived metrics, and collecting states without misleading the user?*

3. **Microstructure & Risk Communication:**
   - *Is the 'Value by Price Confidence' paradigm (High/Med/Low depth liquidity) clearly communicated without confusing users into thinking it predicts price direction?*
   - *Does the Portfolio module effectively maintain a non-custodial posture without misleading users about Steam API synchronization?*

4. **Frontend Implementation Readiness:**
   - *Are component boundaries, skeleton transitions (zero CLS), and edge states (degraded feeds, collecting history, form validation) sufficiently deterministic for Next.js / Tailwind engineers to implement without inventing UI?*

---

## 6. Expected Review Output Framework

Structure your evaluation using the following framework:
* **Section 1: Structural & UX Strengths** (What the design achieves exceptionally well)
* **Section 2: Micro-Interaction & Edge Case Vulnerabilities** (Gaps in data states, latency handling, or edge layouts)
* **Section 3: Tailwind / Component Architecture Recommendations** (Reusable component tokens, layout wrappers, state machines)
* **Section 4: Final Readiness Score** (Scale of 1–10 on Production & Institutional Readiness)
