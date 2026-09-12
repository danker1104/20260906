import { describe, expect, it, beforeEach } from 'vitest';
import type { GeminiGateway } from '../../src/lib/ai/gemini-gateway';
import type { PreparedImage } from '../../src/lib/domain/types';
import { runIdentifyPipeline } from '../../src/lib/pipeline/identify-pipeline';

process.env.GEMINI_PRO_MODEL = 'gemini-test-pro';
process.env.GEMINI_FLASH_MODEL = 'gemini-test-flash';
process.env.GEMINI_STAGE_TIMEOUT_MS = '12000';
process.env.GEMINI_TOTAL_TIMEOUT_MS = '60000';

const imageAnalysis = JSON.stringify({
  japaneseTexts: ['今日は一緒に帰らない？'],
  suspectedTitles: [],
  characterNames: ['山田くん'],
  authorClues: [],
  publisherClues: [],
  serializationClues: [],
  visualClues: [],
  imageStatuses: ['SUCCESS'],
});

const japaneseCandidates = JSON.stringify({
  candidates: [{
    rank: 1,
    japaneseTitle: '星の下の彼女',
    author: '山田太郎',
    confidence: 'HIGH',
    evidence: ['DIALOGUE_MATCH'],
    searchSupport: ['dialogue match'],
  }],
});

const koreanInvestigation = JSON.stringify({
  candidateResults: [{
    rank: 1,
    koreanTitle: '별 아래의 그녀',
    koreanTitleStatus: 'COMMON',
    publicationStatus: 'NOT_FOUND',
    investigationStatus: 'SUCCESS',
    searchSupport: ['repeated Korean title'],
  }],
});

const completeJudgment = JSON.stringify({
  candidates: [{
    rank: 1,
    japaneseTitle: '星の下の彼女',
    koreanTitle: '별 아래의 그녀',
    koreanTitleStatus: 'COMMON',
    publicationStatus: 'NOT_FOUND',
    confidence: 'HIGH',
    evidence: ['DIALOGUE_MATCH'],
    author: '山田太郎',
    koreanInvestigationStatus: 'SUCCESS',
  }],
});

const partialJudgment = JSON.stringify({
  candidates: [{
    rank: 1,
    japaneseTitle: '星の下の彼女',
    koreanTitle: null,
    koreanTitleStatus: 'UNKNOWN',
    publicationStatus: 'UNKNOWN',
    confidence: 'HIGH',
    evidence: ['DIALOGUE_MATCH'],
    author: '山田太郎',
    koreanInvestigationStatus: 'FAILED',
  }],
});

class QueueGateway implements GeminiGateway {
  calls = 0;
  constructor(private readonly responses: Array<string | Error>) {}

  async generateContent(): Promise<string> {
    const response = this.responses[this.calls++];
    if (response instanceof Error) {
      throw response;
    }
    if (!response) {
      throw new Error('unexpected extra Gemini call');
    }
    return response;
  }
}

const preparedImage: PreparedImage = {
  buffer: Buffer.from('test-image'),
  mimeType: 'image/png',
  width: 1,
  height: 1,
};

describe('identify pipeline', () => {
  beforeEach(() => {
    process.env.GEMINI_PRO_MODEL = 'gemini-test-pro';
    process.env.GEMINI_FLASH_MODEL = 'gemini-test-flash';
  });

  it('runs four calls in order and returns SUCCESS', async () => {
    const gateway = new QueueGateway([imageAnalysis, japaneseCandidates, koreanInvestigation, completeJudgment]);

    const result = await runIdentifyPipeline([preparedImage], gateway);

    expect(gateway.calls).toBe(4);
    expect(result.status).toBe('SUCCESS');
    expect(result.stages.koreanInvestigation).toBe('SUCCESS');
    expect(result.candidates[0]?.koreanTitle).toBe('별 아래의 그녀');
  });

  it('runs final judgment when Korean investigation fails', async () => {
    const gateway = new QueueGateway([imageAnalysis, japaneseCandidates, new Error('search unavailable'), partialJudgment]);

    const result = await runIdentifyPipeline([preparedImage], gateway);

    expect(gateway.calls).toBe(4);
    expect(result.status).toBe('PARTIAL_SUCCESS');
    expect(result.stages.koreanInvestigation).toBe('FAILED');
    expect(result.stages.finalJudgment).toBe('SUCCESS');
    expect(result.candidates[0]?.koreanTitle).toBeNull();
  });
});
