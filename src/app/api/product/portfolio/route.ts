import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { productRequest, ProductError } from "@/lib/product/api";
import { productDatabase } from "@/lib/product/db";
import { appUsers, holdings } from "@/lib/product/schema";
import { assets } from "@/lib/db/schema";
export async function POST(request: Request) {
  return productRequest(request, async ({ user, capabilities }) => {
    const body = z
      .object({
        assetId: z.uuid(),
        quantity: z.number().int().min(1).max(1000000),
        unitCost: z
          .string()
          .regex(/^\d{1,12}(\.\d{1,8})?$/)
          .nullable(),
      })
      .parse(await request.json());
    return productDatabase().transaction(async (tx) => {
      await tx
        .select()
        .from(appUsers)
        .where(eq(appUsers.id, user.app.id))
        .for("update");
      if (
        !(
          await tx
            .select()
            .from(assets)
            .where(and(eq(assets.id, body.assetId), eq(assets.isTracked, true)))
        )[0]
      )
        throw new ProductError(404, "Asset not tracked.");
      const existing = await tx
        .select()
        .from(holdings)
        .where(eq(holdings.userId, user.app.id));
      if (
        existing.length >= capabilities.maxHoldings &&
        !existing.some((h) => h.assetId === body.assetId)
      )
        throw new ProductError(403, "Holdings limit reached.");
      await tx
        .insert(holdings)
        .values({ ...body, userId: user.app.id })
        .onConflictDoUpdate({
          target: [holdings.userId, holdings.assetId],
          set: {
            quantity: body.quantity,
            unitCost: body.unitCost,
            updatedAt: new Date(),
          },
        });
      return { saved: true };
    });
  });
}
export async function DELETE(request: Request) {
  return productRequest(request, async ({ user }) => {
    const { id } = z.object({ id: z.uuid() }).parse(await request.json());
    await productDatabase()
      .delete(holdings)
      .where(and(eq(holdings.id, id), eq(holdings.userId, user.app.id)));
    return { removed: true };
  });
}
