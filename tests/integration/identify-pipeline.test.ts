import { describe, expect, it } from 'vitest';
import type { Candidate, PreparedImage } from '../../src/lib/domain/types';
import { runIdentifyPipeline, type ResearchProviders } from '../../src/lib/pipeline/identify-pipeline';

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
    tavily: async () => [{ title: '作品名 漫画', url: 'https://example.com/work', content: '작품명 정발', score: 0.9 }],
    lens: async () => [],
    judge: async () => [candidate],
    ...overrides,
  };
}

describe('external manga research pipeline', () => {
  it('runs one Foundry judgment after OCR and Tavily research', async () => {
    let judgmentCalls = 0;
    const result = await runIdentifyPipeline([preparedImage], providers({
      judge: async () => {
        judgmentCalls += 1;
        return [candidate];
      },
    }));

    expect(judgmentCalls).toBe(2);
    expect(result.status).toBe('SUCCESS');
    expect(result.stages.imageAnalysis).toBe('SUCCESS');
    expect(result.stages.finalJudgment).toBe('SUCCESS');
    expect(result.analysis?.ocr).toContain('作品名 漫画');
  });

  it('returns one candidate and prioritizes the candidate with Korean information', async () => {
    const secondaryCandidate = { ...candidate, rank: 2 as const, japaneseTitle: '다른 작품' };
    const result = await runIdentifyPipeline([preparedImage], providers({
      judge: async () => [
        { ...candidate, rank: 1 as const, koreanTitle: null, koreanTitleStatus: 'UNKNOWN' as const, publicationStatus: 'UNKNOWN' as const },
        secondaryCandidate,
      ],
    }));

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.japaneseTitle).toBe('다른 작품');
    expect(result.candidates[0]?.rank).toBe(1);
  });

  it('keeps only the clean Japanese title when Korean information is unavailable', async () => {
    const result = await runIdentifyPipeline([preparedImage], providers({
      tavily: async () => [{ title: '作品名 漫画', url: 'https://example.com/jp', content: '作品名 漫画', score: 0.9 }],
      judge: async () => [{
        ...candidate,
        japaneseTitle: '葬送のフリーレン 第12話',
        koreanTitle: null,
        koreanTitleStatus: 'UNKNOWN' as const,
        publicationStatus: 'UNKNOWN' as const,
      }],
    }));

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.japaneseTitle).toBe('葬送のフリーレン');
    expect(result.candidates[0]?.koreanTitleStatus).toBe('UNKNOWN');
  });

  it('uses Lens only when OCR is not useful', async () => {
    let lensCalls = 0;
    const result = await runIdentifyPipeline([preparedImage], providers({
      ocr: async () => ({ text: '123 !!!', valid: false }),
      lens: async () => {
        lensCalls += 1;
        return [{ title: 'Lens 작품명', source: 'Example', link: 'https://example.com/lens' }];
      },
    }));

    expect(lensCalls).toBe(1);
    expect(result.status).toBe('SUCCESS');
    expect(result.stages.imageAnalysis).toBe('SUCCESS');
  });

  it('does not promote Korean search snippets when Foundry judgment is unavailable', async () => {
    let judgmentCalls = 0;
    const result = await runIdentifyPipeline([preparedImage], providers({
      tavily: async (query) => query.includes('한국')
        ? [{ title: '작품명 한국어판', url: 'https://www.yes24.com/Product/Detail/123', content: '작품명 정발 공식 판매', score: 0.9 }]
        : [{ title: '作品名 漫画', url: 'https://example.com/jp', content: '作品名 漫画', score: 0.9 }],
      judge: async () => {
        judgmentCalls += 1;
        throw Object.assign(new Error('temporary unavailable'), { status: 503 });
      },
    }));

    expect(judgmentCalls).toBe(1);
    expect(result.status).toBe('FAILED');
    expect(result.verificationStatus).toBe('AI_UNAVAILABLE');
    expect(result.candidates).toHaveLength(0);
  });

  it('stops before provider work when the request deadline has expired', async () => {
    let ocrCalls = 0;
    await expect(runIdentifyPipeline([preparedImage], providers({
      ocr: async () => {
        ocrCalls += 1;
        return { text: '作品名 漫画', valid: true };
      },
    }), Date.now() - 1)).rejects.toThrow('요청 처리 시간이 초과되었습니다.');

    expect(ocrCalls).toBe(0);
  });
});
