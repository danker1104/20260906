import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Candidate, PreparedImage } from '../../src/lib/domain/types';
import { extractJapaneseTitle, runIdentifyPipeline, type ResearchProviders } from '../../src/lib/pipeline/identify-pipeline';
import { cleanOcrText, isUsefulJapaneseText } from '../../src/lib/search/ocr-space';
import * as catalogProviders from '../../src/lib/publication/provider-factory';
import { getNamuWikiWorkIdentity } from '../../src/lib/search/namuwiki';

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
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it.each(['SPY×FAMILY', 'SPY x FAMILY', '3月のライオン', 'D.Gray-man', '葬送のフリーレン'])('preserves the entire verified original title: %s', (title) => {
    expect(extractJapaneseTitle(`  ${title}  `)).toBe(title);
  });

  it.each(['SPY×FAMILY', 'D.Gray-man', '3月のライオン'])('verifies a NamuWiki name against the complete mixed-script original: %s', (title) => {
    const name = '검증된 작품';
    const url = `https://namu.wiki/w/${encodeURIComponent(name)}`;
    expect(getNamuWikiWorkIdentity({ title: `${name} - 나무위키`, url, content: `일본 원제 『${title}』 만화`, score: 0.9 }, title))
      .toEqual({ url, koreanTitle: name });
  });

  it.each(['SPY', 'SPY×FAMILY 2', 'SPY×FAMILY CODE: White'])('does not verify a fragment or different work as the original: %s', (original) => {
    expect(getNamuWikiWorkIdentity({
      title: '검증된 작품 - 나무위키', url: `https://namu.wiki/w/${encodeURIComponent('검증된 작품')}`,
      content: `일본 원제 『${original}』 만화`, score: 0.9,
    }, 'SPY×FAMILY')).toBeNull();
  });

  it('keeps mixed Latin and Korean title candidates intact', async () => {
    const title = '星空の図書館';
    const collected: string[] = [];
    await runIdentifyPipeline([preparedImage], providers({
      ocr: async () => ({ text: title, valid: true }),
      tavily: async (query) => query.includes('한국')
        ? [{ title: '스파이x패밀리 - YES24', url: 'https://www.yes24.com/work-name', content: `${title} 한국어판 만화`, score: 0.9 }]
        : [{ title, url: 'https://www.shueisha.co.jp/mock-mixed-korean', content: '漫画 公式連載', score: 0.9 }],
      judge: async (bundle) => {
        if (bundle.koreanResults) collected.push(...(bundle.koreanTitleCandidates ?? []));
        return [{ ...candidate, japaneseTitle: title, koreanTitle: '스파이x패밀리' }];
      },
    }));
    expect(collected).toContain('스파이x패밀리');
    expect(collected).not.toContain('스파이');
    expect(collected).not.toContain('패밀리');
  });

  it('confirms the selected name using a live ISBN before connecting YES24 and NamuWiki', async () => {
    vi.stubEnv('YES24_API_KEY', 'test-key');
    const title = '星空の図書館';
    const name = '밤하늘 책방';
    const isbn = '9780306406157';
    const search = vi.fn(async () => ({ pageNo: 1, totalCount: 1, hasMore: false, records: [{
      id: 'confirmed-name', title: `${name} 1`, seriesTitle: name, isbn, author: '작가', publisher: '출판사',
      subject: '만화', pubPredateYn: 'N' as const, expectedPublicationDate: null, depositStatus: 'N' as const, coverUrl: null,
    }] }));
    vi.spyOn(catalogProviders, 'getNationalLibraryProvider').mockReturnValue({ mode: 'live', search });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ items: [{
      itemId: 'isbn-book', title: `${name} 1`, isbn, author: '작가', publisher: '출판사',
      link: 'https://www.yes24.com/product/goods/12345',
    }] }), { status: 200 }));
    const outcome = await runIdentifyPipeline([preparedImage], providers({
      ocr: async () => ({ text: title, valid: true }),
      tavily: async (query) => query.includes('한국') || query.includes(name)
        ? [{ title: `${name} - 나무위키`, url: `https://namu.wiki/w/${encodeURIComponent(name)}`,
          content: `일본 원제 『${title}』 한국어 작품 소개 만화`, score: 0.9 }]
        : [{ title, url: 'https://www.shueisha.co.jp/mock-isbn-name', content: '漫画 公式連載', score: 0.9 }],
      judge: async () => [{ ...candidate, japaneseTitle: title, koreanTitle: name,
        koreanTitleStatus: 'TRANSLATED', publicationStatus: 'UNKNOWN', confidence: 'LOW' }],
    }));

    expect(search).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(search.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0]!);
    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).searchParams.get('query')).toBe(isbn);
    expect(outcome.candidates[0]).toMatchObject({ koreanTitle: name, koreanTitleStatus: 'OFFICIAL', publicationStatus: 'UNKNOWN', confidence: 'LOW' });
    expect(outcome.candidates[0]?.yes24?.productUrl).toBe('https://www.yes24.com/product/goods/12345');
    expect(outcome.candidates[0]?.namuWikiUrl).toBe(`https://namu.wiki/w/${encodeURIComponent(name)}`);
  });

  it('resolves a Latin original to the verified Korean document title and exact ISBN links', async () => {
    vi.stubEnv('YES24_API_KEY', 'test-key');
    const original = 'SPY×FAMILY';
    const name = '스파이 패밀리';
    const isbn = '9780306406157';
    const namuUrl = `https://namu.wiki/w/${encodeURIComponent(name)}`;
    const search = vi.fn(async () => ({ pageNo: 1, totalCount: 1, hasMore: false, records: [{
      id: 'mixed-original', title: `${name} 1`, seriesTitle: name, isbn, author: '작가', publisher: '출판사',
      subject: '만화', pubPredateYn: 'N' as const, expectedPublicationDate: null, depositStatus: 'N' as const, coverUrl: null,
    }] }));
    vi.spyOn(catalogProviders, 'getNationalLibraryProvider').mockReturnValue({ mode: 'live', search });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ items: [{
      itemId: 'exact-isbn', title: `${name} 1`, originalTitle: original, isbn, author: '작가', publisher: '출판사',
      link: 'https://www.yes24.com/product/goods/12345',
    }] }), { status: 200 }));
    const koreanOriginals: string[] = [];
    const outcome = await runIdentifyPipeline([preparedImage], providers({
      ocr: async () => ({ text: '', valid: false }),
      lens: async () => [{ title: 'スパイファミリー', source: 'Publisher', link: 'https://www.shueisha.co.jp/mock-visual', position: 1 }],
      tavily: async (query) => /한국|스파이/u.test(query)
        ? [{ title: `${name} - 나무위키`, url: namuUrl, content: `일본 원제 『${original}』 만화`, score: 0.9 }]
        : [{ title: original, url: 'https://www.shueisha.co.jp/mock-original', content: `漫画『${original}』（スパイファミリー）公式連載`, score: 0.9 }],
      judge: async (bundle) => {
        if (bundle.koreanResults) koreanOriginals.push(...bundle.candidateSeeds);
        return [{ ...candidate, japaneseTitle: original, koreanTitle: '스파이x패밀리', koreanSearchTranslation: '스파이x패밀리',
          koreanTitleStatus: 'TRANSLATED', publicationStatus: 'UNKNOWN', confidence: 'LOW' }];
      },
    }));

    expect(koreanOriginals).toContain(original);
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith({ query: name, queryType: 'TITLE', page: 1, pageSize: 10 }, expect.any(AbortSignal));
    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).searchParams.get('query')).toBe(isbn);
    expect(outcome.candidates[0]).toMatchObject({ japaneseTitle: original, koreanTitle: name, koreanTitleStatus: 'OFFICIAL', namuWikiUrl: namuUrl });
    expect(outcome.candidates[0]?.yes24?.productUrl).toBe('https://www.yes24.com/product/goods/12345');
  });

  it('preserves the verified NamuWiki name when YES24 uses a different Korean spelling', async () => {
    const title = '星空の図書館';
    const namuTitle = '밤하늘 책방';
    const outcome = await runIdentifyPipeline([preparedImage], providers({
      ocr: async () => ({ text: title, valid: true }),
      tavily: async (query) => query.includes('한국') || query.includes(namuTitle)
        ? [
          { title: `${namuTitle} - 나무위키`, url: `https://namu.wiki/w/${encodeURIComponent(namuTitle)}`,
            content: `일본 원제 『${title}』 한국어 작품 소개 만화`, score: 0.9 },
          { title: '별하늘의 도서관 1권 - YES24', url: 'https://www.yes24.com/product/goods/12345',
            content: `일본 원제 『${title}』 정식 한국어판 만화`, score: 0.9 },
        ]
        : [{ title, url: 'https://www.shueisha.co.jp/mock-namu-priority', content: '漫画 公式連載', score: 0.9 }],
      judge: async () => [{ ...candidate, japaneseTitle: title, koreanTitle: namuTitle,
        koreanTitleStatus: 'TRANSLATED', publicationStatus: 'UNKNOWN' }],
    }));

    expect(outcome.candidates[0]?.koreanTitle).toBe(namuTitle);
    expect(outcome.candidates[0]?.koreanTitleStatus).toBe('TRANSLATED');
    expect(outcome.candidates[0]?.yes24).toMatchObject({ matched: true, productUrl: 'https://www.yes24.com/product/goods/12345' });
    expect(outcome.candidates[0]?.namuWikiUrl).toBe(`https://namu.wiki/w/${encodeURIComponent(namuTitle)}`);
  });

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
    expect(judgedBundles[1]?.ocrTexts).toEqual(['薫る花は凛と咲く']);
    expect(judgedBundles[1]?.candidateSeeds).toEqual(['薫る花は凛と咲く']);
    expect(judgedBundles[1]?.lensMatches).toEqual([]);
    expect(judgedBundles[1]?.koreanResults?.length).toBeGreaterThan(0);
    expect(result.status).toBe('SUCCESS');
  });

  it('uses Tavily after valid OCR and skips Lens', async () => {
    let lensCalls = 0;
    let judgmentCalls = 0;
    const providers: ResearchProviders = {
      ocr: async () => ({ text: '作品名 漫画', valid: true }),
      tavily: async () => [{ title: '作品名 漫画', url: 'https://www.shueisha.co.jp/work', content: '작품명', score: 0.9 }],
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
        return [{ title: '作品名 漫画', source: 'Example', link: 'https://example.com/lens' }];
      },
      judge: async () => [candidate],
    };

    const result = await runIdentifyPipeline([preparedImage], providers);

    expect(lensCalls).toBe(1);
    expect(result.status).toBe('SUCCESS');
    expect(result.stages.imageAnalysis).toBe('SUCCESS');
  });

  it('skips OCR refinement when no image produced useful Japanese text', async () => {
    let refinementCalls = 0;
    const result = await runIdentifyPipeline([preparedImage], providers({
      ocr: async () => ({ text: '', valid: false }),
      refineOcr: async (rawText) => {
        refinementCalls += 1;
        return { rawText, titleCandidates: [], dialogueCandidates: [], noise: [], queryType: 'NONE' };
      },
      tavily: async () => [],
      lens: async () => [],
    }));

    expect(refinementCalls).toBe(0);
    expect(result.status).toBe('INSUFFICIENT');
  });

  it('searches Tavily for imperfect OCR before using Lens when the full title is unverified', async () => {
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
    expect(lensCalls).toBe(1);
    expect(result.status).toBe('INSUFFICIENT');
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
      judge: async () => [{ ...candidate, japaneseTitle: '葬送のフリーレン' }],
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
    expect(result.diagnosticCodes).toEqual(expect.arrayContaining(['LENS_EMPTY_RESULTS', 'INSUFFICIENT_EVIDENCE']));
  });

  it('distinguishes Lens candidate extraction failure from an empty visual result set', async () => {
    const result = await runIdentifyPipeline([preparedImage], providers({
      ocr: async () => ({ text: '', valid: false }),
      tavily: async () => [],
      lens: async () => [{ title: 'generic collection', source: 'Gallery', link: 'https://gallery.example/items' }],
    }));

    expect(result.status).toBe('INSUFFICIENT');
    expect(result.diagnosticCodes).toEqual(expect.arrayContaining(['LENS_CANDIDATE_EXTRACTION_FAILED', 'INSUFFICIENT_EVIDENCE']));
    expect(result.diagnosticCodes).not.toContain('LENS_EMPTY_RESULTS');
  });

  it.each([
    { failureReason: 'INVALID_MODEL_RESPONSE', status: undefined, expected: 'FOUNDRY_INVALID_RESPONSE' },
    { failureReason: 'RATE_LIMITED', status: 429, expected: 'FOUNDRY_RATE_LIMITED' },
  ] as const)('records $expected without changing public status contract', async ({ failureReason, status, expected }) => {
    let judgmentCalls = 0;
    const result = await runIdentifyPipeline([preparedImage], providers({
      ocr: async () => ({ text: '作品名', valid: true }),
      refineOcr: async (rawText) => ({ rawText, titleCandidates: ['作品名'], dialogueCandidates: [], noise: [], queryType: 'TITLE' }),
      tavily: async (query) => query.includes('한국')
        ? [{ title: '작품명 한국어판', url: 'https://publisher.example/work', content: '공식 정발', score: 0.9 }]
        : [{ title: '作品名 漫画', url: 'https://manga.example/work', content: '作品名 漫画', score: 0.9 }],
      judge: async () => {
        judgmentCalls += 1;
        if (judgmentCalls > 1) return [candidate];
        throw Object.assign(new Error(failureReason), { failureReason, status });
      },
    }));

    expect(judgmentCalls).toBe(2);
    expect(result.status).toBe('PARTIAL_SUCCESS');
    expect(result.diagnosticCodes).toContain(expected);
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
