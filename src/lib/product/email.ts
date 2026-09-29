import sendgrid from "@sendgrid/mail";

/**
 * Transactional email, via Twilio SendGrid.
 *
 * The single sending seam in the product: verification, password reset and
 * alert delivery all go through here, so the provider is one function body
 * rather than a dependency scattered across call sites.
 *
 * Fail-closed by design. `emailConfigured()` gates
 * `emailAndPassword.enabled` in the auth configuration, so an unconfigured
 * environment disables email signup rather than accepting a registration it
 * cannot deliver a verification link for.
 */
export const emailConfigured = () =>
  Boolean(process.env.SENDGRID_API_KEY && process.env.EMAIL_FROM);

export async function sendEmail(
  to: string,
  subject: string,
  text: string,
  idempotencyKey?: string,
) {
  if (!emailConfigured()) throw new Error("EMAIL_UNAVAILABLE");
  sendgrid.setApiKey(process.env.SENDGRID_API_KEY!);
  try {
    const [response] = await sendgrid.send({
      from: process.env.EMAIL_FROM!,
      to,
      subject,
      text,
      /*
       * SendGrid has no request-level idempotency key, unlike the previous
       * provider. The guarantee is preserved by the caller instead: alert
       * delivery marks its alert_events row delivered only after this
       * resolves, so a retry after a failed send cannot double-deliver an
       * alert that was already recorded.
       *
       * The key is still carried into a custom argument so a duplicate is
       * traceable in SendGrid's own activity feed if one ever occurs.
       */
      ...(idempotencyKey
        ? { customArgs: { idempotency_key: idempotencyKey } }
        : {}),
    });
    return { id: response.headers["x-message-id"] ?? null };
  } catch {
    // Provider errors can carry the recipient and the message body. Surface a
    // fixed code and let the caller decide, rather than logging a payload.
    throw new Error("EMAIL_DELIVERY_FAILED");
  }
}
