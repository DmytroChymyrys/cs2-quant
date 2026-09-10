import { requireAdmin } from "@/lib/ops/auth";
import { readOps } from "@/lib/ops/data";
import { opsInput, opsSection } from "@/lib/ops/input";
import { ProductError } from "@/lib/product/api";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const headers = {
    "Cache-Control": "private, no-store, max-age=0",
    "X-Robots-Tag": "noindex, nofollow",
  };
  try {
    await requireAdmin();
    const params = new URL(request.url).searchParams;
    const section = opsSection(params.get("section") ?? undefined);
    if (!section)
      return Response.json({ message: "Not found" }, { status: 404, headers });
    const input = opsInput(params);
    const tables = await readOps(section, input.days, input.search, input.page);
    return Response.json(
      { asOf: new Date().toISOString(), ...input, tables },
      { headers },
    );
  } catch (error) {
    return Response.json(
      {
        message: error instanceof ProductError ? error.message : "Unavailable",
      },
      { status: error instanceof ProductError ? error.status : 503, headers },
    );
  }
}
