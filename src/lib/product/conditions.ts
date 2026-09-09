import { z } from "zod";
import Decimal from "./decimal";
import type { Condition } from "./schema";
const decimal = z.string().regex(/^-?\d{1,12}(\.\d{1,8})?$/);
export const conditionSchema = z
  .object({
    metric: z.enum([
      "median",
      "quantity",
      "sales24h",
      "priceChange",
      "listingChange",
      "activityChange",
    ]),
    operator: z.enum(["gt", "lt", "between"]),
    threshold: decimal,
    upper: decimal.optional(),
  })
  .refine(
    (c) =>
      c.operator !== "between" ||
      Boolean(c.upper && new Decimal(c.upper).gte(c.threshold)),
    {
      message:
        "Between requires an upper threshold at least as large as the lower threshold.",
    },
  );
export function matchesCondition(
  condition: Condition,
  value: string | number | null,
) {
  if (value === null) return null;
  const actual = new Decimal(value);
  return condition.operator === "gt"
    ? actual.gt(condition.threshold)
    : condition.operator === "lt"
      ? actual.lt(condition.threshold)
      : actual.gte(condition.threshold) && actual.lte(condition.upper!);
}
export function evaluateConditions(
  conditions: Condition[],
  values: Record<Condition["metric"], string | number | null>,
  stale = false,
) {
  const matrix = conditions.map((condition) => ({
    ...condition,
    value: values[condition.metric],
    satisfied: matchesCondition(condition, values[condition.metric]),
  }));
  if (stale) return { state: "SOURCE_DEGRADED", truth: null, matrix };
  if (matrix.some((row) => row.satisfied === null))
    return { state: "COLLECTING", truth: null, matrix };
  return {
    state: "ACTIVE",
    truth: matrix.every((row) => row.satisfied),
    matrix,
  };
}
export function transition(previous: boolean, truth: boolean | null) {
  return {
    notify: truth === true && !previous,
    next: truth === null ? previous : truth,
  };
}
