import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../../src/app/api/publication/yes24/route';

function requestFor(params: Record<string, string>): Request {
  const url = new URL('http://localhost/api/publication/yes24');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return new Request(url);
}

describe('GET /api/publication/yes24', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('rejects a request with neither title nor isbn', async () => {
    const response = await GET(requestFor({}));
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error.code).toBe('INVALID_QUERY');
  });

  it('never calls the real YES24 API in the default mock mode, even when a key is configured', async () => {
    vi.stubEnv('YES24_API_KEY', 'test-key');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const response = await GET(requestFor({ title: '테스트 작품 A' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.mode).toBe('mock');
    expect(body.matched).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('skips the call when live mode has no API key configured', async () => {
    vi.stubEnv('NL_API_MODE', 'live');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const response = await GET(requestFor({ title: '테스트 작품 B (no key case)' }));
    const body = await response.json();

    expect(body.matched).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('calls YES24 only in live mode with a key configured, and caches the result', async () => {
    vi.stubEnv('NL_API_MODE', 'live');
    vi.stubEnv('YES24_API_KEY', 'test-key');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ items: [{ itemId: '1', title: '테스트 작품 A 1권', productUrl: 'https://www.yes24.com/Product/Goods/1' }] }), { status: 200 }),
    );

    const first = await GET(requestFor({ isbn: '979-11-00000-01-4', title: '테스트 작품 A 1권' }));
    const firstBody = await first.json();
    expect(firstBody.matched).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const second = await GET(requestFor({ isbn: '979-11-00000-01-4', title: '테스트 작품 A 1권' }));
    const secondBody = await second.json();
    expect(secondBody.matched).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
