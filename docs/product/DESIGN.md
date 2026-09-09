# FloatAlpha — CS2 Market Intelligence Terminal
## Canonical Design System Specification (DESIGN.md)

This document establishes the canonical visual design system, interaction rules, component architecture, and implementation standards for **FloatAlpha (CS2 Market Intelligence)**. It is based directly on the approved screen **FloatAlpha — CS2 Market Intelligence Terminal (Production Grounded)** (`{{DATA:SCREEN:SCREEN_2}}`). 

All future screens (Screener, Asset Intelligence, Watchlist, Portfolio, Alerts, Authentication, Pricing, and Settings) and Next.js / Tailwind front-end implementations must adhere strictly to these specifications.

---

## 1. Brand Identity & Design Principles

### 1.1 Brand Positioning
- **Name:** `FLOATALPHA`
- **Descriptor / Sub-brand:** `CS2 MARKET INTELLIGENCE`
- **Core Positioning:** An institutional, quantitative analytics terminal built exclusively for serious investors, market makers, and fund managers holding substantial Counter-Strike 2 digital asset portfolios.
- **Mental Model:** *TradingView × Finviz × Koyfin × Bloomberg Terminal* adapted specifically for digital asset economics.

### 1.2 Core Design Principles
1. **Grounded Credibility & Honesty:** Never present unverified, simulated, or predictive claims as established facts. The interface explicitly distinguishes between raw grounded observations, derived metrics, and prototype/sample models.
2. **Analytical Density Over Decoration:** Maximize high-signal information density while maintaining typographical hierarchy and breathing room. Every pixel serves analytical utility.
3. **Restrained, Meaningful Color:** Monochromatic slate/charcoal foundations. Color is strictly reserved for quantitative direction (positive/negative), analytical focus (cyan), risk alerts (amber), and statistical confidence ratings.
4. **Desktop-First Financial Ergonomics:** Designed for sustained multi-hour surveillance on high-resolution displays (1440px target). Compact row heights, scannable data tables, and rapid hotkey navigation.

### 1.3 Explicit Anti-Patterns (Strictly Prohibited)
- **NO Gaming Clichés:** No neon glow, cyberpunk aesthetics, holographic flares, weapon crosshairs, rank icons, or RGB lighting.
- **NO Gambling / Crypto Casino Tropes:** No lootbox opening imagery, prize wheels, "jackpot" banners, spinning animations, coin flip graphics, or speculative hype.
- **NO Trading Advice / Predictive Hype:** Never display `BUY`, `SELL`, `MOON`, `BULLISH`, `BEARISH`, `FAIR VALUE`, `UNDERVALUED`, or `OVERVALUED`. All signal semantics must be neutral statistical descriptors (e.g., `SUPPLY CONTRACTING`, `VOLUME SPIKE`, `ACTIVITY ACCELERATING`).
- **NO Generic SaaS Bloat:** No giant 32px rounded cards, no vast empty white/black space, no decorative multi-color gradients, and no fluffy marketing widgets.

---

## 2. Color System & Semantic Tokens

The color system is engineered for dark-mode financial terminals with strict WCAG AA contrast compliance on primary metrics.

### 2.1 Surface & Structural Palette
| Token Name | Hex Value | Semantic Role / Usage |
| :--- | :--- | :--- |
| `color-surface-bg` | `#080B10` | Global application root background canvas |
| `color-surface-panel` | `#0E121A` | Primary container background (panels, charts, rails) |
| `color-surface-panel-elevated` | `#141923` | Secondary elevated surfaces, active tabs, header bars, card headers |
| `color-surface-input` | `#111622` | Search inputs, filter dropdown fields |
| `color-surface-hover` | `#1A2232` | Table row hover, interactive button hover |
| `color-surface-active` | `#202B3F` | Active toggles, selected row state, pressed keys |
| `color-border-subtle` | `#1B2230` | Internal dividers, inactive tab borders, table row borders |
| `color-border-default` | `#263145` | Panel bounding boxes, metric card borders, input borders |
| `color-border-focus` | `#00B4D8` | Active focus rings, selected filters, analytical highlights |

### 2.2 Typography Colors
| Token Name | Hex Value | Semantic Role / Usage |
| :--- | :--- | :--- |
| `color-text-primary` | `#F1F5F9` | Primary metric values, asset titles, prominent figures |
| `color-text-secondary` | `#94A3B8` | Column headers, panel subtitles, secondary metadata, unit labels |
| `color-text-muted` | `#64748B` | Footers, disabled states, inactive labels, structural timestamps |
| `color-text-disabled` | `#475569` | Unselected toggles, unavailable feature labels |

