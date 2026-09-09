import { internal } from '@/lib/auth';
import { getDataHealth } from '@/lib/health';
export const runtime = 'nodejs';
export async function GET(request: Request) { return internal(request, () => getDataHealth()); }
