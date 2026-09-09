import Decimal from "./decimal";
export function median(values: string[]) {
  if (!values.length) return null;
  const sorted = values.map((v) => new Decimal(v)).sort((a, b) => a.cmp(b));
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle].toFixed(8)
    : sorted[middle - 1].plus(sorted[middle]).div(2).toFixed(8);
}
