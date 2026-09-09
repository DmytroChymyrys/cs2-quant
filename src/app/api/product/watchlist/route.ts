import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { productRequest, ProductError } from "@/lib/product/api";
import { productDatabase } from "@/lib/product/db";
import { appUsers, watchEntries } from "@/lib/product/schema";
import { assets } from "@/lib/db/schema";
const bodySchema = z.object({ assetId: z.uuid() });
export async function GET(request: Request) {
  return productRequest(request, async ({ user }) => ({
    entries: await productDatabase()
      .select()
      .from(watchEntries)
      .where(eq(watchEntries.userId, user.app.id)),
  }));
}
export async function POST(request: Request) {
  return productRequest(request, async ({ user, capabilities }) => {
    const { assetId } = bodySchema.parse(await request.json());
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
            .where(and(eq(assets.id, assetId), eq(assets.isTracked, true)))
        )[0]
      )
        throw new ProductError(404, "Tracked asset not found.");
      const existing = await tx
        .select()
        .from(watchEntries)
        .where(eq(watchEntries.userId, user.app.id));
      if (existing.some((row) => row.assetId === assetId))
        return { saved: true };
      if (existing.length >= capabilities.maxWatchlistAssets)
        throw new ProductError(
          403,
          `Your plan supports ${capabilities.maxWatchlistAssets} watchlist assets.`,
        );
      await tx.insert(watchEntries).values({ userId: user.app.id, assetId });
      return { saved: true };
    });
  });
}
export async function DELETE(request: Request) {
  return productRequest(request, async ({ user }) => {
    const { assetId } = bodySchema.parse(await request.json());
    await productDatabase()
      .delete(watchEntries)
      .where(
        and(
          eq(watchEntries.userId, user.app.id),
          eq(watchEntries.assetId, assetId),
        ),
      );
    return { removed: true };
  });
}
export async function PATCH(request: Request) {
  return productRequest(request, async ({ user }) => {
    const { observationIds } = z
      .object({ observationIds: z.array(z.uuid()).max(100) })
      .parse(await request.json());
    await productDatabase().transaction(async (tx) => {
      await tx.execute(
        sql`update watchlist_entries w set checkpoint_observation_id=o.id from market_observations o where w.user_id=${user.app.id}::uuid and o.asset_id=w.asset_id and o.id in (select jsonb_array_elements_text(${JSON.stringify(observationIds)}::jsonb)::uuid) and (w.checkpoint_observation_id is null or o.observed_at>(select observed_at from market_observations where id=w.checkpoint_observation_id))`,
      );
      await tx
        .update(appUsers)
        .set({ watchVisitedAt: new Date() })
        .where(eq(appUsers.id, user.app.id));
    });
    return { saved: true };
  });
}
