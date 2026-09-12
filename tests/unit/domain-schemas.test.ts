import { describe, expect, it } from 'vitest';
import { errorResponseSchema, identifyResponseSchema } from '../../src/lib/domain/schemas';

const validResponse = {
  status: 'SUCCESS',
  requestId: '11111111-1111-4111-8111-111111111111',
  stages: {
    imageAnalysis: 'SUCCESS',
    japaneseIdentification: 'SUCCESS',
    koreanInvestigation: 'SUCCESS',
    finalJudgment: 'SUCCESS',
  },
  candidates: [
    {
      rank: 1,
      japaneseTitle: '作品名',
      koreanTitle: '작품명',
      koreanTitleStatus: 'OFFICIAL',
      publicationStatus: 'CONFIRMED',
      confidence: 'HIGH',
      evidence: ['DIALOGUE_MATCH'],
      author: '작가',
      koreanInvestigationStatus: 'SUCCESS',
    },
  ],
};

describe('domain schemas', () => {
  it('accepts a valid identify response', () => {
    expect(identifyResponseSchema.safeParse(validResponse).success).toBe(true);
  });

  it('rejects more than three candidates or more than five evidence codes', () => {
    const invalid = {
      ...validResponse,
      candidates: Array.from({ length: 4 }, (_, index) => ({
        ...validResponse.candidates[0],
        rank: (index + 1) as 1 | 2 | 3,
        evidence: ['DIALOGUE_MATCH', 'AUTHOR_MATCH', 'WORK_TITLE_MATCH', 'VISUAL_CLUE_MATCH', 'SEARCH_CONSISTENCY', 'PUBLISHER_MATCH'],
      })),
    };

    expect(identifyResponseSchema.safeParse(invalid).success).toBe(false);
  });

  it('accepts structured public errors only', () => {
    expect(errorResponseSchema.safeParse({
      error: {
        code: 'INVALID_IMAGE',
        message: '잘못된 이미지입니다.',
        requestId: validResponse.requestId,
      },
    }).success).toBe(true);
  });
});
