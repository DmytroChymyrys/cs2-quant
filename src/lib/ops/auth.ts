import "server-only";
import { cache } from "react";
import { eq, sql } from "drizzle-orm";
import { currentUser } from "../product/auth";
import { productDatabase } from "../product/db";
import { appUsers } from "../product/schema";
import { ProductError } from "../product/api";

// Request-scoped memoization only; role is read from DB, never session claims/email.
export const requireAdmin = cache(async () => {
  const user = await currentUser();
  if (!user) throw new ProductError(401, "Unauthorized");
  const [app] = await productDatabase()
    .select({ id: appUsers.id, role: appUsers.role })
    .from(appUsers)
    .where(eq(appUsers.authUserId, user.identity.id))
    .limit(1);
  if (!app || app.role !== "ADMIN" || !user.identity.emailVerified)
    throw new ProductError(403, "Forbidden");
  // Reuse Better Auth's database-backed rate-limit storage in a separate key namespace.
  const now = Date.now();
  const result = await productDatabase().execute(sql`
    insert into auth_rate_limits(key,count,last_request) values(${`ops:${app.id}`},1,${now})
    on conflict(key) do update set
      count=case when auth_rate_limits.last_request < ${now - 60_000} then 1 else auth_rate_limits.count+1 end,
      last_request=case when auth_rate_limits.last_request < ${now - 60_000} then ${now} else auth_rate_limits.last_request end
    returning count`);
  if (Number(result.rows[0].count) > 120)
    throw new ProductError(429, "Too many requests");
  return { id: app.id };
});
