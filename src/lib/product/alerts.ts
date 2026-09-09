import { and, eq, sql } from "drizzle-orm";
import { productDatabase } from "./db";
import { alertRules, alertEvents, authUser, appUsers } from "./schema";
import { marketSnapshot } from "./market";
import { entitlements } from "./entitlements";
import { evaluateConditions, transition } from "./conditions";
import { sendEmail, emailConfigured } from "./email";
export async function evaluateAlerts() {
  const db = productDatabase(),
    snapshot = await marketSnapshot();
  if (snapshot.error)
    return { state: "SOURCE_UNAVAILABLE", evaluated: 0, events: 0 };
  const rules = await db
    .select({ id: alertRules.id, userId: alertRules.userId })
    .from(alertRules)
    .where(eq(alertRules.paused, false));
  let events = 0,
    evaluated = 0;
  for (const candidate of rules) {
    const caps = await entitlements(candidate.userId);
    if (!caps.canCreateAlerts) continue;
    await db.transaction(async (tx) => {
      const rule = (
        await tx
          .select()
          .from(alertRules)
          .where(eq(alertRules.id, candidate.id))
          .for("update")
      )[0];
      if (!rule || rule.paused) return;
      const asset = snapshot.assets.find((a) => a.id === rule.assetId);
      if (!asset) {
        await tx
          .update(alertRules)
          .set({ state: "UNAVAILABLE" })
          .where(eq(alertRules.id, rule.id));
        return;
      }
      const found = await tx.execute(
        sql`select id,observed_at from market_observations where asset_id=${rule.assetId}::uuid and observed_at=${asset.observedAt}::timestamptz and source='SKINPORT' order by observed_at desc limit 1`,
      );
      const observationId = found.rows[0]?.id as string | undefined;
      if (asset.state !== "GROUNDED") {
        await tx
          .update(alertRules)
          .set({ state: "SOURCE_DEGRADED" })
          .where(eq(alertRules.id, rule.id));
        return;
      }
      if (!observationId || rule.lastObservationId === observationId) return;
      if (rule.lastObservationId) {
        const previous = await tx.execute(
          sql`select observed_at from market_observations where id=${rule.lastObservationId}::uuid`,
        );
        if (
          previous.rows[0] &&
          new Date(String(previous.rows[0].observed_at)).getTime() >=
            Date.parse(asset.observedAt!)
        )
          return;
      }
      const result = evaluateConditions(
        rule.conditions,
        asset,
        asset.state !== "GROUNDED",
      );
      const change = transition(rule.previousTrue, result.truth);
      if (change.notify) {
        const inserted = await tx
          .insert(alertEvents)
          .values({
            ruleId: rule.id,
            userId: rule.userId,
            observationId,
            details: {
              name: rule.name,
              asset: asset.name,
              evaluatedAt: new Date().toISOString(),
              ...result,
              previousTrue: rule.previousTrue,
            },
            emailState: rule.email ? "PENDING" : "NOT_REQUESTED",
          })
          .onConflictDoNothing()
          .returning();
        events += inserted.length;
      }
      await tx
        .update(alertRules)
        .set({
          previousTrue: change.next,
          state: result.state,
          lastObservationId: observationId,
          lastEvaluation: result,
          updatedAt: new Date(),
        })
        .where(eq(alertRules.id, rule.id));
      evaluated++;
    });
  }
  // Event creation is transactional. Delivery retries use the event UUID as the provider idempotency key.
  if (emailConfigured()) {
    const pending = await db
      .select({ event: alertEvents, email: authUser.email })
      .from(alertEvents)
      .innerJoin(appUsers, eq(alertEvents.userId, appUsers.id))
      .innerJoin(authUser, eq(appUsers.authUserId, authUser.id))
      .where(
        and(
          eq(alertEvents.emailState, "PENDING"),
          sql`${alertEvents.createdAt}>now()-interval '23 hours'`,
        ),
      )
      .limit(100);
    for (const { event, email } of pending) {
      try {
        await sendEmail(
          email,
          "cs2-quant: your alert condition became true",
          `Your configured condition was satisfied. Review the observation and thresholds at ${process.env.BETTER_AUTH_URL}/alerts. This is an observation, not a recommendation.`,
          event.id,
        );
        await db
          .update(alertEvents)
          .set({ emailState: "SENT" })
          .where(eq(alertEvents.id, event.id));
      } catch {
        /* Keep durable pending state for retry within provider idempotency retention. */
      }
    }
    await db
      .update(alertEvents)
      .set({ emailState: "DELIVERY_EXPIRED" })
      .where(
        and(
          eq(alertEvents.emailState, "PENDING"),
          sql`${alertEvents.createdAt}<=now()-interval '23 hours'`,
        ),
      );
  }
  return { state: "COMPLETE", evaluated, events };
}
