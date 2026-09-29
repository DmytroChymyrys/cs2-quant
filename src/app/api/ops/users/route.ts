import { z } from "zod";
import { revalidatePath } from "next/cache";
import { productRequest, ProductError } from "@/lib/product/api";
import { OPS_PATH } from "@/lib/ops/config";
import {
  blockUser,
  unblockUser,
  softDeleteUser,
  restoreUser,
  hardDeleteUser,
  countCascade,
} from "@/lib/ops/user-admin";

/**
 * Administrative account lifecycle.
 *
 * `productRequest` supplies the origin check and the error shape; every
 * handler below additionally goes through `requireAdmin()` inside the action
 * module, so a signed-in non-admin reaching this route is rejected there
 * rather than relying on the route being hard to guess.
 */

const body = z.object({
  action: z.enum([
    "block",
    "unblock",
    "soft-delete",
    "restore",
    "hard-delete",
    "preview",
  ]),
  userId: z.string().uuid(),
  reason: z.string().trim().max(280).optional(),
  /*
   * A hard delete is irreversible, so the caller must echo back the address it
   * is about to remove. This defeats a mis-aimed click on the wrong row, which
   * is the realistic way this goes wrong.
   */
  confirmEmail: z.string().trim().optional(),
});

export async function POST(request: Request) {
  return productRequest(request, async () => {
    const input = body.parse(await request.json());
    switch (input.action) {
      case "preview":
        return { cascade: await countCascade(input.userId) };
      case "block":
        return { ...(await blockUser(input.userId, input.reason)), ok: true };
      case "unblock":
        await unblockUser(input.userId);
        return { ok: true };
      case "soft-delete":
        return {
          ...(await softDeleteUser(input.userId, input.reason)),
          ok: true,
        };
      case "restore":
        await restoreUser(input.userId);
        return { ok: true };
      case "hard-delete": {
        if (!input.confirmEmail)
          throw new ProductError(400, "Type the email address to confirm.");
        const result = await hardDeleteUser(input.userId, {
          reason: input.reason,
          confirmEmail: input.confirmEmail,
        });
        revalidatePath(`${OPS_PATH}/users`);
        return { ...result, ok: true };
      }
    }
  });
}
