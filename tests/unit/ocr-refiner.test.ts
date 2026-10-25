import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AzureFoundryGateway } from '../../src/lib/ai/azure-foundry-gateway';
import { refineOcrForSearch } from '../../src/lib/pipeline/stages';
import { refineOcrQueries } from '../../src/lib/search/query-refinement';

describe('OCR refiner fallback contract', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('keeps raw OCR and provides a deterministic fallback when the model is unavailable', () => {
    const rawText = '『犬夜叉』30周年の記念本11月発売 原画集&インタビュー集で';
    const fallback = refineOcrQueries([rawText]);

    expect(fallback.rawText).toBe(rawText);
    expect(fallback.titleCandidates).toEqual(['犬夜叉']);
    expect(fallback.queryType).toBe('TITLE');
  });

  it('rejects a high-confidence account and English caption as a Japanese title', async () => {
    vi.stubEnv('AZURE_FOUNDRY_MODEL', 'manga-judge');
    const gateway: AzureFoundryGateway = {
      generateContent: vi.fn(async () => JSON.stringify({
        titleCandidates: [{ text: 'Follow @creator New chapter is so cute', confidence: 0.99 }],
        dialogueCandidates: [],
        contextKeywords: [],
        noise: [],
        hasUsefulText: true,
      })),
    };

    const result = await refineOcrForSearch(gateway, 'Follow @creator New chapter is so cute');

    expect(result.titleCandidates).toEqual([]);
    expect(result.queryType).toBe('NONE');
  });
});
