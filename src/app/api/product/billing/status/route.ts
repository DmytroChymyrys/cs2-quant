import { productRequest } from "@/lib/product/api";
import { billingAccount } from "@/lib/product/billing-account";
export async function GET(request: Request) {
  return productRequest(request, ({ user }) => billingAccount(user.app.id));
}
