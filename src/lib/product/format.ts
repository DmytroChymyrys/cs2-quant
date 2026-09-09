import Decimal from "./decimal";
export function money(value: string | null | undefined) {
  if (value == null) return "—";
  const [whole, fraction] = new Decimal(value).toFixed(2).split(".");
  return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
}
export function integer(value: number | null | undefined) {
  return value == null ? "—" : value.toLocaleString("en-US");
}
export function percent(value: string | null | undefined) {
  if (value == null) return "—";
  const n = new Decimal(value);
  return `${n.gte(0) ? "+" : ""}${n.toFixed(2)}%`;
}
export function timestamp(value: string | null | undefined) {
  if (!value) return "Not observed";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toISOString().replace("T", " ").slice(0, 19) + " UTC"
    : "Unavailable";
}
