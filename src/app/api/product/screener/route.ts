import { z } from "zod";
import { productRequest, ProductError } from "@/lib/product/api";
import { conditionSchema, evaluateConditions } from "@/lib/product/conditions";
import { marketSnapshot } from "@/lib/product/market";
export async function POST(request: Request) {
  return productRequest(request, async ({ capabilities }) => {
    if (!capabilities.canUseAdvancedScreener)
      throw new ProductError(403, "Pro is required for advanced screens.");
    const { conditions, exportCsv } = z
      .object({
        conditions: z.array(conditionSchema).min(1).max(6),
        exportCsv: z.boolean().default(false),
      })
      .parse(await request.json());
    const snapshot = await marketSnapshot();
    if (snapshot.error)
      throw new ProductError(503, "Market observations are unavailable.");
    const assets = snapshot.assets.filter(
      (a) =>
        evaluateConditions(conditions, a, a.state !== "GROUNDED").truth ===
        true,
    );
    if (exportCsv) {
      if (!capabilities.canExport)
        throw new ProductError(403, "Export is unavailable on this plan.");
      const cell = (value: unknown) => {
        const text = value == null ? "" : String(value);
        return `"${(/^[=+@\-\t\r]/.test(text) ? "'" + text : text).replaceAll('"', '""')}"`;
      };
      const fields = [
        "name",
        "category",
        "median",
        "quantity",
        "sales24h",
        "observedAt",
      ] as const;
      return {
        csv: [
          fields.join(","),
          ...assets.map((a) => fields.map((k) => cell(a[k])).join(",")),
        ].join("\r\n"),
      };
    }
    return { assets };
  });
}
