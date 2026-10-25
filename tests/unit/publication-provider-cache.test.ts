import { describe, expect, it, vi } from 'vitest';
import { createCachedNationalLibraryProvider } from '../../src/lib/publication/provider-cache';
import type { NationalLibraryProvider, NationalLibrarySearchResult } from '../../src/lib/publication/provider';

const params = { query: '가상 작품', queryType: 'TITLE' as const, page: 1, pageSize: 10 };
const result: NationalLibrarySearchResult = {
  pageNo: 1,
  records: [],
  totalCount: 0,
  hasMore: false,
};

function fakeProvider(search: NationalLibraryProvider['search']) {
  return { mode: 'live' as const, search };
}

describe('National Library provider cache', () => {
  it('caches successful results for the configured TTL and separates query pages', async () => {
    const search = vi.fn<NationalLibraryProvider['search']>().mockResolvedValue(result);
    const provider = createCachedNationalLibraryProvider(fakeProvider(search), { ttlMs: 5_000 });

    await provider.search(params);
    await provider.search(params);
    await provider.search({ ...params, page: 2 });

    expect(search).toHaveBeenCalledTimes(2);
  });

  it('coalesces simultaneous requests for the same query/page', async () => {
    let resolveSearch: ((value: NationalLibrarySearchResult) => void) | undefined;
    const search = vi.fn<NationalLibraryProvider['search']>(() => new Promise((resolve) => {
      resolveSearch = resolve;
    }));
    const provider = createCachedNationalLibraryProvider(fakeProvider(search), { ttlMs: 5_000 });

    const first = provider.search(params);
    const second = provider.search(params);
    await Promise.resolve();
    expect(search).toHaveBeenCalledTimes(1);
    resolveSearch?.(result);
    await expect(Promise.all([first, second])).resolves.toEqual([result, result]);
  });

  it('does not cache rejected provider results', async () => {
    const search = vi.fn<NationalLibraryProvider['search']>()
      .mockRejectedValueOnce(new Error('mock failure'))
      .mockResolvedValueOnce(result);
    const provider = createCachedNationalLibraryProvider(fakeProvider(search), { ttlMs: 5_000 });

    await expect(provider.search(params)).rejects.toThrow('mock failure');
    await expect(provider.search(params)).resolves.toEqual(result);
    expect(search).toHaveBeenCalledTimes(2);
  });

  it('expires cached results when the TTL elapses', async () => {
    vi.useFakeTimers();
    try {
      const search = vi.fn<NationalLibraryProvider['search']>().mockResolvedValue(result);
      const provider = createCachedNationalLibraryProvider(fakeProvider(search), { ttlMs: 1_000 });

      await provider.search(params);
      vi.advanceTimersByTime(1_001);
      await provider.search(params);

      expect(search).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});