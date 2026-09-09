import Decimal from "./decimal";
export function valueHolding(
  quantity: number,
  median: string | null,
  unitCost: string | null,
) {
  const value =
    median === null ? null : new Decimal(median).times(quantity).toFixed(8);
  const cost =
    unitCost === null ? null : new Decimal(unitCost).times(quantity).toFixed(8);
  return {
    value,
    cost,
    pnl:
      value === null || cost === null
        ? null
        : new Decimal(value).minus(cost).toFixed(8),
  };
}
