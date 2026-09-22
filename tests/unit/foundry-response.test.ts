import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResearchBundle } from '../../src/lib/search/types';
import { finalJudgment } from '../../src/lib/pipeline/stages';
import type { AzureFoundryGateway } from '../../src/lib/ai/azure-foundry-gateway';

describe('Foundry Korean verifier response handling', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('keeps the Korean result when Foundry returns more than five evidence codes', async () => {
    vi.stubEnv('AZURE_FOUNDRY_MODEL', 'manga-judge');
    const research: ResearchBundle = {
      ocrTexts: ['canonical-title'],
      tavilyResults: [],
      lensMatches: [],
      candidateSeeds: ['canonical-title'],
      koreanResults: [{ title: 'verified-title', url: 'https://example.com/work', content: 'publisher publication', score: 0.9 }],
      koreanTitleCandidates: ['verified-title'],
      koreanOfficialTitleCandidates: ['verified-title'],
    };
    const gateway: AzureFoundryGateway = {
      generateContent: vi.fn(async () => JSON.stringify({
        candidates: [{
          rank: 1,
          japaneseTitle: research.candidateSeeds[0],
          pronunciation: null,
          koreanTitle: research.koreanTitleCandidates?.[0] ?? null,
          koreanTitleStatus: 'OFFICIAL',
          publicationStatus: 'CONFIRMED',
          confidence: 'HIGH',
          evidence: [
            'WORK_TITLE_MATCH',
            'AUTHOR_MATCH',
            'PUBLISHER_MATCH',
            'SERIALIZATION_MATCH',
            'SEARCH_CONSISTENCY',
            'DIALOGUE_MATCH',
            'VISUAL_CLUE_MATCH',
          ],
          author: null,
          koreanInvestigationStatus: 'SUCCESS',
        }],
      })),
    };
    const result = await finalJudgment(gateway, research);

    expect(result.status).toBe('SUCCESS');
    expect(result.data?.[0]?.evidence).toHaveLength(5);
    expect(result.data?.[0]?.koreanTitle).toBe(research.koreanTitleCandidates?.[0]);
    expect(result.data?.[0]?.publicationStatus).toBe('CONFIRMED');
    expect(result.failureReason).toBeUndefined();
  });

  it('accepts a repeated common title from independent Korean sources but rejects an unsupported common label', async () => {
    vi.stubEnv('AZURE_FOUNDRY_MODEL', 'manga-judge');
    const gateway: AzureFoundryGateway = {
      generateContent: vi.fn(async () => JSON.stringify({
        candidates: [{
          rank: 1,
          japaneseTitle: 'canonical-title',
          pronunciation: null,
          koreanTitle: 'generated-title',
          koreanTitleStatus: 'COMMON',
          publicationStatus: 'NOT_FOUND',
          confidence: 'MEDIUM',
          evidence: ['WORK_TITLE_MATCH'],
          author: null,
          koreanInvestigationStatus: 'SUCCESS',
        }],
      })),
    };
    const research: ResearchBundle = {
      ocrTexts: ['canonical-title'],
      tavilyResults: [],
      lensMatches: [],
      candidateSeeds: ['canonical-title'],
      koreanResults: [
        { title: 'community-title', url: 'https://community.example/one', content: 'community-title', score: 0.9 },
        { title: 'community-title', url: 'https://blog.example/two', content: 'community-title', score: 0.8 },
      ],
      koreanTitleCandidates: ['community-title'],
      koreanCommonTitleCandidates: ['community-title'],
    };

    const result = await finalJudgment(gateway, research);

    expect(result.status).toBe('SUCCESS');
    expect(result.data?.[0]?.koreanTitleStatus).toBe('TRANSLATED');
    expect(result.data?.[0]?.publicationStatus).toBe('UNKNOWN');
  });

  it('preserves COMMON when the model selects a repeated evidence-backed title', async () => {
    vi.stubEnv('AZURE_FOUNDRY_MODEL', 'manga-judge');
    const gateway: AzureFoundryGateway = {
      generateContent: vi.fn(async () => JSON.stringify({
        candidates: [{
          rank: 1,
          japaneseTitle: 'canonical-title',
          pronunciation: null,
          koreanTitle: 'community-title',
          koreanTitleStatus: 'COMMON',
          publicationStatus: 'NOT_FOUND',
          confidence: 'MEDIUM',
          evidence: ['WORK_TITLE_MATCH', 'SEARCH_CONSISTENCY'],
          author: null,
          koreanInvestigationStatus: 'SUCCESS',
        }],
      })),
    };
    const result = await finalJudgment(gateway, {
      ocrTexts: ['canonical-title'],
      tavilyResults: [],
      lensMatches: [],
      candidateSeeds: ['canonical-title'],
      koreanResults: [
        { title: 'community-title', url: 'https://community.example/one', content: 'community-title', score: 0.9 },
        { title: 'community-title', url: 'https://blog.example/two', content: 'community-title', score: 0.8 },
      ],
      koreanCommonTitleCandidates: ['community-title'],
    });

    expect(result.data?.[0]?.koreanTitle).toBe('community-title');
    expect(result.data?.[0]?.koreanTitleStatus).toBe('COMMON');
  });

  it('uses canonicalJapaneseTitle instead of a related-content detectedTitle', async () => {
    vi.stubEnv('AZURE_FOUNDRY_MODEL', 'manga-judge');
    const gateway: AzureFoundryGateway = {
      generateContent: vi.fn(async () => JSON.stringify({
        candidates: [{
          rank: 1,
          detectedTitle: '작품명 30주년 원화집 인터뷰집',
          contentType: 'ANNIVERSARY_BOOK',
          canonicalJapaneseTitle: '作品名',
          relatedMangaCandidates: ['作品名'],
          reason: 'The evidence identifies an anniversary artbook based on the original manga.',
          japaneseTitle: '작품명 30주년 원화집 인터뷰집',
          pronunciation: null,
          koreanTitle: null,
          koreanTitleStatus: 'UNKNOWN',
          publicationStatus: 'UNKNOWN',
          confidence: 'HIGH',
          evidence: ['WORK_TITLE_MATCH', 'SEARCH_CONSISTENCY'],
          author: null,
          koreanInvestigationStatus: 'SKIPPED',
        }],
      })),
    };

    const result = await finalJudgment(gateway, {
      ocrTexts: ['作品名 30周年 原画集'],
      tavilyResults: [{ title: '作品名 30周年 原画集 インタビュー集', url: 'https://example.com/book', content: '作品名を原作とする関連書籍', score: 0.9 }],
      lensMatches: [],
      candidateSeeds: ['作品名 30周年 原画集 インタビュー集'],
    });

    expect(result.status).toBe('SUCCESS');
    expect(result.data?.[0]?.japaneseTitle).toBe('作品名');
  });

  it.each([
    'MANGA',
    'MANGA_VOLUME',
    'ARTBOOK',
    'FANBOOK',
    'INTERVIEW_BOOK',
    'ANNIVERSARY_BOOK',
    'NOVEL',
    'ARTICLE',
    'FANART',
    'SNS_POST',
    'MERCHANDISE',
  ] as const)('keeps the original title separate for %s related content', async (contentType) => {
    vi.stubEnv('AZURE_FOUNDRY_MODEL', 'manga-judge');
    const gateway: AzureFoundryGateway = {
      generateContent: vi.fn(async () => JSON.stringify({
        candidates: [{
          rank: 1,
          detectedTitle: `related-${contentType}`,
          contentType,
          canonicalJapaneseTitle: '作品名',
          relatedMangaCandidates: ['作品名'],
          reason: 'The supplied evidence links the related item to the original manga.',
          pronunciation: null,
          confidence: 'MEDIUM',
          evidence: ['WORK_TITLE_MATCH'],
          author: null,
        }],
      })),
    };

    const result = await finalJudgment(gateway, {
      ocrTexts: ['作品名'],
      tavilyResults: [{ title: `related-${contentType}`, url: 'https://example.com/item', content: 'works based on 作品名', score: 0.8 }],
      lensMatches: [],
      candidateSeeds: [`related-${contentType}`],
    });

    expect(result.status).toBe('SUCCESS');
    expect(result.data?.[0]?.japaneseTitle).toBe('作品名');
  });
});
