import Decimal from "../decimal";
import type { MarketAssetSummary } from "./contract";
export type HoldingReference = {
  assetId: string;
  quantity: number;
  unitCost: string | null;
};
export function portfolioIntelligence(
  holdings: HoldingReference[],
  assets: MarketAssetSummary[],
) {
  const map = new Map(assets.map((a) => [a.id, a]));
  const rows = holdings.map((h) => {
    const asset = map.get(h.assetId) ?? null;
    const observedValue =
      asset?.minimum === null || !asset
        ? null
        : new Decimal(asset.minimum).times(h.quantity).toFixed(8);
    const r = asset?.returns["24h"] ?? null;
    const prior =
      observedValue !== null &&
      r !== null &&
      new Decimal(1).plus(new Decimal(r).div(100)).gt(0)
        ? new Decimal(observedValue).div(
            new Decimal(1).plus(new Decimal(r).div(100)),
          )
        : null;
    return {
      ...h,
      asset,
      observedValue,
      observedChange24h:
        observedValue !== null && prior
          ? new Decimal(observedValue).minus(prior).toFixed(8)
          : null,
    };
  });
  const priced = rows.filter((r) => r.observedValue !== null),
    sum = priced.reduce((n, r) => n.plus(r.observedValue!), new Decimal(0));
  const knownSubtotal = priced.length || !rows.length ? sum.toFixed(8) : null;
  const allChanged = rows.every((r) => r.observedChange24h !== null);
  const totalChange24h = allChanged
    ? rows
        .reduce((n, r) => n.plus(r.observedChange24h!), new Decimal(0))
        .toFixed(8)
    : null;
  const ranked = (key: "activity" | "volatility") =>
    rows
      .filter(
        (r) =>
          r.asset &&
          (key === "activity"
            ? r.asset.activity
            : r.asset.volatility["24h"]) !== null,
      )
      .sort(
        (a, b) =>
          Number(
            key === "activity" ? b.asset!.activity : b.asset!.volatility["24h"],
          ) -
            Number(
              key === "activity"
                ? a.asset!.activity
                : a.asset!.volatility["24h"],
            ) || a.assetId.localeCompare(b.assetId),
      )[0]?.asset?.name ?? null;
  return {
    rows: rows.map((r) => ({
      ...r,
      concentrationPct:
        r.observedValue === null || sum.isZero()
          ? null
          : new Decimal(r.observedValue).div(sum).times(100).toFixed(2),
    })),
    knownSubtotal,
    totalValue: priced.length === rows.length ? knownSubtotal : null,
    totalChange24h,
    priced: priced.length,
    holdings: rows.length,
    mostActive: ranked("activity"),
    highestVolatility: ranked("volatility"),
  };
}
