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
  it('runs one Gemini judgment after OCR and Tavily research', async () => {
    let judgmentCalls = 0;
    const result = await runIdentifyPipeline([preparedImage], providers({
      judge: async () => {
        judgmentCalls += 1;
        return [candidate];
      },
    }));

    expect(judgmentCalls).toBe(1);
    expect(result.status).toBe('SUCCESS');
    expect(result.stages.imageAnalysis).toBe('SUCCESS');
    expect(result.stages.finalJudgment).toBe('SUCCESS');
    expect(result.analysis?.ocr).toContain('作品名 漫画');
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

  it('keeps Tavily Korean information when Gemini judgment is unavailable', async () => {
    const result = await runIdentifyPipeline([preparedImage], providers({
      tavily: async (query) => query.includes('한국')
        ? [{ title: '작품명 한국어판', url: 'https://example.com/kr', content: '작품명 정발 공식 판매', score: 0.9 }]
        : [{ title: '作品名 漫画', url: 'https://example.com/jp', content: '作品名 漫画', score: 0.9 }],
      judge: async () => {
        throw Object.assign(new Error('temporary unavailable'), { status: 503 });
      },
    }));

    expect(result.status).toBe('PARTIAL_SUCCESS');
    expect(result.verificationStatus).toBe('AI_UNAVAILABLE');
    expect(result.candidates[0]?.koreanTitleStatus).toBe('OFFICIAL');
    expect(result.candidates[0]?.publicationStatus).toBe('CONFIRMED');
  });
});
