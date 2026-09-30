import { authorized, json } from '@/lib/auth';
import { collectSteamWebApi } from '@/lib/collectors/steamwebapi-collector';
import { collectorStore } from '@/lib/db/collector-store';
export const runtime = 'nodejs';
// The probe measured a 7.9s full-universe response; the rest is transform and
// persistence across ~39.7k assets, so this needs more than the Skinport route.
export const maxDuration = 300;
export async function POST(request: Request) {
  if (!authorized(request)) return json({ error: 'UNAUTHORIZED' }, 401);
  try {
    const result = await collectSteamWebApi({ store: collectorStore() });
    // A run that fetched successfully but failed to persist is not a 200.
    const failed = result.status === 'FAILED' || !result.persistenceHealthy;
    return json(result, failed ? 502 : 200);
  } catch { return json({ error: 'COLLECTION_UNAVAILABLE' }, 503); }
}
