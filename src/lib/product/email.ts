/**
 * Transactional email, via the Twilio Emails API.
 *
 * The single sending seam in the product: verification, password reset and
 * alert delivery all go through here, so the provider is one function body
 * rather than a dependency scattered across call sites.
 *
 * Authentication is HTTP Basic, so this needs no SDK. The credential pair is
 * the Basic username and password: either an Account SID with its Auth Token,
 * or — preferably — an API key SID (`SK…`) with its secret, which is scoped
 * and can be revoked without disturbing other Twilio integrations.
 *
 * Fail-closed by design. `emailConfigured()` gates `emailAndPassword.enabled`
 * in the auth configuration, so an unconfigured environment disables email
 * signup rather than accepting a registration whose verification link cannot
 * be delivered.
 */
const ENDPOINT = "https://comms.twilio.com/v1/Emails";

export const emailConfigured = () =>
  Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.EMAIL_FROM,
  );

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * Renders a plain-text message as HTML.
 *
 * The API's content object takes `html`, and our messages are written as
 * plain text that ends in a link — "Reset your password: https://…". Sent as
 * raw HTML that link would render as unclickable text, which for a password
 * reset is the difference between a working email and a broken one, so bare
 * URLs become anchors.
 *
 * Escaping happens first, so the anchor is built from already-escaped text and
 * the message cannot inject markup.
 */
export function textToHtml(text: string): string {
  const escaped = escapeHtml(text);
  const linked = escaped.replace(
    /https?:\/\/[^\s<]+/g,
    (url) => `<a href="${url}">${url}</a>`,
  );
  return linked
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/**
 * Splits `EMAIL_FROM` into the address and name the API expects.
 *
 * Accepts both "FloatAlpha <noreply@floatalpha.com>" and a bare address, so
 * the variable can be written the way it is everywhere else.
 */
export function parseSender(value: string): { address: string; name?: string } {
  const match = value.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  return match
    ? { address: match[2].trim(), ...(match[1] ? { name: match[1] } : {}) }
    : { address: value.trim() };
}

export async function sendEmail(
  to: string,
  subject: string,
  text: string,
  idempotencyKey?: string,
) {
  if (!emailConfigured()) throw new Error("EMAIL_UNAVAILABLE");
  const credentials = Buffer.from(
    `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`,
  ).toString("base64");
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${credentials}`,
    },
    body: JSON.stringify({
      from: parseSender(process.env.EMAIL_FROM!),
      to: [{ address: to }],
      content: { subject, html: textToHtml(text) },
    }),
  });
  if (!response.ok)
    // Provider errors can echo the recipient and the message body. Surface a
    // fixed code rather than logging a payload that may contain a reset link.
    throw new Error("EMAIL_DELIVERY_FAILED");
  /*
   * The API is asynchronous: it answers with an operation reference, so a
   * success here means Twilio ACCEPTED the message, not that a mailbox
   * received it. Alert delivery marks its alert_events row delivered on this
   * result, which therefore records "handed to the provider" — the same
   * guarantee a queued send has always given, and enough to stop a retry
   * double-sending. `idempotencyKey` is not sent: this API exposes no
   * idempotency field, and inventing one would imply a protection it does not
   * provide.
   */
  void idempotencyKey;
  const accepted = (await response.json()) as { operationId?: string };
  return { id: accepted.operationId ?? null };
}
