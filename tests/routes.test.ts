import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ collect: vi.fn(), store: vi.fn() }));
vi.mock('../src/lib/collectors/skinport-collector', () => ({ collectSkinport: mocks.collect }));
vi.mock('../src/lib/db/collector-store', () => ({ collectorStore: mocks.store }));
import { POST } from '../src/app/api/internal/collect/skinport/route';
import { GET as health } from '../src/app/api/internal/data-health/route';
import { GET as history } from '../src/app/api/internal/assets/[id]/history/route';
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });
it.each([undefined, 'Basic secret', 'Bearer wrong'])('protects every endpoint before work: %s', async authorization => {
  vi.stubEnv('CRON_SECRET','secret');
  const request = new Request('http://localhost', { headers: authorization ? { authorization } : {} });
  for (const response of [await POST(request), await health(request), await history(request,{ params: Promise.resolve({id:'bad'}) })]) {
    expect(response.status).toBe(401); expect(await response.json()).toEqual({error:'UNAUTHORIZED'});
  }
  expect(mocks.store).not.toHaveBeenCalled(); expect(mocks.collect).not.toHaveBeenCalled();
});
it.each([['SUCCESS',200],['PARTIAL',200],['FAILED',502]])('maps authenticated collector %s to HTTP %i', async (status, http) => {
  vi.stubEnv('CRON_SECRET','secret'); mocks.collect.mockResolvedValue({status,collectorRunId:'run'});
  const response = await POST(new Request('http://localhost',{method:'POST',headers:{authorization:'Bearer secret'}}));
  expect(response.status).toBe(http); expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.text()).not.toContain('secret');
});
it('rejects invalid inspection input without querying the database', async () => {
  vi.stubEnv('CRON_SECRET','secret');
  expect((await history(new Request('http://localhost',{headers:{authorization:'Bearer secret'}}),{params:Promise.resolve({id:'bad'})})).status).toBe(400);
});
