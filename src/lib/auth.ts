import { createHash, timingSafeEqual } from 'node:crypto';
export function authorized(request: Request, secret = process.env.CRON_SECRET): boolean {
  const header = request.headers.get('authorization');
  if (!secret || !header?.startsWith('Bearer ')) return false;
  const token = header.slice(7);
  if (!token || /\s/.test(token)) return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(token), digest(secret));
}
export function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
export async function internal(request: Request, action: () => Promise<unknown>) {
  if (!authorized(request)) return json({ error: 'UNAUTHORIZED' }, 401);
  try { return json(await action()); }
  catch { return json({ error: 'INTERNAL_ERROR' }, 500); }
}
