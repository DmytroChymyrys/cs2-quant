import { authorized, json } from '@/lib/auth';
import { collectSkinport } from '@/lib/collectors/skinport-collector';
import { collectorStore } from '@/lib/db/collector-store';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(request: Request) {
  if (!authorized(request)) return json({ error: 'UNAUTHORIZED' }, 401);
  try {
    const result = await collectSkinport(collectorStore());
    return json(result, result.status === 'FAILED' ? 502 : 200);
  } catch { return json({ error: 'COLLECTION_UNAVAILABLE' }, 503); }
}
