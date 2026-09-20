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
});
