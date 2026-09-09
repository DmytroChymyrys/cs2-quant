import { Resend } from "resend";
export const emailConfigured = () =>
  Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
export async function sendEmail(
  to: string,
  subject: string,
  text: string,
  idempotencyKey?: string,
) {
  if (!emailConfigured()) throw new Error("EMAIL_UNAVAILABLE");
  const result = await new Resend(process.env.RESEND_API_KEY).emails.send(
    { from: process.env.EMAIL_FROM!, to, subject, text },
    idempotencyKey ? { idempotencyKey } : undefined,
  );
  if (result.error) throw new Error("EMAIL_DELIVERY_FAILED");
  return result.data;
}
