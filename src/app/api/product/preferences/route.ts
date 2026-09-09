import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { productRequest, ProductError } from "@/lib/product/api";
import { productDatabase } from "@/lib/product/db";
import { appUsers, watchEntries } from "@/lib/product/schema";
import { assets } from "@/lib/db/schema";
export async function POST(request: Request) {
  return productRequest(request, async ({ user, capabilities }) => {
    const body = z
      .object({
        categories: z
          .array(
            z.enum([
              "cases",
              "weapons",
              "knives",
              "gloves",
              "capsules/stickers",
            ]),
          )
          .max(5),
        interests: z
          .array(
            z.enum([
              "Price Movement",
              "Supply Changes",
              "Activity Anomalies",
              "Volatility",
              "Price/Supply Divergence",
            ]),
          )
          .max(5),
        starterAssets: z.array(z.uuid()).max(5).default([]),
      })
      .parse(await request.json());
    return productDatabase().transaction(async (tx) => {
      await tx
        .select()
        .from(appUsers)
        .where(eq(appUsers.id, user.app.id))
        .for("update");
      const current = await tx
        .select()
        .from(watchEntries)
        .where(eq(watchEntries.userId, user.app.id));
      const additions = [...new Set(body.starterAssets)].filter(
        (id) => !current.some((w) => w.assetId === id),
      );
      if (current.length + additions.length > capabilities.maxWatchlistAssets)
        throw new ProductError(403, "Watchlist limit reached.");
      for (const id of additions) {
        const asset = await tx
          .select()
          .from(assets)
          .where(sql`${assets.id}=${id}::uuid and ${assets.isTracked}=true`);
        if (!asset.length)
          throw new ProductError(400, "Starter asset is not tracked.");
        await tx
          .insert(watchEntries)
          .values({ userId: user.app.id, assetId: id });
      }
      await tx
        .update(appUsers)
        .set({
          categories: [...new Set(body.categories)],
          interests: [...new Set(body.interests)],
          onboarded: true,
          updatedAt: new Date(),
        })
        .where(eq(appUsers.id, user.app.id));
      return { saved: true };
    });
  });
}