### 2.3 Financial & Quantitative Signal Colors
| Token Name | Hex Value | Semantic Role / Usage |
| :--- | :--- | :--- |
| `color-cyan-primary` | `#00B4D8` | **Primary Brand / Analytical Accent:** Active indicator lines, primary tabs, focus rings |
| `color-cyan-bright` | `#38BDF8` | Cyan data points, active hover states, volume sparkline points |
| `color-cyan-dim` | `rgba(0, 180, 216, 0.12)` | Cyan pill background, index overlay fill, selection highlight |
| `color-emerald-primary` | `#10B981` | **Positive / Advancing:** Positive price Δ, advancing breadth, net supply accumulation |
| `color-emerald-dim` | `rgba(16, 185, 129, 0.14)` | Emerald badge fill, positive volume histogram bar |
| `color-crimson-primary` | `#EF4444` | **Negative / Declining:** Negative price Δ, declining breadth, net supply contraction |
| `color-crimson-dim` | `rgba(239, 68, 68, 0.14)` | Crimson badge fill, declining volume histogram bar |
| `color-amber-warning` | `#F59E0B` | Warning tags, data latency notice, medium confidence |
| `color-amber-dim` | `rgba(245, 158, 11, 0.12)` | Amber status badge background |

### 2.4 Confidence & Observational Status States
| Token Name | Foreground Hex | Background Hex | Border Hex | Description |
| :--- | :--- | :--- | :--- | :--- |
| `confidence-high` | `#10B981` | `rgba(16, 185, 129, 0.12)` | `rgba(16, 185, 129, 0.35)` | Deep listing depth, high transaction frequency, tight dispersion |
| `confidence-med` | `#00B4D8` | `rgba(0, 180, 216, 0.12)` | `rgba(0, 180, 216, 0.30)` | Moderate activity, typical liquidity |
| `confidence-low` | `#F59E0B` | `rgba(245, 158, 11, 0.12)` | `rgba(245, 158, 11, 0.30)` | Thin order book, high dispersion, low observation history |
| `confidence-inactive` | `#64748B` | `rgba(100, 116, 139, 0.10)` | `rgba(100, 116, 139, 0.25)` | Insufficient data collected |

---

## 3. Typography & Numerical Representation

The typography system pairs **Inter** (for structural navigation, panel labels, and textual UI) with **JetBrains Mono** (for prices, percentages, counts, coordinates, and timestamps). Numbers must use tabular monospace formatting to ensure vertical alignment across data columns.

```
UI Font Stack: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif
Monospace Font Stack: 'JetBrains Mono', 'Fira Code', 'Roboto Mono', Menlo, monospace
```

### 3.1 Type Scale Specification

| Role | Font Family | Size | Weight | Line Height | Letter Spacing | CSS Example |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Brand Title** | Inter | 14px | 800 (Extrabold) | 18px | `+0.08em` | `font-extrabold tracking-wider uppercase text-slate-100` |
| **Version / Badge** | JetBrains Mono | 10px | 600 (Semibold) | 12px | `+0.04em` | `font-mono text-[10px] tracking-wide` |
| **Panel Header** | Inter | 12px | 700 (Bold) | 16px | `+0.06em` | `font-bold text-xs uppercase tracking-wider text-slate-100` |
| **Panel Subtitle** | Inter | 11px | 500 (Medium) | 14px | `0` | `text-[11px] font-medium text-slate-400` |
| **Metric Value (Primary)** | JetBrains Mono | 20px | 700 (Bold) | 24px | `-0.02em` | `font-mono text-xl font-bold tracking-tight text-slate-100` |
| **Metric Delta / Badge** | JetBrains Mono | 12px | 600 (Semibold) | 16px | `0` | `font-mono text-xs font-semibold` |
| **Table Header** | Inter | 10.5px| 600 (Semibold) | 14px | `+0.05em` | `text-[10.5px] uppercase tracking-wider text-slate-400 font-semibold` |
| **Asset Name (Table)** | Inter | 12.5px| 600 (Semibold) | 16px | `0` | `text-[12.5px] font-semibold text-slate-100 hover:text-cyan-400` |
| **Asset Metadata (Wear/Col)**| Inter | 11px | 400 (Regular) | 14px | `0` | `text-[11px] text-slate-400 font-normal` |
| **Numeric Table Cell** | JetBrains Mono | 12px | 500 (Medium) | 16px | `-0.01em` | `font-mono text-xs text-slate-200 text-right tabular-nums` |
| **Signal Pill Label** | JetBrains Mono | 9.5px | 700 (Bold) | 12px | `+0.06em` | `font-mono text-[9.5px] uppercase font-bold tracking-wider` |
| **System Status / Hotkey** | JetBrains Mono | 10.5px| 500 (Medium) | 14px | `0` | `font-mono text-[10.5px] text-slate-400` |

