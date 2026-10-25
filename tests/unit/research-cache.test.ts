import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PreparedImage } from '../../src/lib/domain/types';
import { configuredResearchCacheTtlMs, hashImageForResearchCache, InMemoryTtlCache, redactCredentialText, withoutCredentialQueryParameters } from '../../src/lib/search/memory-cache';

describe('research memory cache', () => {
  afterEach(() => vi.useRealTimers());

  it('deduplicates concurrent work, reuses successful values until TTL, and expires them', async () => {
    vi.useFakeTimers();
    const cache = new InMemoryTtlCache<string[]>({ ttlMs: 1_000, maxEntries: 2 });
    const load = vi.fn(async () => ['candidate']);

    const [first, concurrent] = await Promise.all([
      cache.getOrLoad('image-hash', load),
      cache.getOrLoad('image-hash', load),
    ]);
    const cached = await cache.getOrLoad('image-hash', load);

    expect(first).toEqual(['candidate']);
    expect(concurrent).toEqual(['candidate']);
    expect(cached).toEqual(['candidate']);
    expect(load).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_001);
    await cache.getOrLoad('image-hash', load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('does not cache failed provider work', async () => {
    const cache = new InMemoryTtlCache<string>({ ttlMs: 1_000 });
    const load = vi.fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('provider failure'))
      .mockResolvedValueOnce('recovered');

    await expect(cache.getOrLoad('query-hash', load)).rejects.toThrow('provider failure');
    await expect(cache.getOrLoad('query-hash', load)).resolves.toBe('recovered');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('caps the configured TTL, supports disabling retained entries, and evicts the oldest item at capacity', async () => {
    vi.stubEnv('MANGAFIND_RESEARCH_CACHE_TTL_MS', '999999999');
    expect(configuredResearchCacheTtlMs()).toBe(60 * 60 * 1000);
    vi.stubEnv('MANGAFIND_RESEARCH_CACHE_TTL_MS', '0');
    expect(configuredResearchCacheTtlMs()).toBe(0);

    const bounded = new InMemoryTtlCache<string>({ ttlMs: 1_000, maxEntries: 2 });
    const loader = vi.fn(async (value: string) => value);
    await bounded.getOrLoad('first', () => loader('first'));
    await bounded.getOrLoad('second', () => loader('second'));
    await bounded.getOrLoad('third', () => loader('third'));
    await bounded.getOrLoad('first', () => loader('first'));
    expect(loader).toHaveBeenCalledTimes(4);
  });

  it('hashes prepared image bytes without retaining the buffer and strips credential query values from cached URLs', () => {
    const image: PreparedImage = {
      buffer: Buffer.from('private-image-bytes'),
      mimeType: 'image/png',
      width: 2,
      height: 3,
    };
    const sameImage: PreparedImage = { ...image, buffer: Buffer.from('private-image-bytes') };
    const differentImage: PreparedImage = { ...image, buffer: Buffer.from('different-image') };

    expect(hashImageForResearchCache(image)).toBe(hashImageForResearchCache(sameImage));
    expect(hashImageForResearchCache(image)).not.toBe(hashImageForResearchCache(differentImage));
    expect(withoutCredentialQueryParameters('https://user:password@example.com/work?id=123&api_key=hidden&utm_source=test#access_token=fragment-secret'))
      .toBe('https://example.com/work?id=123&utm_source=test');
    const sanitizedText = redactCredentialText('api_key=hidden https://example.com/work?token=secret&id=42');
    expect(sanitizedText).not.toContain('hidden');
    expect(sanitizedText).not.toContain('secret');
    expect(sanitizedText).toContain('id=42');
  });
});