import { describe, expect, it } from 'vitest';
import type { Candidate, PreparedImage } from '../../src/lib/domain/types';
import { runIdentifyPipeline, type ResearchProviders } from '../../src/lib/pipeline/identify-pipeline';
import { cleanOcrText, isUsefulJapaneseText } from '../../src/lib/search/ocr-space';

const preparedImage: PreparedImage = {
  buffer: Buffer.from('test-image'),
  mimeType: 'image/png',
  width: 1,
  height: 1,
};

const candidate: Candidate = {
  rank: 1,
  japaneseTitle: '作品名',
  koreanTitle: '작품명',
  koreanTitleStatus: 'OFFICIAL',
  publicationStatus: 'CONFIRMED',
  confidence: 'HIGH',
  evidence: ['WORK_TITLE_MATCH'],
  author: '작가',
  koreanInvestigationStatus: 'SUCCESS',
};

function providers(overrides: Partial<ResearchProviders> = {}): ResearchProviders {
  return {
    ocr: async () => ({ text: '作品名 漫画', valid: true }),
    tavily: async () => [{ title: '作品名 漫画', url: 'https://example.com/work', content: '작품명', score: 0.9 }],
    lens: async () => [],
    judge: async () => [candidate],
    ...overrides,
  };
}

describe('external manga research pipeline', () => {
  it('cleans OCR line breaks, symbols, and duplicate lines', () => {
    const cleaned = cleanOcrText('葬送\nの\nフリーレン!!\n葬送');

    expect(cleaned).toBe('葬送 の フリーレン');
    expect(isUsefulJapaneseText(cleaned)).toBe(true);
    expect(isUsefulJapaneseText('え')).toBe(false);
  });

  it('uses Lens visual matches as candidates when OCR has no useful text', async () => {
    let lensCalls = 0;
    const judgedBundles: import('../../src/lib/search/types').ResearchBundle[] = [];
    const result = await runIdentifyPipeline([preparedImage], {
      ocr: async () => ({ text: 'え', valid: false }),
      lens: async () => {
        lensCalls += 1;
        return [{ title: '薫る花は凛と咲く 第15話', source: 'Example', link: 'https://example.com/lens' }];
      },
      tavily: async (query) => query.includes('한국')
        ? [{ title: '향기로운 꽃은 늠름하게 핀다', url: 'https://www.yes24.com/work', content: '정발 판매', score: 0.9 }]
        : [{ title: '薫る花は凛と咲く 漫画', url: 'https://example.com/work', content: '薫る花は凛と咲く', score: 0.9 }],
      judge: async (bundle) => {
        judgedBundles.push(bundle);
        return [candidate];
      },
    });

    expect(lensCalls).toBe(1);
    expect(judgedBundles[0]?.lensMatches[0]?.title).toContain('薫る花');
    expect(judgedBundles[0]?.candidateSeeds.join(' ')).toContain('薫る花');
    expect(judgedBundles[1]?.ocrTexts).toEqual(['作品名']);
    expect(judgedBundles[1]?.candidateSeeds).toEqual(['作品名']);
    expect(judgedBundles[1]?.lensMatches).toEqual([]);
    expect(judgedBundles[1]?.koreanResults?.length).toBeGreaterThan(0);
    expect(result.status).toBe('SUCCESS');
  });

  it('uses Tavily after valid OCR and skips Lens', async () => {
    let lensCalls = 0;
    let judgmentCalls = 0;
    const providers: ResearchProviders = {
      ocr: async () => ({ text: '作品名 漫画', valid: true }),
      tavily: async () => [{ title: '作品名 漫画', url: 'https://example.com/work', content: '작품명', score: 0.9 }],
      lens: async () => {
        lensCalls += 1;
        return [];
      },
      judge: async () => {
        judgmentCalls += 1;
        return [candidate];
      },
    };

    const result = await runIdentifyPipeline([preparedImage], providers);

    expect(lensCalls).toBe(0);
    expect(judgmentCalls).toBe(2);
    expect(result.status).toBe('SUCCESS');
    expect(result.stages.finalJudgment).toBe('SUCCESS');
    expect(result.candidates[0]?.japaneseTitle).toBe('作品名');
  });

  it('uses one Lens fallback when OCR is not useful', async () => {
    let lensCalls = 0;
    const providers: ResearchProviders = {
      ocr: async () => ({ text: '123 !!!', valid: false }),
      tavily: async () => [],
      lens: async () => {
        lensCalls += 1;
        return [{ title: 'Lens 작품명', source: 'Example', link: 'https://example.com/lens' }];
      },
      judge: async () => [candidate],
    };

    const result = await runIdentifyPipeline([preparedImage], providers);

    expect(lensCalls).toBe(1);
    expect(result.status).toBe('SUCCESS');
    expect(result.stages.imageAnalysis).toBe('SUCCESS');
  });

  it('searches Tavily for short or imperfect OCR instead of falling back immediately', async () => {
    let tavilyCalls = 0;
    let lensCalls = 0;
    const result = await runIdentifyPipeline([preparedImage], {
      ...providers({
        ocr: async () => ({ text: '葬送のフリーしン', valid: true }),
        tavily: async () => {
          tavilyCalls += 1;
          return [{ title: '葬送のフリーレン', url: 'https://example.com/frieren', content: '漫画', score: 0.9 }];
        },
        lens: async () => {
          lensCalls += 1;
          return [];
        },
      }),
    });

    expect(tavilyCalls).toBeGreaterThan(0);
    expect(lensCalls).toBe(0);
    expect(result.status).toBe('SUCCESS');
  });

  it('uses Lens when OCR exists but Tavily returns no useful result', async () => {
    let lensCalls = 0;
    const result = await runIdentifyPipeline([preparedImage], providers({
      ocr: async () => ({ text: '葬送 フリーレン', valid: true }),
      tavily: async () => [],
      lens: async () => {
        lensCalls += 1;
        return [{ title: '葬送のフリーレン', source: 'Example', link: 'https://example.com/lens' }];
      },
    }));

    expect(lensCalls).toBe(1);
    expect(result.status).toBe('SUCCESS');
  });

  it('returns insufficient only when OCR, Tavily, and Lens provide no candidates', async () => {
    const result = await runIdentifyPipeline([preparedImage], providers({
      ocr: async () => ({ text: '', valid: false }),
      tavily: async () => [],
      lens: async () => [],
    }));

    expect(result.status).toBe('INSUFFICIENT');
    expect(result.candidates).toHaveLength(0);
  });

  it('stops Japanese Tavily search after the first strong result', async () => {
    const queries: string[] = [];
    const result = await runIdentifyPipeline([preparedImage], providers({
      tavily: async (query) => {
        queries.push(query);
        return [{ title: '作品名', url: 'https://example.com/work', content: '作品名 漫画', score: 0.95 }];
      },
    }));

    expect(queries.filter((query) => !query.includes('한국')).length).toBe(1);
    expect(queries.filter((query) => query.includes('한국')).length).toBeLessThanOrEqual(2);
    expect(result.status).toBe('SUCCESS');
  });

  it('shares at most two Korean Tavily searches across all candidates', async () => {
    const queries: string[] = [];
    const candidates = [1, 2, 3].map((rank) => ({ ...candidate, rank: rank as 1 | 2 | 3, japaneseTitle: `作品${rank}` }));
    const result = await runIdentifyPipeline([preparedImage], providers({
      ocr: async () => ({ text: '作品1', valid: true }),
      tavily: async (query) => {
        queries.push(query);
        const isKorean = query.includes('한국');
        return [{ title: isKorean ? '작품명 한국 정발' : '作品1', url: `https://example.com/${queries.length}`, content: isKorean ? '공식 한국어 제목 정발' : '作品1 漫画', score: 0.9 }];
      },
      judge: async () => candidates,
    }));

    const koreanQueries = queries.filter((query) => query.includes('한국'));
    expect(koreanQueries.length).toBeLessThanOrEqual(2);
    expect(result.candidates).toHaveLength(1);
  });
});