### 3.2 Numeric Formatting Standards
- **Currency Format:** Always include `$` symbol followed immediately by digits: `$5,480.00`, `$920.00`, `$1.13`. Do not omit cents on assets under $1,000.
- **Percentage Delata:** Always include sign (`+` or `-`) and `%` symbol: `+1.42%`, `-3.1%`, `+191%`. Use emerald for positive, red for negative.
- **Integer Counts / Volume:** Use comma grouping: `1,248 Tx`, `3,240 SKUs`.
- **Standard Deviations / Multipliers:** Represented with Greek $\sigma$ or multiple $x$: `3.8σ`, `2.9σ`, `1.61 : 1`.

---

## 4. Spacing, Sizing & Grid Layout

The layout follows an institutional split-panel terminal architecture optimized for 1440px viewports, with 0px window frame margins, 12px internal gutters, and strict 4px / 8px component rhythm.

```
+----------------------------------------------------------------------------------------------------+
|  TOP NAVIGATION (Height: 48px)                                                                      |
+----------------------------------------------------------------------------------------------------+
|  MARKET STATUS RIBBON (Height: 68px, 6 Equal Metric Cells, Gap: 8px)                              |
+-------------------------------------------------------------------+--------------------------------+
|                                                                   |  MARKET BREADTH (Height: 140px)|
|  FLOATALPHA CS2 100-ASSET INDEX CHART                             +--------------------------------+
|  (Width: ~70%, Height: 440px)                                     |  TOP MOVERS (5 Rows, ~200px)   |
|                                                                   +--------------------------------+
|                                                                   |  ACTIVITY LEADERS (~100px)     |
+---------------------------------+---------------------------------+--------------------------------+
|  SUPPLY CONTRACTION MONITOR     |  VOLUME ANOMALIES               |  (Aligned with right rail)     |
|  (8 Grounded Rows, ~360px)      |  (8 Grounded Rows, ~360px)      |                                |
+---------------------------------+---------------------------------+--------------------------------+
|  SYSTEM STATUS & HOTKEY FOOTER (Height: 32px)                                                      |
+----------------------------------------------------------------------------------------------------+
```

### 4.1 Structural Dimensions Scale
- **Global Viewport Max-Width:** Fluid 100% with padding: `px-3` (12px on 1440px desktop).
- **Global Top Navigation Height:** Fixed `48px`.
- **Market Status Ribbon Height:** Fixed `68px` (compact single row).
- **Terminal Panel Gap:** `8px` horizontal and vertical grid spacing.
- **Terminal Panel Padding:** `12px` internal padding (tightened to `8px 12px` on dense tables).
- **Table Row Height:** `34px` (allows 8 rows in standard viewport height without scrolling).
- **Table Header Height:** `28px`.
- **Status Bar Height:** Fixed `30px`.

---

## 5. Geometry & Elevation

FloatAlpha strictly avoids rounded consumer-app aesthetics. Surfaces use ultra-subtle border radii and thin, crisp hairline strokes.

- **Panel Border Radius:** `rounded` (4px). Never exceed `rounded-md` (6px) on any card or container.
- **Button & Input Border Radius:** `rounded` (3px to 4px).
- **Badge & Pill Radius:** `rounded-sm` (2px to 3px).
- **Border Thickness:** Fixed `1px` solid border (`border border-[#263145]`).
- **Internal Separators:** `1px` solid `#1B2230`.
- **Shadows:** FloatAlpha avoids heavy blurred drop shadows. Use zero shadow or flat dark boundary elevation:
  - Default: `box-shadow: none`
  - Floating Tooltip / Popover: `box-shadow: 0 4px 16px rgba(0, 0, 0, 0.65), 0 0 0 1px #263145;`

---

## 6. Component System Specification

