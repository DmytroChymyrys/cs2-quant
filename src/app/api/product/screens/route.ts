import { z } from "zod";
import { eq } from "drizzle-orm";
import { productRequest, ProductError } from "@/lib/product/api";
import { productDatabase } from "@/lib/product/db";
import { savedScreens } from "@/lib/product/schema";
import { conditionSchema } from "@/lib/product/conditions";
export async function POST(request: Request) {
  return productRequest(request, async ({ user, capabilities }) => {
    if (!capabilities.canSaveScreens)
      throw new ProductError(403, "Pro is required to save advanced screens.");
    const body = z
      .object({
        name: z.string().trim().min(1).max(100),
        conditions: z.array(conditionSchema).min(1).max(6),
      })
      .parse(await request.json());
    await productDatabase()
      .insert(savedScreens)
      .values({ ...body, userId: user.app.id });
    return { saved: true };
  });
}
export async function GET(request: Request) {
  return productRequest(request, async ({ user, capabilities }) => {
    if (!capabilities.canSaveScreens)
      throw new ProductError(403, "Pro is required.");
    return {
      screens: await productDatabase()
        .select()
        .from(savedScreens)
        .where(eq(savedScreens.userId, user.app.id)),
    };
  });
}
