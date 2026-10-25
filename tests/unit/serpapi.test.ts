import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PreparedImage } from '../../src/lib/domain/types';
import { searchGoogleLens } from '../../src/lib/search/serpapi';

const image: PreparedImage = {
  buffer: Buffer.from('synthetic-image'),
  mimeType: 'image/png',
  width: 800,
  height: 1200,
  imageIndex: 0,
};

describe('SerpApi Google Lens response parsing', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('parses all visual matches and retains candidate context fields using mocked responses', async () => {
    vi.stubEnv('SERPAPI_API_KEY', 'test-only-key');
    const visualMatches = Array.from({ length: 12 }, (_, index) => ({
      title: index === 11 ? 'Xの投稿' : `漫画結果 ${index + 1}`,
      source: index === 11 ? 'X' : 'Example',
      link: index === 11 ? 'https://example.com/result/12?token=source-secret&id=12' : `https://example.com/result/${index + 1}`,
      position: index === 10 ? 'unavailable' : index + 1,
      ...(index === 11 ? { snippet: '新作漫画 #灰宮先輩は怖くてかわいい', score: 0.93 } : {}),
    }));
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ image_id: 'mock-image-id' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ visual_matches: visualMatches }), { status: 200 }));

    const results = await searchGoogleLens(image);
    const cachedResults = await searchGoogleLens({ ...image, imageIndex: 2, buffer: Buffer.from('synthetic-image') });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(12);
    expect(cachedResults).toEqual(results);
    expect(results[11]?.link).toBe('https://example.com/result/12?id=12');
    expect(results[11]?.link).not.toContain('source-secret');
    expect(results[10]?.position).toBe(11);
    expect(results[11]).toMatchObject({
      title: 'Xの投稿',
      position: 12,
      snippet: '新作漫画 #灰宮先輩は怖くてかわいい',
      matchScore: 0.93,
    });
  });
});