### 6.1 TopNavigation
- **Container:** `h-12 bg-[#0E121A] border-b border-[#1B2230] px-4 flex items-center justify-between`
- **Brand Group:** 
  - Logo/Icon: Compact 24x24px dark square with cyan line glyph.
  - Wordmark: `FLOATALPHA` (14px font-extrabold, `#F1F5F9`) + `v4.19` badge (`bg-cyan-950 text-cyan-400 border border-cyan-800 text-[10px] px-1 py-0.5 rounded`).
  - Subtitle: `CS2 MARKET INTELLIGENCE` (10px text-slate-400 tracking-wider).
- **Navigation Links:** Horizontal tab items (`Terminal`, `Screener`, `Assets`, `Watchlist`, `Portfolio`, `Alerts`).
  - *Active Tab:* Text `#00B4D8`, relative bottom indicator bar (`h-0.5 bg-[#00B4D8] bottom-0`), font-bold.
  - *Inactive Tab:* Text `#94A3B8`, hover `#F1F5F9`, hover background `bg-[#141923]`.
- **Right Utilities:**
  - Global Search Input (`w-64 h-8 bg-[#111622] border border-[#263145] rounded text-xs px-2.5 flex items-center justify-between text-slate-400`). Displays trailing key badge `/`.
  - Data Quorum Status Badge: Green ping dot + `99.8% DATA COVERAGE` (Skinport Feed Grounded).
  - Notification Bell Button + Account Tier Badge (`PRO ANALYST 0x8F9...B21`).

### 6.2 MarketMetric (Macro Ribbon Block)
- **Container:** `bg-[#0E121A] border border-[#263145] rounded px-3 py-2 flex flex-col justify-between h-[68px]`
- **Header Line:** Label (`text-[10.5px] font-semibold text-slate-400 uppercase tracking-wide flex items-center gap-1`) with optional info `(i)` tooltip icon.
- **Value Line:** 
  - Primary Metric: `text-lg font-bold font-mono text-slate-100`.
  - Secondary Delta: `text-xs font-semibold font-mono text-emerald-400` or `text-crimson-400` with arrow indicator (`+1.42%`, `-3.1% NET`).
  - Tiny Baseline/Microcopy: `text-[10px] text-slate-500 font-mono` (e.g. `Sample Median: $86.40`, `100 SKUs Verified`).
  - Inline Micro Sparkline: 32px × 14px SVG path showing 24h trajectory.

### 6.3 TerminalPanel & PanelHeader
- **Container:** `bg-[#0E121A] border border-[#263145] rounded flex flex-col overflow-hidden`
- **PanelHeader:** `h-9 px-3 border-b border-[#1B2230] flex items-center justify-between bg-[#111520]`
  - Left: Icon (cyan or slate) + Panel Title (`text-xs font-bold uppercase tracking-wider text-slate-100`) + Scope Tag (`[PILOT 100-SKU BENCHMARK • SKINPORT GROUNDED]`).
  - Right: Controls (Category filter pills, Timeframe selector, sort dropdown).

### 6.4 FilterPill & TimeframeSelector
- **Category Filter Pills (`ALL`, `CASES`, `WEAPONS`, `KNIVES`, `GLOVES`, `STICKERS`):**
  - Group: `flex items-center gap-1`
  - Pill: `h-6 px-2.5 text-[10.5px] font-bold uppercase rounded border transition-colors`
  - *Active:* `bg-[#00B4D8] text-slate-950 border-[#00B4D8]`
  - *Inactive:* `bg-[#141923] text-slate-400 border-[#263145] hover:text-slate-200 hover:border-slate-500`
- **Timeframe Selector (`24H`, `7D`, `30D`, `90D`, `1Y`):**
  - Segmented control: `h-6 bg-[#080B10] border border-[#263145] rounded p-0.5 flex gap-0.5`
  - Segment: `px-2 text-[10.5px] font-mono font-semibold rounded-sm`
  - *Active:* `bg-[#1B2333] text-cyan-400 shadow-sm`
  - *Inactive:* `text-slate-400 hover:text-slate-200`

### 6.5 QuantTable & NumericCell
- **Table Container:** `w-full text-left border-collapse`
- **Table Header (`thead`):** `bg-[#0B0F17] sticky top-0 z-10 border-b border-[#1B2230]`
  - Cell: `py-1.5 px-3 text-[10.5px] font-semibold uppercase text-slate-400 tracking-wider`
  - Numeric headers right-aligned.
