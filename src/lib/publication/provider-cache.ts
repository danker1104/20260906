import type {
  NationalLibraryProvider,
  NationalLibrarySearchParams,
  NationalLibrarySearchResult,
} from './provider';

const DEFAULT_CACHE_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 100;

export function configuredNationalLibraryCacheTtlMs(): number {
  const configured = Number(process.env.NL_API_CACHE_TTL_MS ?? DEFAULT_CACHE_TTL_MS);
  return Number.isFinite(configured) && configured >= 0
    ? Math.min(configured, 60 * 60 * 1000)
    : DEFAULT_CACHE_TTL_MS;
}

function requestKey(params: NationalLibrarySearchParams): string {
  return JSON.stringify([
    params.queryType,
    params.query.trim(),
    params.page,
    params.pageSize,
  ]);
}

function cloneResult(result: NationalLibrarySearchResult): NationalLibrarySearchResult {
  return {
    ...result,
    records: result.records.map((record) => ({ ...record })),
  };
}

export function createCachedNationalLibraryProvider(
  provider: NationalLibraryProvider,
  options: { ttlMs?: number; maxEntries?: number } = {},
): NationalLibraryProvider {
  const cache = new Map<string, { expiresAt: number; result: NationalLibrarySearchResult }>();
  const inFlight = new Map<string, Promise<NationalLibrarySearchResult>>();
  const ttlMs = options.ttlMs ?? configuredNationalLibraryCacheTtlMs();
  const maxEntries = options.maxEntries ?? MAX_CACHE_ENTRIES;

  return {
    mode: provider.mode,
    async search(params, signal): Promise<NationalLibrarySearchResult> {
      const key = requestKey(params);
      const cached = cache.get(key);
      if (cached && cached.expiresAt > Date.now()) return cloneResult(cached.result);
      if (cached) cache.delete(key);

      const existing = inFlight.get(key);
      if (existing) return cloneResult(await existing);

      const request = Promise.resolve().then(() => provider.search(params, signal));
      inFlight.set(key, request);
      try {
        const result = await request;
        if (ttlMs > 0) {
          while (cache.size >= maxEntries) {
            const oldestKey = cache.keys().next().value;
            if (oldestKey === undefined) break;
            cache.delete(oldestKey);
          }
          cache.set(key, { expiresAt: Date.now() + ttlMs, result: cloneResult(result) });
        }
        return cloneResult(result);
      } finally {
        if (inFlight.get(key) === request) inFlight.delete(key);
      }
    },
  };
}