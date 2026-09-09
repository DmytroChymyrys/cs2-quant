import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { productRequest, ProductError } from "@/lib/product/api";
import { productDatabase } from "@/lib/product/db";
import { alertRules, appUsers } from "@/lib/product/schema";
import { conditionSchema } from "@/lib/product/conditions";
import { assets } from "@/lib/db/schema";
import { emailConfigured } from "@/lib/product/email";
export async function POST(request: Request) {
  return productRequest(request, async ({ user, capabilities }) => {
    if (!capabilities.canCreateAlerts)
      throw new ProductError(403, "Pro is required to create alerts.");
    const body = z
      .object({
        name: z.string().trim().min(1).max(100),
        assetId: z.uuid(),
        conditions: z.array(conditionSchema).min(1).max(6),
        email: z.boolean().default(false),
      })
      .parse(await request.json());
    if (body.email && !emailConfigured())
      throw new ProductError(503, "Email delivery is unavailable.");
    return productDatabase().transaction(async (tx) => {
      await tx
        .select()
        .from(appUsers)
        .where(eq(appUsers.id, user.app.id))
        .for("update");
      if (
        (
          await tx
            .select()
            .from(alertRules)
            .where(eq(alertRules.userId, user.app.id))
        ).length >= 50
      )
        throw new ProductError(403, "Maximum 50 alert rules.");
      if (
        !(
          await tx
            .select()
            .from(assets)
            .where(and(eq(assets.id, body.assetId), eq(assets.isTracked, true)))
        )[0]
      )
        throw new ProductError(404, "Asset not tracked.");
      await tx.insert(alertRules).values({ ...body, userId: user.app.id });
      return { saved: true };
    });
  });
}
export async function PATCH(request: Request) {
  return productRequest(request, async ({ user }) => {
    const { id, paused } = z
      .object({ id: z.uuid(), paused: z.boolean() })
      .parse(await request.json());
    await productDatabase()
      .update(alertRules)
      .set({ paused, updatedAt: new Date() })
      .where(and(eq(alertRules.id, id), eq(alertRules.userId, user.app.id)));
    return { saved: true };
  });
}
export async function DELETE(request: Request) {
  return productRequest(request, async ({ user }) => {
    const { id } = z.object({ id: z.uuid() }).parse(await request.json());
    await productDatabase()
      .delete(alertRules)
      .where(and(eq(alertRules.id, id), eq(alertRules.userId, user.app.id)));
    return { removed: true };
  });
}