- **Table Row (`tr`):** `h-[34px] border-b border-[#141924] hover:bg-[#151C28] transition-colors cursor-pointer group`
- **Asset Cell:** `py-1 px-3 flex items-center gap-2`
  - Optional thumbnail: 20x20px rounded-sm border border-slate-700 bg-slate-900 object-cover.
  - Text Block: Asset Name (`text-xs font-semibold text-slate-100 group-hover:text-cyan-400`) + Subtitle (`text-[10px] text-slate-400 font-normal`).
- **Numeric Cell:** `py-1 px-3 text-right font-mono text-xs text-slate-200 tabular-nums`

### 6.6 Badges (Signal & Confidence)
- **Confidence Badge (`HIGH`, `MED`, `LOW`):**
  - Container: `inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase border`
  - *High:* `text-[#10B981] bg-emerald-950/40 border-emerald-800/60` (with 4px green dot)
  - *Med:* `text-[#00B4D8] bg-cyan-950/40 border-cyan-800/60` (with 4px cyan dot)
  - *Low:* `text-[#F59E0B] bg-amber-950/40 border-amber-800/60` (with 4px amber dot)
- **Observational Signal Badge:**
  - Container: `inline-block px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase tracking-wider border`
  - `SUPPLY CONTRACTING`: `text-cyan-300 bg-cyan-950/50 border-cyan-800`
  - `VOLUME SPIKE`: `text-emerald-300 bg-emerald-950/50 border-emerald-800`
  - `ACTIVITY ACCELERATING`: `text-blue-300 bg-blue-950/50 border-blue-800`
  - `PRICE MOMENTUM`: `text-emerald-300 bg-emerald-950/50 border-emerald-800`

### 6.7 DataFreshnessIndicator & StatusBar
- **Container:** `h-[30px] bg-[#070A0F] border-t border-[#1B2230] px-3 flex items-center justify-between text-[10.5px] font-mono text-slate-400`
- **Left Provenance:** Green dot + `Skinport Grounded Feed: 100 assets sample • Last observation 2m ago • Quorum 99.8% Sync`
- **Middle Telemetry:** `Engine: v4.19-LTS • Latency 14ms • Realized observations: 100 SKUs`
- **Right Hotkeys:** Interactive key badges (`/ Search`, `T Terminal`, `S Screener`, `Esc Clear`).

---

## 7. Data Visualization & Financial Charting Standards

Charts must visually communicate statistical rigor rather than speculative hype.

### 7.1 Primary Index Chart Rules
- **Canvas / Background:** Flat `#0A0E16` with restrained gridlines (`stroke="#161D2A"` stroke-dasharray="3 3").
- **Primary Line (Index Composite):**
  - Stroke: `#00B4D8`, stroke-width: `2px`.
  - Gradient Area Fill: Linear gradient from `rgba(0, 180, 216, 0.18)` at the peak down to `rgba(0, 180, 216, 0.00)` at baseline.
- **Benchmark Overlay (30D SMA):**
  - Stroke: `#64748B`, stroke-width: `1.5px`, stroke-dasharray: `4 4`.
- **Extreme Range Markers:**
  - High Callout: Solid pill `HIGH $1,504.22 (T-6D)` with green accent dot.
  - Low Callout: Solid pill `LOW $1,390.10 (T-24D)` with red accent dot.
- **Volume Histogram (Sub-chart):**
  - Displayed along bottom 20% of the chart area.
  - Daily bar width: Proportional with 2px gap.
  - Fill: Positive days `rgba(16, 185, 129, 0.65)`, Negative days `rgba(239, 68, 68, 0.45)`.
- **Time Axis:** Monospace timestamps (`T-30D`, `T-21D`, `T-14D`, `T-7D`, `YESTERDAY`, `OBSERVED 14:32 UTC`).

### 7.2 Market Breadth Gauge
- **Bar Component:** Compact horizontal split-bar (Height: `10px`, `rounded-sm`).
- **Advancing Segment:** `#10B981` (e.g. 58.0%).
- **Unchanged Segment:** `#64748B` (e.g. 6.0%).
- **Declining Segment:** `#EF4444` (e.g. 36.0%).
- **Labeling:** Clean monospace percentage readouts directly above or inline with the bar.

---

## 8. Product Data Semantics & Compliance Rules

To protect institutional credibility, the front-end must enforce visual tagging across all metrics:

