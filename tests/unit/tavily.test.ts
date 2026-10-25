import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchTavily } from '../../src/lib/search/tavily';

describe('Tavily research cache', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('reuses a successful normalized query result and removes credential query parameters', async () => {
    vi.stubEnv('TAVILY_API_KEY', 'test-only-key');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      results: [{
        title: '作品名 漫画',
        url: 'https://publisher.example/work?access_token=source-secret&id=42',
        content: '作品名 is a manga.',
        score: 0.9,
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const first = await searchTavily('Manga Work');
    const second = await searchTavily('  manga   work  ');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(first[0]?.url).toBe('https://publisher.example/work?id=42');
    expect(first[0]?.url).not.toContain('source-secret');
  });
});