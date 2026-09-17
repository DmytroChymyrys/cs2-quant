# Coverage policy for complete-window metrics — DESIGN ONLY

**Status: PROPOSED. Not implemented. Current strict behaviour is unchanged.**

This documents an alternative for later review. No code in this repository
implements it, and the existing strict semantics remain in force.

## Current behaviour (unchanged, and correct)

A metric that needs a complete window returns `null` unless **every** cadence
step in that window was observed. `realized_volatility_*` requires exactly
288 consecutive five-minute pairs for a 24h figure; `market_activity_score`
requires exactly 12 for 1h. A gap is never bridged and a shorter sample is never
silently substituted.

### What this costs, measured

One failed provider window on 2026-09-15T19:35Z (HTTP 400 on the items
endpoint) removed a single observation for every asset. The consequence on the
reviewed snapshot:

| Horizon | Assets with volatility | Assets with 24h activity |
| --- | --- | --- |
| 1h | 99 / 100 | — |
| 6h | 99 / 100 | — |
| 24h | **0 / 100** | **0 / 100** |

One missing window out of 288 suppressed every 24h complete-window metric for
the following 24 hours, which also empties the Quiet Markets preset because it
is defined on 24h activity. 287 of 288 windows were present — 99.65% coverage.

This is honest, and it is the right default. The question is whether
"99.65% coverage" should be presentable **with a warning** rather than absent.

## Proposed: a coverage class beside every complete-window metric

```
COMPLETE       every expected step observed; today's behaviour, unqualified
NEAR_COMPLETE  coverage at or above a stated threshold, with gaps disclosed
INSUFFICIENT   below the threshold; the metric is not produced at all
```

A value would carry the class, the observed and expected step counts, and the
exact timestamps of the missing windows, so a reader can judge it rather than
trust it.

### Open questions for review

1. **Threshold.** 287/288 is 99.65%. Is the bar 99%, 95%, or "at most one
   contiguous gap of at most N steps"? A single missing step in the middle of a
   window is not equivalent to fifty missing at one end, and a percentage alone
   cannot express that.
2. **Gap shape.** A contiguous-gap limit is probably more meaningful than a
   coverage percentage, because volatility is a path statistic.
3. **Statistical effect.** Dropping one of 288 log returns changes a standard
   deviation slightly; dropping a clustered twelve during a price move changes
   it materially. This needs quantifying on the real dataset before a threshold
   is chosen, not assumed.
4. **Ranking across classes.** If a screener ranks COMPLETE and NEAR_COMPLETE
   values together, the ranking mixes two different measurements. Options are
   to rank separately, to sort NEAR_COMPLETE below, or to exclude it from
   ranking while still showing it on an asset page.
5. **Does it apply to activity?** `market_activity_score` is a ratio over
   observed pairs and degrades more gracefully than volatility, so it may
   tolerate a lower bar than volatility does.

### What would have to be true before implementing

- The statistical effect in question 3 measured on the frozen dataset across a
  range of simulated gap shapes.
- A threshold chosen from that measurement rather than from convenience.
- The class surfaced everywhere the value is, including API and MCP outputs, so
  a NEAR_COMPLETE number can never be consumed as if it were COMPLETE.
- Tests proving an INSUFFICIENT window still produces no metric.
- Evidence-language review: NEAR_COMPLETE must not become a way to quietly
  present weaker data as equivalent.

## Recommendation

Keep the strict behaviour until the 30-day dataset exists. With 30 days there
are far more complete 24h windows, so the practical cost of strictness falls
sharply, and the threshold question can be answered from a much larger sample of
real gaps rather than from the single provider failure observed so far.