### 8.1 Data State Classifications
1. **GROUNDED OBSERVATION:** Directly verified data collected from our production Skinport API ingestion workers (e.g., 100 verified SKUs, observed floor prices, current active listing counts, 24h recorded transactions).
   - *Visual Treatment:* Standard high-contrast white/cyan font; verified green quorum dot.
2. **DERIVED METRIC:** Statistically computed from verified observations over time (e.g., Median Listing Δ, 7D Price Delta, 30D Annualized Volatility, 3.8σ Volume Z-score).
   - *Visual Treatment:* Monospace numbers accompanied by explicit methodology badges (e.g., `ROLLING 30D DEVIATION`, `7D BASELINE`).
3. **EXPERIMENTAL / SAMPLE METRIC:** Composite calculations based on a representative sub-sample rather than the complete universe (e.g., `FloatAlpha CS2 100-Asset Index`).
   - *Visual Treatment:* Mandatory disclaimer tag: `[PILOT 100-SKU BENCHMARK • SKINPORT GROUNDED]`.
4. **RESERVED / FUTURE CAPABILITY:** Features currently in development (cross-market arbitrage across Buff163/CSFloat, float distribution histograms, Doppler phase scanners, Valve trade-ban tracking).
   - *Visual Treatment:* Display subtle badge `PRO` or `PIPELINE Q3`. Never display mocked or fabricated numbers as live data.

### 8.2 Prohibited vs. Approved Terminology
| PROHIBITED (Gamer / Hype / Speculative) | MANDATORY REPLACEMENT (Institutional & Descriptive) |
| :--- | :--- |
| `Strong Buy / Buy Signal` | `Volume Spike (Z-Score > 3.0σ)` |
| `Sell Signal / Dump` | `Supply Contraction / Net Listing Depletion` |
| `Bullish Regime` | `Advancing Breadth (> 50% Advancing)` |
| `Bearish Regime` | `Declining Breadth (> 50% Declining)` |
| `Fair Value / Undervalued` | `Median Observation / 30D Baseline` |
| `Total CS2 Market Cap ($4.8B)` | `Tracked Sample Value ($482.6K / 100 SKUs)` |
| `Accumulation Zone` | `Net Listing Decline + Activity Acceleration` |

---

## 9. Responsive Adaptation Guidelines

Desktop at 1440px is the primary production target. Responsiveness is handled via structural column reflow and panel prioritization — **never by reducing font sizes below readable minimums**.

### 9.1 Viewport Breakpoints
- **1920px (Ultrawide / Large Desktop):**
  - Central chart and tables expand horizontally to fill grid width.
  - Tables display additional secondary columns (e.g., 30D Volatility, 90D High/Low, Liquidity Rank).
- **1440px (Target Standard Desktop):**
  - Canonical layout as specified in `{{DATA:SCREEN:SCREEN_2}}`. 12-column terminal grid: Chart & Bottom Tables span 8 columns (~68%), Right Rail spans 4 columns (~32%).
- **1280px (Compact Desktop):**
  - Right Intelligence Rail narrows to 320px fixed width.
  - Secondary metadata in tables (e.g., collection name under asset) truncates cleanly.
- **1024px (Compressed Desktop / Tablet Landscape):**
  - Layout stacks: Right rail drops below the primary chart.
  - Bottom tables (Supply Contraction and Volume Anomalies) become full-width tabbed panels.
- **Mobile (<768px):**
  - Reserved for future lightweight companion view (Watchlist, Alerts, Portfolio Quick View). The full multi-panel quantitative terminal remains desktop-first.

---

## 10. Accessibility & Operational Standards

1. **Minimum Typography:** Absolute minimum UI text size is `9.5px` (only for uppercase monospace badges). Standard tabular and body text must not drop below `11px` / `12.5px`.
2. **Color Independence:** Financial movement is never indicated by color alone. Upward movement is accompanied by `+` and ascending arrows `↑`; downward movement is accompanied by `-` and descending arrows `↓`.
3. **Keyboard Hotkeys:**
   - `/`: Instant focus to Global Asset Search.
   - `T`: Navigate to Market Overview Terminal.
   - `S`: Navigate to Asset Screener.
   - `W`: Navigate to Watchlist.
   - `Esc`: Clear search focus or close modals.
4. **Contrast Compliance:** All text tokens meet minimum 4.5:1 contrast against `#0E121A` and `#080B10`.

---
*Source Screen Reference: `{{DATA:SCREEN:SCREEN_2}}` ("FloatAlpha — CS2 Market Intelligence Terminal (Production Grounded)")*
