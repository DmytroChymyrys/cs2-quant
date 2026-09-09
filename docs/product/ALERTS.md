# Alert Engine Specification

## 1. Principle

Alerts notify users when an explicitly configured market condition **newly becomes true**. They do not recommend trades and must not fire repeatedly on every cron cycle while the same condition remains true.

## 2. Transition semantics

For each alert rule, persist its previous evaluation state.

```text
false -> false : no notification
false -> true  : create alert event + deliver notification
true  -> true  : no repeat notification
true  -> false : re-arm the alert
```

The next `false -> true` transition can notify again.

This behavior is non-negotiable unless the user later chooses a distinct repeating-alert mode.

## 3. Supported MVP rule inputs

Rules may be composed from metrics the application can actually derive, for example:

- observed price change over an available history window
- listing quantity change over an available history window
- sales-activity change over an available history window
- Price Confidence classification
- observed volatility/dispersion only where methodology/history is defined

Example condition:

```text
Listing Δ 7D < -15%
AND Activity Δ > +50%
AND Confidence != LOW
AND Price Δ 7D BETWEEN -5% AND +5%
```

If required history is not ready, the alert state is `COLLECTING`, not false and not triggered.

## 4. Status lifecycle

Suggested states:

- ACTIVE
- COLLECTING
- PAUSED
- SOURCE DEGRADED / UNAVAILABLE when evaluation cannot be trusted

Do not invent order-book triggers or cross-market triggers.

## 5. Delivery channels

MVP:

- in-app
- email

No webhook delivery initially unless separately implemented and product-scoped.

## 6. Evaluation idempotency

Cron/evaluation logic must tolerate retries and duplicate invocations.

Use durable keys/state so the same transition cannot create duplicate user-visible notifications.

## 7. Auditability

Persist enough evaluation detail to explain why an alert became true:

- evaluation time
- metric values used
- thresholds/operators
- history/data state
- transition from previous state

The Alerts inspection UI can then show a compact condition matrix.
