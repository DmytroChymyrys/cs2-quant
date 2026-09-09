# FloatAlpha Component Contract

Implement reusable primitives before route-specific UI. The final System States board is the visual authority for behavior states.

## 1. Application shells

### Public shell

Used by Landing and Pricing. More whitespace, larger typography, fewer dense terminal elements.

### Auth shell

Used by Sign In, Create Account, Reset Password. Calm, focused, minimal.

### Terminal/app shell

Persistent top navigation, compact quantitative chrome, main content area, optional right inspection rail, status/provenance treatment.

## 2. Core primitives

Build a coherent reusable set for:

- Button
- IconButton
- Input
- SearchInput
- Select / Combobox
- Checkbox / Switch
- Tabs
- Tooltip
- Modal / ConfirmationDialog
- Toast
- DataTable
- MetricCell / MetricCard
- Panel
- PanelHeader
- StatusBadge
- SignalBadge
- ConfidenceBadge
- DataSemanticBadge
- Skeleton variants
- EmptyState
- ErrorState
- CollectingState
- LockedFeature
- InspectionRail
- Sparkline/chart container

## 3. Table behavior

Tables are a primary FloatAlpha interaction surface.

Requirements:

- compact row height
- monospace/tabular numeric columns
- right-align quantitative values
- sticky/clear headers where useful
- hover/selected row state
- keyboard/focus accessibility
- loading skeleton rows preserve table geometry
- no-data and no-results are separate states

## 4. Inspection rail

Desktop analytical screens may use a persistent right inspection rail for the selected asset/rule.

On narrower layouts:

- collapse into a drawer/sheet or stacked panel;
- do not squeeze the primary data table into unusable widths.

## 5. Skeletons

System States defines skeleton patterns for:

- metric
- table row
- chart
- inspection rail
- panel

Skeletons should preserve final layout dimensions and avoid dramatic layout shift.

## 6. Data-state components

Implement explicit visual components for:

- Collecting History
- Insufficient History
- No Data / Unavailable
- Stale Data
- Source Degraded
- Source Unavailable
- Network Error
- recoverable application error
- No Results

A legitimate numeric zero is never rendered through the unavailable component.

## 7. Personal empty states

Separate friendly empty states for:

- Watchlist
- Portfolio
- Alerts

Each should teach the user the next action without using generic decorative SaaS illustrations.

## 8. Locks/auth gates

`Pro Locked` and `Auth Required` are different states.

- Auth Required: capability is available after identity/sign-in.
- Pro Locked: signed-in user's entitlement does not include the capability.

## 9. Form states

Support:

- default
- hover
- focus
- filled
- disabled
- validation error
- success when useful
- async submitting
- rate limited/challenge

## 10. Buttons

Support:

- default
- hover
- focus-visible
- pressed
- disabled
- loading
- destructive

Do not shift button width when entering loading state.

## 11. Toasts

Use restrained toasts for user-initiated outcomes. Avoid toasting every background market update.

## 12. Destructive confirmation

Use escalating confirmation based on consequence:

- simple alert deletion: standard confirm
- portfolio holding deletion: confirm with context
- account deletion: strong confirmation, including typed confirmation if retained by final design

## 13. Responsive rules

Desktop is the analytical priority, but the app must remain usable on tablet/mobile.

- collapse top navigation appropriately;
- allow data tables to horizontally scroll or convert to purposeful compact layouts;
- inspection rails become drawers/stacked panels;
- do not hide semantic badges needed to interpret data;
- public/auth pages may substantially reflow;
- charts should preserve legibility over decorative density.
