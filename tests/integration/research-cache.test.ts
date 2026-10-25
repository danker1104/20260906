import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PreparedImage } from '../../src/lib/domain/types';
import { runIdentifyPipeline } from '../../src/lib/pipeline/identify-pipeline';

describe('default research provider caches', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('reuses OCR, OCR refinement, Tavily, and Foundry results for the same prepared image', async () => {
    vi.stubEnv('OCR_SPACE_API_KEY', 'test-only-ocr-key');
    vi.stubEnv('TAVILY_API_KEY', 'test-only-tavily-key');
    vi.stubEnv('SERPAPI_API_KEY', 'test-only-serpapi-key');
    vi.stubEnv('AZURE_FOUNDRY_ENDPOINT', 'https://mock-foundry.example');
    vi.stubEnv('AZURE_FOUNDRY_API_KEY', 'test-only-foundry-key');
    vi.stubEnv('AZURE_FOUNDRY_MODEL', 'mock-manga-model');
    vi.stubEnv('YES24_API_KEY', '');

    const counts = { ocr: 0, tavily: 0, foundry: 0, lens: 0 };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
      if (url.hostname === 'api.ocr.space') {
        counts.ocr += 1;
        return new Response(JSON.stringify({
          IsErroredOnProcessing: false,
          OCRExitCode: 1,
          ParsedResults: [{ ParsedText: '『虚白の譜』' }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.hostname === 'api.tavily.com') {
        counts.tavily += 1;
        const requestBody = JSON.parse(String(init?.body)) as { query: string };
        const isKorean = requestBody.query.includes('한국');
        return new Response(JSON.stringify({ results: [isKorean
          ? { title: '허백의 악보 한국어판', url: 'https://publisher.example/허백', content: '虚白の譜 정발 판매', score: 0.9 }
          : { title: '虚白の譜 漫画', url: 'https://www.shueisha.co.jp/虚白', content: '虚白の譜 일본 만화', score: 0.9 }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.hostname === 'mock-foundry.example') {
        counts.foundry += 1;
        const requestBody = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> };
        const systemPrompt = requestBody.messages.find((message) => message.role === 'system')?.content ?? '';
        const content = systemPrompt.includes('OCR Query Refiner')
          ? {
            titleCandidates: [{ text: '虚白の譜', confidence: 0.99 }],
            dialogueCandidates: [],
            contextKeywords: [],
            noise: [],
            hasUsefulText: true,
          }
          : systemPrompt.includes('Canonical Manga Title Resolver')
            ? { candidates: [{
              rank: 1,
              detectedTitle: '虚白の譜',
              contentType: 'MANGA',
              canonicalJapaneseTitle: '虚白の譜',
              relatedMangaCandidates: [],
              reason: 'The provided evidence supports this manga title.',
              pronunciation: null,
              confidence: 'HIGH',
              evidence: ['WORK_TITLE_MATCH'],
              author: null,
            }] }
            : { candidates: [{
              rank: 1,
              japaneseTitle: '虚白の譜',
              pronunciation: null,
              koreanTitle: '허백의 악보',
              koreanTitleStatus: 'OFFICIAL',
              publicationStatus: 'CONFIRMED',
              confidence: 'HIGH',
              evidence: ['WORK_TITLE_MATCH'],
              author: null,
              koreanInvestigationStatus: 'SUCCESS',
            }] };
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.hostname === 'serpapi.com') counts.lens += 1;
      throw new Error(`Unexpected mocked test host: ${url.hostname}`);
    });

    const image: PreparedImage = {
      buffer: Buffer.from(`cache-integration-${Math.random()}`),
      mimeType: 'image/png',
      width: 600,
      height: 900,
    };
    const first = await runIdentifyPipeline([image]);
    const firstCounts = { ...counts };
    const second = await runIdentifyPipeline([{ ...image, imageIndex: 2, buffer: Buffer.from(image.buffer) }]);

    expect(first.status).toBe('SUCCESS');
    expect(second.status).toBe('SUCCESS');
    expect(second.candidates[0]?.japaneseTitle).toBe('虚白の譜');
    expect(counts).toEqual(firstCounts);
    expect(firstCounts).toEqual({ ocr: 1, tavily: 2, foundry: 3, lens: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
});