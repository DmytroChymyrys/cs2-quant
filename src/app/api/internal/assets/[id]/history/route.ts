import { authorized, json } from '@/lib/auth';
import { getAssetHistory, getAssetPocSummary, getLatestObservation } from '@/lib/analytics';
import { z } from 'zod';
export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!authorized(request)) return json({ error: 'UNAUTHORIZED' }, 401);
  const { id } = await context.params;
  const url = new URL(request.url);
  const query = z.object({ id: z.uuid(), from: z.coerce.date(), to: z.coerce.date() }).safeParse({ id, from: url.searchParams.get('from') ?? new Date(Date.now()-86400000), to: url.searchParams.get('to') ?? new Date() });
  if (!query.success || query.data.from > query.data.to || query.data.to.getTime()-query.data.from.getTime() > 31*86400000) return json({ error: 'INVALID_RANGE', hint: 'Use UUID and ISO from/to dates, at most 31 days.' }, 400);
  try {
    const [history, summary, latest] = await Promise.all([getAssetHistory(id, query.data.from, query.data.to), getAssetPocSummary(id), getLatestObservation(id)]);
    return json({ latest, summary, history });
  } catch { return json({ error: 'INSPECTION_UNAVAILABLE' }, 500); }
}
