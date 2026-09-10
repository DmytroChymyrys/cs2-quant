// Presentation copy follows the existing methodology; it does not compute metrics.
export function metricHelp(label: string) {
  const name = label.toLowerCase();
  if (name.includes("volatility") && !name.includes("available")) {
    const horizon = name.includes("24h")
      ? "24h"
      : name.includes("6h")
        ? "6h"
        : "1h";
    const observations = { "1h": 13, "6h": 73, "24h": 289 }[horizon];
    return {
      title: `Realized volatility · ${horizon}`,
      text: `Variation in minimum-listing price changes. Sample standard deviation of five-minute log returns, multiplied by 100; not annualized. Requires ${observations} consecutive positive-price observations. Missing points are not interpolated. This measures variability, not direction.`,
    };
  }
  if (name.includes("activity") && !name.includes("active markets"))
    return {
      title: "Activity score · 1h",
      text: "How often minimum listing price and listing quantity changed across 12 consecutive five-minute pairs. Changed transitions ÷ 24 × 100. Requires 13 consecutive observations. Not sales volume, trading intensity or a forecast.",
    };
  if (name.includes("coverage") || name.includes("quality /"))
    return {
      title: "Observation coverage",
      text: "Available observations divided by expected five-minute windows in this snapshot, capped at 100%. Coverage describes completeness; it does not guarantee source freshness or market liquidity.",
    };
  if (name.includes("source age"))
    return {
      title: "Source age",
      text: "Elapsed time since the source timestamp. Current source age includes time since collection; captured source age measures upstream lag at observation. Unavailable timestamps are not treated as zero.",
    };
  if (name.includes("observation age"))
    return {
      title: "Observation age",
      text: "Elapsed time since FloatAlpha recorded the observation. This is distinct from the provider’s source timestamp and does not measure application latency.",
    };
  if (name.includes("listings Δ") || name.includes("listing change"))
    return {
      title: "Listing change · 1h",
      text: "Change in venue listing quantity against the eligible one-hour baseline. Percentage change = (current − baseline) ÷ baseline × 100. A missing or zero percentage baseline remains unavailable. Listings are not circulating supply or executed sales.",
    };
  if (name.includes("return"))
    return {
      title: "Listing-price return",
      text: "Percentage change in minimum listing price against the selected horizon’s eligible baseline: (current − baseline) ÷ baseline × 100. An absent or nonpositive baseline is unavailable. This is not an execution price or a forecast.",
    };
  if (name.includes("confidence"))
    return {
      title: "Price confidence",
      text: "Unavailable: no validated price-confidence methodology has been assigned. No directional classification or fabricated score is shown.",
    };
  return null;
}
