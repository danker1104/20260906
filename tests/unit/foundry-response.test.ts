import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResearchBundle } from '../../src/lib/search/types';
import { finalJudgment } from '../../src/lib/pipeline/stages';
import type { AzureFoundryGateway } from '../../src/lib/ai/azure-foundry-gateway';

describe('Foundry Korean verifier response handling', () => {
  it.each([
    { official: ['스파이 패밀리'], common: [], expectedStatus: 'OFFICIAL' },
    { official: ['스파이x패밀리'], common: ['스파이 패밀리'], expectedStatus: 'COMMON' },
    { official: ['스파이x패밀리'], common: [], expectedStatus: 'TRANSLATED' },
  ])('prioritizes the verified NamuWiki name without inventing title or release status: $expectedStatus', async ({ official, common, expectedStatus }) => {
    vi.stubEnv('AZURE_FOUNDRY_MODEL', 'mock-manga-judge');
    const gateway: AzureFoundryGateway = {
      generateContent: vi.fn(async () => JSON.stringify({ candidates: [{
        rank: 1, japaneseTitle: 'SPY×FAMILY', koreanTitle: '스파이x패밀리', koreanTitleStatus: 'OFFICIAL',
        publicationStatus: 'CONFIRMED', confidence: 'HIGH', evidence: ['WORK_TITLE_MATCH'], author: null,
        koreanInvestigationStatus: 'SUCCESS',
      }] })),
    };
    const outcome = await finalJudgment(gateway, {
      ocrTexts: ['SPY×FAMILY'], candidateSeeds: ['SPY×FAMILY'], tavilyResults: [], lensMatches: [], koreanResults: [],
      koreanVerifiedAliases: ['스파이 패밀리'], koreanOfficialTitleCandidates: official, koreanCommonTitleCandidates: common,
    });
    expect(outcome.data?.[0]?.koreanTitle).toBe('스파이 패밀리');
    expect(outcome.data?.[0]?.koreanTitleStatus).toBe(expectedStatus);
    expect(outcome.data?.[0]?.publicationStatus).toBe(expectedStatus === 'OFFICIAL' ? 'CONFIRMED' : 'UNKNOWN');
  });

  it('falls back to the established title when verified NamuWiki names conflict', async () => {
    vi.stubEnv('AZURE_FOUNDRY_MODEL', 'mock-manga-judge');
    const gateway: AzureFoundryGateway = {
      generateContent: vi.fn(async () => JSON.stringify({ candidates: [{
        rank: 1, japaneseTitle: '星空の図書館', koreanTitle: '별하늘의 도서관', koreanTitleStatus: 'OFFICIAL',
        publicationStatus: 'CONFIRMED', confidence: 'HIGH', evidence: ['WORK_TITLE_MATCH'], author: null,
        koreanInvestigationStatus: 'SUCCESS',
      }] })),
    };
    const outcome = await finalJudgment(gateway, {
      ocrTexts: ['星空の図書館'], candidateSeeds: ['星空の図書館'], tavilyResults: [], lensMatches: [], koreanResults: [],
      koreanVerifiedAliases: ['밤하늘 책방', '별하늘 서점'], koreanOfficialTitleCandidates: ['별하늘의 도서관'],
    });
    expect(outcome.data?.[0]?.koreanTitle).toBe('별하늘의 도서관');
    expect(outcome.data?.[0]?.koreanTitleStatus).toBe('OFFICIAL');
  });

  it.each([
    { reference: '정반대인 너와 나', titles: ['정반대의 너와 나'], expected: '정반대의 너와 나', status: 'OFFICIAL' },
    { reference: '별빛 아래 우리들의 도서관', titles: ['별빛 아래 우리들의 도서관들'], expected: '별빛 아래 우리들의 도서관들', status: 'OFFICIAL' },
    { reference: '정반대인 너와 나', titles: ['완전히 다른 이야기'], expected: '정반대인 너와 나', status: 'TRANSLATED' },
    { reference: '가나다라마', titles: ['가나다라바'], expected: '가나다라바', status: 'OFFICIAL' },
    { reference: '가나다라마', titles: ['가나다바바'], expected: '가나다라마', status: 'TRANSLATED' },
    { reference: '별빛 아래 우리들의 도서관', titles: ['별빛 아래 우리들의 도서관들', '별빛 아래 우리들의 도서관은'], expected: '별빛 아래 우리들의 도서관', status: 'TRANSLATED' },
  ])('uses a unique source-backed Korean title above 90 percent similarity: $reference / $titles', async ({ reference, titles, expected, status }) => {
    vi.stubEnv('AZURE_FOUNDRY_MODEL', 'mock-manga-judge');
    const gateway: AzureFoundryGateway = {
      generateContent: vi.fn(async () => JSON.stringify({ candidates: [{
        rank: 1, japaneseTitle: '星空の図書館', koreanTitle: reference, koreanTitleStatus: 'TRANSLATED',
        publicationStatus: 'UNKNOWN', confidence: 'LOW', evidence: ['WORK_TITLE_MATCH'], author: null,
        koreanInvestigationStatus: 'SUCCESS',
      }] })),
    };
    const outcome = await finalJudgment(gateway, {
      ocrTexts: ['星空の図書館'], candidateSeeds: ['星空の図書館'], tavilyResults: [], lensMatches: [],
      koreanSearchTranslation: reference, koreanOfficialTitleCandidates: titles, koreanResults: [],
    });
    expect(outcome.data?.[0]?.koreanTitle).toBe(expected);
    expect(outcome.data?.[0]?.koreanTitleStatus).toBe(status);
    expect(outcome.data?.[0]?.publicationStatus).toBe('UNKNOWN');
  });

  it('keeps a source-supported Japanese-name reading instead of overwriting it with the initial reference', async () => {
    vi.stubEnv('AZURE_FOUNDRY_MODEL', 'mock-manga-judge');
    const title = '灰宮先輩は怖くてかわいい';
    const corrected = '하이미야 선배는 무섭고 귀엽다';
    const gateway: AzureFoundryGateway = {
      generateContent: vi.fn(async () => JSON.stringify({ candidates: [{
        rank: 1, japaneseTitle: title, koreanTitle: corrected, koreanTitleStatus: 'TRANSLATED',
        publicationStatus: 'UNKNOWN', confidence: 'LOW', evidence: ['WORK_TITLE_MATCH'], author: null,
        koreanInvestigationStatus: 'SUCCESS',
      }] })),
    };
    const result = await finalJudgment(gateway, {
      ocrTexts: [title], candidateSeeds: [title], tavilyResults: [], lensMatches: [],
      koreanSearchTranslation: '회궁선배는 무섭고 귀엽다', koreanTitleCandidates: [corrected],
      koreanResults: [{ title: corrected, url: 'https://community.example/name-reading', content: `${title} 작품 소개`, score: 0.9 }],
    });
    expect(result.data?.[0]?.koreanTitle).toBe(corrected);
    expect(result.data?.[0]?.koreanTitleStatus).toBe('TRANSLATED');
    expect(result.data?.[0]?.publicationStatus).toBe('UNKNOWN');
  });

  it('does not infer publication of a COMMON name from another official title (Case 01)', async () => {
    vi.stubEnv('AZURE_FOUNDRY_MODEL', 'mock-manga-judge');
    const title = '放課後のアイドルには秘密がある';
    const alias = '방과 후의 아이돌에게는 비밀이 있다';
    const gateway: AzureFoundryGateway = {
      generateContent: vi.fn(async () => JSON.stringify({ candidates: [{
        rank: 1, japaneseTitle: title, koreanTitle: alias, koreanTitleStatus: 'COMMON', publicationStatus: 'CONFIRMED',
        confidence: 'HIGH', evidence: ['WORK_TITLE_MATCH'], author: null, koreanInvestigationStatus: 'SUCCESS',
      }] })),
    };
    const result = await finalJudgment(gateway, {
      ocrTexts: [title], candidateSeeds: [title], tavilyResults: [], lensMatches: [], koreanResults: [],
      koreanCommonTitleCandidates: [alias], koreanOfficialTitleCandidates: ['다른 공식 제목'],
    });
    expect(result.data?.[0]?.koreanTitleStatus).toBe('COMMON');
    expect(result.data?.[0]?.publicationStatus).toBe('UNKNOWN');
  });

  it.each([false, true])('retains grounded canonical results without accepting an ungrounded claim (claimed title: %s, Case 02)', async (claimedTitle) => {
    vi.stubEnv('AZURE_FOUNDRY_MODEL', 'mock-manga-judge');
    const title = '灰宮先輩は怖くてかわいい';
    const gateway: AzureFoundryGateway = {
      generateContent: vi.fn(async () => JSON.stringify({ candidates: [
        { rank: 1, detectedTitle: '灰宮先生は', contentType: 'MANGA', canonicalJapaneseTitle: title,
          titleVerificationStatus: 'VERIFIED', relatedMangaCandidates: [], reason: 'Mock official work page',
          confidence: 'HIGH', evidence: ['WORK_TITLE_MATCH'], author: '神山すむ' },
        { rank: 2, detectedTitle: '不明', contentType: 'UNKNOWN', canonicalJapaneseTitle: claimedTitle ? title : null,
          titleVerificationStatus: 'UNVERIFIED', relatedMangaCandidates: [], reason: 'No work evidence',
          confidence: 'LOW', evidence: [], author: null },
      ] })),
    };
    const result = await finalJudgment(gateway, {
      ocrTexts: ['灰宮先生は'], rawOcrText: '灰宮先生は', candidateSeeds: [title], verifiedOcrTitles: [title], lensMatches: [],
      tavilyResults: [{ title, url: 'https://www.kadokawa.co.jp/mock-case02', content: `${title} 漫画 連載`, searchCandidateTitle: title, score: 0.9 }],
    });
    expect(result.status).toBe(claimedTitle ? 'FAILED' : 'SUCCESS');
    if (!claimedTitle) {
      expect(result.data).toHaveLength(1);
      expect(result.data?.[0]?.japaneseTitle).toBe(title);
      expect(result.data?.[0]?.evidence.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('prefers a verified published alias even when the model repeats the literal translation', async () => {
    vi.stubEnv('AZURE_FOUNDRY_MODEL', 'mock-manga-judge');
    const gateway: AzureFoundryGateway = {
      generateContent: vi.fn(async () => JSON.stringify({ candidates: [{
        rank: 1, japaneseTitle: '星空の図書館', koreanTitle: '별하늘의 도서관', koreanTitleStatus: 'TRANSLATED',
        publicationStatus: 'UNKNOWN', confidence: 'HIGH', evidence: ['WORK_TITLE_MATCH'], author: null,
        koreanInvestigationStatus: 'SUCCESS',
      }] })),
    };
    const outcome = await finalJudgment(gateway, {
      ocrTexts: ['星空の図書館'], tavilyResults: [], lensMatches: [], candidateSeeds: ['星空の図書館'],
      koreanSearchTranslation: '별하늘의 도서관', koreanResults: [],
      koreanVerifiedAliases: ['밤하늘 책방'], koreanOfficialTitleCandidates: ['밤하늘 책방'],
    });
    expect(outcome.data?.[0]?.koreanTitle).toBe('밤하늘 책방');
    expect(outcome.data?.[0]?.koreanTitleStatus).toBe('OFFICIAL');
    expect(outcome.data?.[0]?.publicationStatus).toBe('UNKNOWN');
  });

  it.each([null, '방과 후 아이돌에게는 비밀이 있다'])('does not accept a Japanese original as a Korean title (reference: %s)', async (translation) => {
    vi.stubEnv('AZURE_FOUNDRY_MODEL', 'mock-manga-judge');
    const title = '放課後のアイドルには秘密がある';
    const gateway: AzureFoundryGateway = {
      generateContent: vi.fn(async () => JSON.stringify({ candidates: [{
        rank: 1, japaneseTitle: title, koreanTitle: title, koreanTitleStatus: 'COMMON',
        publicationStatus: 'CONFIRMED', confidence: 'HIGH', evidence: ['WORK_TITLE_MATCH'],
        author: null, koreanInvestigationStatus: 'SUCCESS',
      }] })),
    };
    const outcome = await finalJudgment(gateway, {
      ocrTexts: [title], lensMatches: [], tavilyResults: [], candidateSeeds: [title],
      koreanResults: [], koreanCommonTitleCandidates: [title],
      koreanSearchTranslation: translation,
    });
    expect(outcome.data?.[0]?.koreanTitle).toBe(translation);
    expect(outcome.data?.[0]?.koreanTitleStatus).toBe(translation ? 'TRANSLATED' : 'UNKNOWN');
    expect(outcome.data?.[0]?.publicationStatus).toBe('UNKNOWN');
  });

  it.each([
    { translation: '별하늘의 도서관', expected: '별하늘의 도서관' },
    { translation: '星空の図書館', expected: null },
    { translation: '', expected: null },
    { translation: 'Library', expected: null },
    { translation: 123, expected: null },
  ])('handles an optional search translation without losing the canonical work: $translation', async ({ translation, expected }) => {
    vi.stubEnv('AZURE_FOUNDRY_MODEL', 'mock-manga-judge');
    const gateway: AzureFoundryGateway = {
      generateContent: vi.fn(async () => JSON.stringify({ candidates: [{
        rank: 1, detectedTitle: '星空の図書館', contentType: 'MANGA', canonicalJapaneseTitle: '星空の図書館',
        koreanSearchTranslation: translation, titleVerificationStatus: 'VERIFIED',
        relatedMangaCandidates: [], reason: 'Mock title evidence', confidence: 'HIGH',
        evidence: ['WORK_TITLE_MATCH'], author: null,
      }] })),
    };
    const outcome = await finalJudgment(gateway, {
      ocrTexts: ['星空の図書館'], lensMatches: [], candidateSeeds: ['星空の図書館'],
      tavilyResults: [{ title: '星空の図書館', url: 'https://www.shueisha.co.jp/work', content: '漫画', score: 0.9 }],
    });
    expect(outcome.status).toBe('SUCCESS');
    expect(outcome.data?.[0]).toHaveProperty('koreanSearchTranslation', expected);
    expect(outcome.data?.[0]?.koreanTitle).toBeNull();
    expect(outcome.data?.[0]?.koreanTitleStatus).toBe('UNKNOWN');
    expect(gateway.generateContent).toHaveBeenCalledTimes(1);
  });

  it('uses a reference translation instead of an unsupported Korean work title', async () => {
    vi.stubEnv('AZURE_FOUNDRY_MODEL', 'mock-manga-judge');
    const gateway: AzureFoundryGateway = {
      generateContent: vi.fn(async () => JSON.stringify({ candidates: [{
        rank: 1, japaneseTitle: '星空の図書館', koreanTitle: '다른 작품', koreanTitleStatus: 'OFFICIAL',
        publicationStatus: 'CONFIRMED', confidence: 'HIGH', evidence: ['WORK_TITLE_MATCH'], author: null,
        koreanInvestigationStatus: 'SUCCESS',
      }] })),
    };
    const outcome = await finalJudgment(gateway, {
      ocrTexts: ['星空の図書館'], tavilyResults: [], lensMatches: [], candidateSeeds: ['星空の図書館'],
      koreanSearchTranslation: '별하늘의 도서관', koreanResults: [],
    });
    expect(outcome.data?.[0]?.koreanTitle).toBe('별하늘의 도서관');
    expect(outcome.data?.[0]?.koreanTitleStatus).toBe('TRANSLATED');
    expect(outcome.data?.[0]?.publicationStatus).toBe('UNKNOWN');
  });

  it.each(['https://www.yes24.com/work', 'https://www.nl.go.kr/work'])('rejects canonical identity supported only by %s', async (url) => {
    vi.stubEnv('AZURE_FOUNDRY_MODEL', 'mock-manga-judge');
    const gateway: AzureFoundryGateway = {
      generateContent: vi.fn(async () => JSON.stringify({ candidates: [{
        rank: 1, detectedTitle: '星空の図書館', contentType: 'MANGA', canonicalJapaneseTitle: '星空の図書館',
        titleVerificationStatus: 'VERIFIED', relatedMangaCandidates: [], reason: 'Mock title evidence',
        confidence: 'HIGH', evidence: ['WORK_TITLE_MATCH'], author: null,
      }] })),
    };
    const outcome = await finalJudgment(gateway, {
      ocrTexts: ['星空の図書館'], lensMatches: [], candidateSeeds: ['星空の図書館'],
      tavilyResults: [{ title: '星空の図書館', content: '漫画 公式連載', url, score: 0.9 }],
    });
    expect(outcome.data).toEqual([]);
    expect(outcome.status).toBe('INSUFFICIENT');
  });

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
          detectedTitle: '作品名 30周年 原画集 インタビュー集',
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

  it('consolidates a character clue and its verified manga into one canonical work', async () => {
    vi.stubEnv('AZURE_FOUNDRY_MODEL', 'manga-judge');
    const character = '星野あかり';
    const title = '星空の図書館';
    const gateway: AzureFoundryGateway = {
      generateContent: vi.fn(async () => JSON.stringify({ candidates: [
        { rank: 1, detectedTitle: character, contentType: 'OTHER', canonicalJapaneseTitle: title,
          titleVerificationStatus: 'VERIFIED', relatedMangaCandidates: [title], reason: 'The supplied character page identifies the manga.',
          confidence: 'MEDIUM', evidence: ['CHARACTER_NAME_MATCH'], author: null },
        { rank: 2, detectedTitle: title, contentType: 'PUBLISHED_MANGA', canonicalJapaneseTitle: title,
          titleVerificationStatus: 'VERIFIED', relatedMangaCandidates: [], reason: 'The supplied publisher page verifies the full title.',
          confidence: 'HIGH', evidence: ['WORK_TITLE_MATCH', 'PUBLISHER_MATCH'], author: '作品の作者' },
        { rank: 3, detectedTitle: '無関係な候補', contentType: 'UNKNOWN', canonicalJapaneseTitle: null,
          titleVerificationStatus: 'UNVERIFIED', relatedMangaCandidates: [], reason: 'No manga evidence.',
          confidence: 'LOW', evidence: [], author: null },
      ] })),
    };

    const outcome = await finalJudgment(gateway, {
      ocrTexts: [character], candidateSeeds: [character, title, '無関係な候補'], lensMatches: [],
      tavilyResults: [
        { title: character, url: 'https://www.shueisha.co.jp/mock-character', searchCandidateTitle: character,
          content: `${character}は漫画『${title}』の登場人物。`, score: 0.9 },
        { title, url: 'https://www.shueisha.co.jp/mock-work', searchCandidateTitle: title,
          content: `漫画『${title}』公式連載。作者：作品の作者。`, score: 0.9 },
      ],
    });

    expect(outcome.data).toHaveLength(1);
    expect(outcome.data?.[0]).toMatchObject({ rank: 1, japaneseTitle: title, author: '作品の作者', confidence: 'HIGH' });
    expect(outcome.data?.[0]?.evidence).toEqual(expect.arrayContaining(['CHARACTER_NAME_MATCH', 'WORK_TITLE_MATCH', 'PUBLISHER_MATCH']));
  });

  it('keeps distinct verified works separate despite a shared author and character mention', async () => {
    vi.stubEnv('AZURE_FOUNDRY_MODEL', 'manga-judge');
    const titles = ['星空の図書館', '星空の図書館の続編'];
    const gateway: AzureFoundryGateway = {
      generateContent: vi.fn(async () => JSON.stringify({ candidates: titles.map((title, index) => ({
        rank: index + 1, detectedTitle: title, contentType: 'PUBLISHED_MANGA', canonicalJapaneseTitle: title,
        titleVerificationStatus: 'VERIFIED', relatedMangaCandidates: titles, reason: 'Separate published manga title.',
        confidence: 'MEDIUM', evidence: ['WORK_TITLE_MATCH'], author: '同じ作者',
      })) })),
    };
    const outcome = await finalJudgment(gateway, {
      ocrTexts: titles, candidateSeeds: titles, lensMatches: [],
      tavilyResults: titles.map((title, index) => ({
        title, url: `https://www.shueisha.co.jp/mock-distinct-${index}`, searchCandidateTitle: title,
        content: `漫画『${title}』。登場人物：星野あかり。作者：同じ作者。`, score: 0.9,
      })),
    });

    expect(outcome.data?.map((candidate) => candidate.japaneseTitle)).toEqual(titles);
    expect(outcome.data?.map((candidate) => candidate.rank)).toEqual([1, 2]);
    expect(outcome.data?.every((candidate) => candidate.confidence === 'MEDIUM')).toBe(true);
  });

  it.each(['PARTIAL', 'UNVERIFIED'] as const)('does not promote a %s title to a canonical title', async (titleVerificationStatus) => {
    vi.stubEnv('AZURE_FOUNDRY_MODEL', 'manga-judge');
    const gateway: AzureFoundryGateway = {
      generateContent: vi.fn(async () => JSON.stringify({
        candidates: [{
          rank: 1,
          detectedTitle: '長い作品名',
          contentType: 'PUBLISHED_MANGA',
          canonicalJapaneseTitle: '長い作品名の未確認な後半',
          titleVerificationStatus,
          relatedMangaCandidates: [],
          reason: 'The title is not fully verified.',
          pronunciation: null,
          confidence: 'LOW',
          evidence: ['WORK_TITLE_MATCH'],
          author: null,
        }],
      })),
    };

    const result = await finalJudgment(gateway, {
      ocrTexts: ['長い作品名'],
      tavilyResults: [{ title: '長い作品名', url: 'https://example.com/work', content: '長い作品名', score: 0.9 }],
      lensMatches: [],
      candidateSeeds: ['長い作品名'],
    });

    expect(result.status).toBe('INSUFFICIENT');
    expect(result.data).toEqual([]);
  });

  it('accepts a complete title only when its full string appears in supplied evidence', async () => {
    vi.stubEnv('AZURE_FOUNDRY_MODEL', 'manga-judge');
    const gateway: AzureFoundryGateway = {
      generateContent: vi.fn(async () => JSON.stringify({
        candidates: [{
          rank: 1,
          detectedTitle: '放課後のアイドル',
          contentType: 'PUBLISHED_MANGA',
          canonicalJapaneseTitle: '放課後のアイドルには秘密がある',
          titleVerificationStatus: 'VERIFIED',
          relatedMangaCandidates: [],
          reason: 'The complete title appears in the supplied publisher evidence.',
          pronunciation: null,
          confidence: 'HIGH',
          evidence: ['WORK_TITLE_MATCH', 'PUBLISHER_MATCH'],
          author: null,
        }],
      })),
    };

    const result = await finalJudgment(gateway, {
      ocrTexts: ['放課後のアイドル'],
      tavilyResults: [{
        title: '放課後のアイドルには秘密がある | 白泉社',
        url: 'https://publisher.example/work',
        content: '正式タイトルは放課後のアイドルには秘密がある。',
        score: 0.9,
      }],
      lensMatches: [],
      candidateSeeds: ['放課後のアイドル'],
    });

    expect(result.status).toBe('SUCCESS');
    expect(result.data?.[0]?.japaneseTitle).toBe('放課後のアイドルには秘密がある');
  });

  it('rejects a model-verified title when only its fragment appears in evidence', async () => {
    vi.stubEnv('AZURE_FOUNDRY_MODEL', 'manga-judge');
    const gateway: AzureFoundryGateway = {
      generateContent: vi.fn(async () => JSON.stringify({
        candidates: [{
          rank: 1,
          detectedTitle: '確認済み',
          contentType: 'PUBLISHED_MANGA',
          canonicalJapaneseTitle: '確認済みの全体タイトル',
          titleVerificationStatus: 'VERIFIED',
          relatedMangaCandidates: [],
          reason: 'The model claims verification, but the complete title is absent from evidence.',
          pronunciation: null,
          confidence: 'HIGH',
          evidence: ['WORK_TITLE_MATCH'],
          author: null,
        }],
      })),
    };

    const result = await finalJudgment(gateway, {
      ocrTexts: ['確認済み'],
      tavilyResults: [{ title: '確認済み', url: 'https://example.com/work', content: '確認済み', score: 0.9 }],
      lensMatches: [],
      candidateSeeds: ['確認済み'],
    });

    expect(result.status).toBe('INSUFFICIENT');
    expect(result.data).toEqual([]);
  });

  it.each([
    'MANGA',
    'PUBLISHED_MANGA',
    'SOCIAL_ORIGINAL_COMIC',
    'MANGA_VOLUME',
    'ARTBOOK',
    'FANBOOK',
    'INTERVIEW_BOOK',
    'ANNIVERSARY_BOOK',
    'NOVEL',
    'ARTICLE',
    'FANART',
    'FAN_ART',
    'ILLUSTRATION',
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
