import { z } from 'zod';
import { ExternalProviderError, fetchWithTimeout, normalizeText, readJson, requiredApiKey, uniqueBy } from './provider-utils';
import type { WebSearchResult } from './types';
import { hashResearchCacheText, InMemoryTtlCache, redactCredentialText, withoutCredentialQueryParameters } from './memory-cache';

const tavilyResponseSchema = z.object({
  results: z.array(z.object({
    title: z.string().optional(),
    url: z.string().url().optional(),
    content: z.string().optional(),
    score: z.number().optional(),
  }).passthrough()).optional(),
});

const tavilyCache = new InMemoryTtlCache<WebSearchResult[]>({
  clone: (results) => results.map((result) => ({
    ...result,
    title: redactCredentialText(result.title),
    url: withoutCredentialQueryParameters(result.url),
    content: redactCredentialText(result.content),
  })),
});

async function searchTavilyUncached(query: string): Promise<WebSearchResult[]> {
  try {
    const response = await fetchWithTimeout('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api_key: requiredApiKey('TAVILY_API_KEY'),
        query,
        search_depth: 'basic',
        max_results: 5,
        include_answer: false,
        include_raw_content: false,
      }),
    });
    const parsed = tavilyResponseSchema.safeParse(await readJson(response));
    if (!response.ok || !parsed.success) throw new ExternalProviderError('TAVILY_ERROR');

    return uniqueBy((parsed.data.results ?? []).map((result) => ({
      title: normalizeText(result.title ?? ''),
      url: result.url ?? '',
      content: normalizeText(result.content ?? ''),
      score: result.score ?? null,
    })).filter((result) => result.title && result.url), (result) => result.url).slice(0, 5);
  } catch (error) {
    if (error instanceof ExternalProviderError) throw error;
    throw new ExternalProviderError('TAVILY_ERROR');
  }
}

export function searchTavily(query: string): Promise<WebSearchResult[]> {
  const normalizedQuery = query.trim().replace(/\s+/gu, ' ').toLocaleLowerCase();
  return tavilyCache.getOrLoad(
    hashResearchCacheText('tavily-basic-5-v1', normalizedQuery),
    () => searchTavilyUncached(query),
  );
}
