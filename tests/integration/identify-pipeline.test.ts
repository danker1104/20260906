import { afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import type { Candidate, PreparedImage } from '../../src/lib/domain/types';
import { runIdentifyPipeline, type ResearchProviders } from '../../src/lib/pipeline/identify-pipeline';
import { mapPipelineResponse } from '../../src/lib/pipeline/response-mapper';
import { enrichCandidatesWithNamuWiki } from '../../src/lib/search/namuwiki';

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
    tavily: async () => [{ title: '作品名 漫画', url: 'https://www.shueisha.co.jp/work', content: '작품명 정발', score: 0.9 }],
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

  it('adopts the published spelling before matching a LOW NamuWiki link without new requests (Case 05)', async () => {
    vi.stubEnv('YES24_API_KEY', '');
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const title = '正反対な君と僕';
    const published = '정반대의 너와 나';
    const namuWikiUrl = `https://namu.wiki/w/${encodeURIComponent(published)}`;
    const result = await runIdentifyPipeline([preparedImage], providers({
      ocr: async () => ({ text: title, rawText: title, valid: true }),
      tavily: async (query) => query.includes('만화') || query.includes('한국') ? [
        { title: `${published} 1권 - YES24`, url: 'https://www.yes24.com/product/goods/184510430', content: `원제 『${title}』 한국어판 만화`, score: 0.9 },
        { title: `${published} - 나무위키`, url: namuWikiUrl, content: '일본의 만화 작품', score: 0.9 },
      ] : [{ title, url: 'https://www.shueisha.co.jp/mock-case05', content: `${title} 漫画`, score: 0.9 }],
      judge: async () => [{ ...candidate, japaneseTitle: title, koreanTitle: '정반대인 너와 나',
        koreanSearchTranslation: '정반대인 너와 나', koreanTitleStatus: 'TRANSLATED', publicationStatus: 'UNKNOWN', confidence: 'LOW' }],
    }));
    expect(result.candidates[0]?.koreanTitle).toBe(published);
    expect(result.candidates[0]?.koreanTitleStatus).toBe('OFFICIAL');
    expect(result.candidates[0]?.confidence).toBe('LOW');
    expect(result.candidates[0]?.namuWikiUrl).toBe(namuWikiUrl);
    expect(result.candidates[0]?.yes24?.productUrl).toBe('https://www.yes24.com/product/goods/184510430');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps a LOW NamuWiki link when the full original is present but the snippet omits genre', () => {
    const url = `https://namu.wiki/w/${encodeURIComponent('정반대의 너와 나')}`;
    const result = enrichCandidatesWithNamuWiki([{
      ...candidate, japaneseTitle: '正反対な君と僕', koreanTitle: '정반대의 너와 나',
      confidence: 'LOW', koreanTitleStatus: 'TRANSLATED', publicationStatus: 'UNKNOWN',
    }], [{ title: '정반대의 너와 나 - 나무위키', url, content: '정반대의 너와 나\n正反対な君と僕', score: 0.9 }]);
    expect(result[0]?.namuWikiUrl).toBe(url);
    expect(result[0]?.confidence).toBe('LOW');
    expect(result[0]?.publicationStatus).toBe('UNKNOWN');
  });

  it('preserves a verified NamuWiki redirect URL without inventing a destination URL', () => {
    const url = 'https://namu.wiki/w/옛%20표기';
    const result = enrichCandidatesWithNamuWiki([{ ...candidate, japaneseTitle: '星空の図書館', koreanTitle: '직역 제목', koreanTitleStatus: 'TRANSLATED' }], [{
      title: '밤하늘 책방 - 나무위키', url, content: '옛 표기에서 넘겨주기\n星空の図書館\n일본의 만화', score: 0.9,
    }]);
    expect(result[0]?.namuWikiUrl).toBe('https://namu.wiki/w/%EC%98%9B%20%ED%91%9C%EA%B8%B0');
    expect(result[0]?.koreanTitleStatus).toBe('TRANSLATED');
  });

  it('keeps an independently used COMMON alias separate from Korean publication (Case 01)', async () => {
    const title = '放課後のアイドルには秘密がある';
    const alias = '방과 후의 아이돌에게는 비밀이 있다';
    let koreanResearch: import('../../src/lib/search/types').ResearchBundle | undefined;
    const result = await runIdentifyPipeline([preparedImage], providers({
      ocr: async () => ({ text: title, rawText: title, valid: true }),
      tavily: async (query) => query.includes('한국') || query.includes('만화') ? [
        { title: `${alias} - 나무위키`, url: `https://namu.wiki/w/${encodeURIComponent(alias)}`, content: `${title}\n일본의 만화`, score: 0.9 },
        { title: alias, url: 'https://community.example/case01', content: `${title} 일본 만화 이야기`, score: 0.9 },
      ] : [{ title, url: 'https://www.hakusensha.co.jp/mock-case01', content: `${title} 漫画 連載`, score: 0.9 }],
      judge: async (bundle) => {
        if (bundle.koreanResults) koreanResearch = bundle;
        return [{ ...candidate, japaneseTitle: title, koreanSearchTranslation: '방과 후 아이돌에게는 비밀이 있다',
          koreanTitle: bundle.koreanResults ? alias : null, koreanTitleStatus: 'COMMON', publicationStatus: 'UNKNOWN' }];
      },
    }));
    expect(koreanResearch?.koreanCommonTitleCandidates).toContain(alias);
    expect(koreanResearch?.koreanOfficialTitleCandidates).not.toContain(alias);
    expect(result.candidates[0]?.koreanTitle).toBe(alias);
    expect(result.candidates[0]?.publicationStatus).toBe('UNKNOWN');
    expect(result.candidates[0]?.namuWikiUrl).toBe(`https://namu.wiki/w/${encodeURIComponent(alias)}`);
  });

  it.each([false, true])('preserves OCR but accepts a unique official spelling correction (Case 02, canonical failure: %s)', async (canonicalFailure) => {
    const rawOcr = '灰宮先生は';
    const canonicalTitle = '灰宮先輩は怖くてかわいい';
    let canonicalResearch: import('../../src/lib/search/types').ResearchBundle | undefined;
    const result = await runIdentifyPipeline([preparedImage], providers({
      ocr: async () => ({ text: rawOcr, rawText: rawOcr, valid: true }),
      refineOcr: async (rawText) => ({ rawText, titleCandidates: [rawOcr], dialogueCandidates: [], noise: [], queryType: 'TITLE' }),
      tavily: async (query) => query.includes('한국') ? [] : [{
        title: canonicalTitle, url: 'https://www.kadokawa.co.jp/mock-case02',
        content: `${canonicalTitle} 漫画 公式連載 著者 神山すむ`, score: 0.9,
      }],
      judge: async (bundle) => {
        if (!bundle.koreanResults) {
          canonicalResearch = bundle;
          if (canonicalFailure) throw new Error('Mock canonical provider failure');
        }
        return [{ ...candidate, japaneseTitle: canonicalTitle, koreanTitle: null, koreanTitleStatus: 'UNKNOWN', publicationStatus: 'UNKNOWN' }];
      },
    }));
    expect(canonicalResearch?.rawOcrText).toBe(rawOcr);
    expect(canonicalResearch?.ocrTitleCandidates).toContain(rawOcr);
    expect(canonicalResearch?.verifiedOcrTitles).toContain(canonicalTitle);
    expect(result.candidates[0]?.japaneseTitle).toBe(canonicalTitle);
    expect(result.status).toBe(canonicalFailure ? 'PARTIAL_SUCCESS' : 'SUCCESS');
  });

  it.each(['星空の図書館', '星空の図書館の続編'])('links a differently named NamuWiki work by its original title: %s', (originalTitle) => {
    const result = enrichCandidatesWithNamuWiki([{
      ...candidate, japaneseTitle: '星空の図書館', koreanTitle: '별하늘의 도서관', koreanTitleStatus: 'TRANSLATED',
    }], [{
      title: '밤하늘 책방 - 나무위키', url: 'https://namu.wiki/w/밤하늘%20책방',
      content: `밤하늘 책방\n${originalTitle}\n일본의 만화`, score: 0.9,
    }]);
    expect(Boolean(result[0]?.namuWikiUrl)).toBe(originalTitle === '星空の図書館');
    expect(result[0]?.publicationStatus).toBe(candidate.publicationStatus);
  });

  it.each(['일본의 만화', '일본의 만화. 한국어판 출판 정보'])('uses an original-verified NamuWiki alias instead of requiring the literal translation: %s', async (wikiDescription) => {
    let koreanResearch: import('../../src/lib/search/types').ResearchBundle | undefined;
    const result = await runIdentifyPipeline([preparedImage], providers({
      tavily: async (query) => {
        if (query === '"별하늘의 도서관" 만화') return [{
          title: '밤하늘 책방 - 나무위키', url: 'https://namu.wiki/w/밤하늘%20책방',
          content: `밤하늘 책방\n作品名\n${wikiDescription}`, score: 0.9,
        }];
        if (query === '"밤하늘 책방" 만화') return [{
          title: '밤하늘 책방 1권', url: 'https://www.yes24.com/Product/Goods/alias-work',
          content: '정식 한국어판 판매', score: 0.9,
        }];
        return [{ title: '作品名 漫画', url: 'https://www.shueisha.co.jp/work', content: '作品名 漫画', score: 0.9 }];
      },
      judge: async (bundle) => {
        if (bundle.koreanResults) koreanResearch = bundle;
        return [{ ...candidate, koreanTitle: bundle.koreanResults ? '밤하늘 책방' : null, koreanSearchTranslation: '별하늘의 도서관' }];
      },
    }));
    expect(result.analysis?.searchQueries.korean).toEqual(['"별하늘의 도서관" 만화', '"밤하늘 책방" 만화']);
    expect(koreanResearch?.koreanTitleCandidates).toContain('밤하늘 책방');
    expect(koreanResearch?.koreanOfficialTitleCandidates).toContain('밤하늘 책방');
    expect(result.candidates[0]?.koreanTitle).toBe('밤하늘 책방');
    expect(result.candidates[0]?.namuWikiUrl).toBe('https://namu.wiki/w/%EB%B0%A4%ED%95%98%EB%8A%98%20%EC%B1%85%EB%B0%A9');
  });

  it('does not classify a translation search collision as a verified Korean title', async () => {
    let koreanResearch: import('../../src/lib/search/types').ResearchBundle | undefined;
    const translation = '별하늘의 도서관';
    const result = await runIdentifyPipeline([preparedImage], providers({
      tavily: async (query) => {
        if (query === `"${translation}" 만화`) return [{
          title: '다른 작품 한국어판', url: 'https://publisher.example/other', content: '別の作品 정식 한국어판 판매', score: 0.9,
        }];
        if (query.includes('한국')) return [];
        return [{ title: '作品名 漫画', url: 'https://www.shueisha.co.jp/work', content: '作品名 漫画', score: 0.9 }];
      },
      judge: async (bundle) => {
        if (bundle.koreanResults) koreanResearch = bundle;
        return [{ ...candidate, koreanSearchTranslation: translation }];
      },
    }));
    expect(result.analysis?.searchQueries.korean).toEqual([`"${translation}" 만화`, '"作品名" 한국']);
    expect(koreanResearch?.koreanOfficialTitleCandidates).not.toContain('다른 작품');
    expect(koreanResearch?.koreanCommonTitleCandidates).not.toContain('다른 작품');
  });

  it.each([true, false])('searches a reference translation first within the existing budget (strong result: %s)', async (strongResult) => {
    const queries: string[] = [];
    let judgmentCalls = 0;
    const translation = '별하늘의 도서관';
    const koreanResult = [{ title: `${translation} 한국어판`, url: 'https://publisher.example/work', content: '作品名 정식 한국어판 판매', score: 0.9 }];
    const result = await runIdentifyPipeline([preparedImage], providers({
      tavily: async (query) => {
        queries.push(query);
        if (query === `"${translation}" 만화`) return strongResult ? koreanResult : [];
        if (query === '"作品名" 한국') return koreanResult;
        return [{ title: '作品名 漫画', url: 'https://www.shueisha.co.jp/work', content: '作品名 漫画', score: 0.9 }];
      },
      judge: async () => {
        judgmentCalls += 1;
        return [{ ...candidate, koreanSearchTranslation: translation, koreanTitle: judgmentCalls === 1 ? null : translation }];
      },
    }));
    expect(result.analysis?.searchQueries.korean).toEqual(strongResult
      ? [`"${translation}" 만화`]
      : [`"${translation}" 만화`, '"作品名" 한국']);
    expect(judgmentCalls).toBe(2);
    expect(queries.length).toBeLessThanOrEqual(3);
    const response = mapPipelineResponse('00000000-0000-4000-8000-000000000001', result);
    expect(response.candidates[0]).not.toHaveProperty('koreanSearchTranslation');
  });

  it.each(['작품명', '밤의 배송원'])('excludes commerce notices without excluding the title %s', async (koreanTitle) => {
    const notices = [
      '국내배송만 가능 · 해외 거래처 사정에 따라 품절',
      '지연 가능 · 직수입 취소수수료',
      '안내 직수입 취소수수료',
      '안내 · 도서',
    ];
    const queries: string[] = [];
    let koreanResearch: import('../../src/lib/search/types').ResearchBundle | undefined;
    await runIdentifyPipeline([preparedImage], providers({
      tavily: async (query) => {
        queries.push(query);
        if (!query.includes('한국') && !query.includes(koreanTitle)) return [{
          title: '作品名 漫画', url: 'https://www.shueisha.co.jp/work', content: '作品名 漫画', score: 0.9,
        }];
        return [
          { title: `${koreanTitle} 1권`, url: 'https://www.yes24.com/work', content: notices.join('. '), score: 0.9 },
          { title: '作品名', url: 'https://www.aladin.co.kr/work', content: notices.join('. '), score: 0.9 },
        ];
      },
      judge: async (bundle) => {
        if (bundle.koreanResults) koreanResearch = bundle;
        return [candidate];
      },
    }));

    expect(koreanResearch?.koreanTitleCandidates).toContain(koreanTitle);
    expect(koreanResearch?.koreanOfficialTitleCandidates).toContain(koreanTitle);
    const titleEvidence = [
      ...(koreanResearch?.koreanTitleCandidates ?? []),
      ...(koreanResearch?.koreanOfficialTitleCandidates ?? []),
      ...(koreanResearch?.koreanCommonTitleCandidates ?? []),
    ];
    for (const notice of notices) expect(titleEvidence).not.toContain(notice);
    expect(queries.filter((query) => query.includes('한국') || query.includes(koreanTitle)).length).toBeLessThanOrEqual(2);
    expect(queries.some((query) => /국내배송만|수수료|해외 거래처/u.test(query))).toBe(false);
  });

  it('attaches the matching NamuWiki document from existing Korean research without another search', async () => {
    const search = vi.fn(async () => [{
      title: '작품명 - 나무위키',
      url: 'https://namu.wiki/w/작품명?from=search#s-1',
      content: '作品名 일본 만화. 한국에서는 작품명으로 알려져 있다.',
      score: 0.9,
    }]);
    const judge = vi.fn(async () => [candidate]);
    const result = await runIdentifyPipeline([preparedImage], providers({ tavily: search, judge }));

    expect(result.candidates[0]).toHaveProperty('namuWikiUrl', 'https://namu.wiki/w/%EC%9E%91%ED%92%88%EB%AA%85');
    expect(judge).toHaveBeenCalledTimes(2);
    expect(search.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it.each([
    'https://namu.wiki.evil.example/w/작품명',
    'https://namu.wiki@evil.example/w/작품명',
    'http://namu.wiki/w/작품명',
    'https://namu.wiki/w/다른작품',
    'https://namu.wiki/w/작품명/등장인물',
    'https://namu.wiki/Search?q=작품명',
  ])('does not attach an unrelated or unsafe NamuWiki URL: %s', async (url) => {
    const result = await runIdentifyPipeline([preparedImage], providers({
      tavily: async () => [{ title: '작품명 - 나무위키', url, content: '作品名 일본 만화', score: 0.9 }],
    }));

    expect(result.candidates[0]).not.toHaveProperty('namuWikiUrl');
  });

  it('discards an unverified NamuWiki URL returned by the model', async () => {
    const result = await runIdentifyPipeline([preparedImage], providers({
      judge: async () => [{ ...candidate, namuWikiUrl: 'https://namu.wiki/w/작품명' }],
    }));

    expect(result.candidates[0]).not.toHaveProperty('namuWikiUrl');
  });

  it.each([
    { document: '작품명(만화)', title: '작품명(만화) - 나무위키', content: '일본의 만화', verified: true },
    { document: '작품명(애니메이션)', title: '작품명(애니메이션) - 나무위키', content: '作品名 만화 원작', verified: false },
    { document: '작품명', title: '다른작품 - 나무위키', content: '作品名 만화', verified: false },
    { document: '작품명', title: '작품명 - 나무위키', content: '동명의 인물에 대한 문서', verified: false },
  ])('matches only a supported work document: $document / $content', async ({ document, title, content, verified }) => {
    const url = `https://namu.wiki/w/${encodeURIComponent(document)}`;
    const result = await runIdentifyPipeline([preparedImage], providers({
      tavily: async (query) => query.includes('한국') || query.includes('작품명')
        ? [{ title, url, content, score: 0.9 }]
        : [{ title: '作品名 漫画', url: 'https://example.com/jp', content: '作品名 漫画', score: 0.9 }],
    }));

    expect(result.candidates).toHaveLength(1);
    if (verified) expect(result.candidates[0]).toHaveProperty('namuWikiUrl', url);
    else expect(result.candidates[0]).not.toHaveProperty('namuWikiUrl');
  });

  it('does not use an AI translation alone to match a Korean NamuWiki document', async () => {
    const result = await runIdentifyPipeline([preparedImage], providers({
      tavily: async (query) => query.includes('한국') || query.includes('작품명')
        ? [{ title: '작품명 - 나무위키', url: 'https://namu.wiki/w/작품명', content: '일본 만화', score: 0.9 }]
        : [{ title: '作品名 漫画', url: 'https://example.com/jp', content: '作品名 漫画', score: 0.9 }],
      judge: async () => [{ ...candidate, koreanTitleStatus: 'TRANSLATED' }],
    }));
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).not.toHaveProperty('namuWikiUrl');
  });

  it('attaches a matched YES24 Korean release from the identified Korean title, even without a cover', async () => {
    vi.stubEnv('YES24_API_KEY', 'test-key');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      items: [{
        itemId: 'yes24-identified-work',
        title: '작품명 1권',
        author: '작가',
        publisher: '출판사',
        productUrl: 'https://www.yes24.com/Product/Goods/yes24-identified-work',
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const result = await runIdentifyPipeline([preparedImage], providers());

    expect(result.status).toBe('SUCCESS');
    expect(result.candidates[0]?.koreanTitle).toBe('작품명');
    expect(result.candidates[0]?.yes24).toMatchObject({
      matched: true,
      itemId: 'yes24-identified-work',
      title: '작품명 1권',
      publisher: '출판사',
      productUrl: 'https://www.yes24.com/Product/Goods/yes24-identified-work',
    });
    expect(result.candidates[0]?.yes24?.coverUrl).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

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

  it('uses a confirmed central social crop for the existing Lens call', async () => {
    const imageBuffer = await sharp({ create: { width: 320, height: 640, channels: 3, background: '#ffffff' } }).png().toBuffer();
    const image: PreparedImage = { ...preparedImage, buffer: imageBuffer, width: 320, height: 640 };
    let observedLensHeight = 0;
    const lens = vi.fn(async (lensImage: PreparedImage) => {
      observedLensHeight = lensImage.height;
      return [];
    });

    await runIdentifyPipeline([image], providers({
      ocr: async () => ({ text: '', valid: false, socialCropBounds: { top: 80, bottom: 560 } }),
      tavily: async () => [],
      lens,
    }));

    expect(lens).toHaveBeenCalledTimes(1);
    expect(observedLensHeight).toBe(480);
  });

  it('keeps the canonical Japanese title when Korean verification returns another candidate', async () => {
    const secondaryCandidate = { ...candidate, rank: 2 as const, japaneseTitle: '다른 작품' };
    const result = await runIdentifyPipeline([preparedImage], providers({
      judge: async () => [
        { ...candidate, rank: 1 as const, koreanTitle: null, koreanTitleStatus: 'UNKNOWN' as const, publicationStatus: 'UNKNOWN' as const },
        secondaryCandidate,
      ],
    }));

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.japaneseTitle).toBe('作品名');
    expect(result.candidates[0]?.rank).toBe(1);
  });

  it('keeps only the clean Japanese title when Korean information is unavailable', async () => {
    const result = await runIdentifyPipeline([preparedImage], providers({
      ocr: async () => ({ text: '葬送のフリーレン', valid: true }),
      tavily: async () => [{ title: '葬送のフリーレン 漫画', url: 'https://example.com/jp', content: '葬送のフリーレン 漫画', score: 0.9 }],
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

  it('preserves a complete canonical Japanese title through final selection', async () => {
    const fullTitle = '放課後のアイドルには秘密がある';
    const result = await runIdentifyPipeline([preparedImage], providers({
      ocr: async () => ({ text: '放課後のアイ', valid: true }),
      refineOcr: async (rawText) => ({ rawText, titleCandidates: ['放課後のアイ'], dialogueCandidates: [], noise: [], queryType: 'TITLE' }),
      tavily: async () => [{
        title: `${fullTitle} | 出版社公式作品ページ`,
        url: 'https://publisher.example/work',
        content: `正式タイトルは${fullTitle}。`,
        score: 0.9,
      }],
      judge: async () => [{ ...candidate, japaneseTitle: fullTitle }],
    }));

    expect(result.candidates[0]?.japaneseTitle).toBe(fullTitle);
  });

  it('preserves a strong direct Lens title when Foundry prefers an unrelated candidate', async () => {
    const expectedTitle = '放課後のアイドルには秘密がある';
    const unrelatedTitle = '君の膵臓をたべたい';
    const unrelatedCandidate = {
      ...candidate,
      japaneseTitle: unrelatedTitle,
      koreanTitle: null,
      koreanTitleStatus: 'UNKNOWN' as const,
      publicationStatus: 'UNKNOWN' as const,
      confidence: 'HIGH' as const,
    };
    let judgmentCalls = 0;
    const result = await runIdentifyPipeline([preparedImage], providers({
      ocr: async () => ({ text: 'Follow Like comments', valid: false }),
      tavily: async (query) => query.includes('한국')
        ? [{ title: '한국어 정보 미확인', url: 'https://example.com/kr', content: '한국어 정보 미확인', score: 0.9 }]
        : [{ title: expectedTitle, url: 'https://publisher.example/work', content: expectedTitle, score: 0.9 }],
      lens: async () => [{
        title: `Instagram: ${expectedTitle}`,
        source: 'Instagram',
        link: 'https://www.instagram.com/p/mock-post',
        position: 1,
        snippet: expectedTitle,
      }],
      judge: async () => {
        judgmentCalls += 1;
        return [unrelatedCandidate];
      },
    }));

    expect(result.candidates[0]?.japaneseTitle).toBe(expectedTitle);
    expect(judgmentCalls).toBeGreaterThan(0);
  });

  it('keeps a direct Lens title at LOW confidence when canonical Foundry response is invalid', async () => {
    const expectedTitle = '放課後のアイドルには秘密がある';
    const result = await runIdentifyPipeline([preparedImage], providers({
      ocr: async () => ({ text: 'Instagram Follow Like comments', valid: false }),
      tavily: async () => [],
      lens: async () => [{
        title: 'Instagram post',
        source: 'Instagram',
        link: 'https://www.instagram.com/p/saved-fixture',
        position: 1,
        snippet: `#${expectedTitle}`,
      }],
      judge: async () => {
        throw Object.assign(new Error('mock schema validation failure'), { failureReason: 'INVALID_MODEL_RESPONSE' });
      },
    }));

    expect(result.status).toBe('PARTIAL_SUCCESS');
    expect(result.candidates[0]?.japaneseTitle).toBe(expectedTitle);
    expect(result.candidates[0]?.confidence).toBe('LOW');
    expect(result.candidates[0]?.koreanTitleStatus).toBe('UNKNOWN');
  });

  it('keeps the direct Lens title in a small Foundry seed set when SNS matches are noisy', async () => {
    const expectedTitle = '放課後のアイドルには秘密がある';
    let identificationBundle: import('../../src/lib/search/types').ResearchBundle | undefined;
    const noisyMatches = Array.from({ length: 30 }, (_, index) => ({
      title: `X on X: "今日は${index + 1}回目、アニメの感想を投稿します" / X`,
      source: 'X',
      link: `https://x.example/status/noise-${index}`,
      position: index + 1,
    }));
    const result = await runIdentifyPipeline([preparedImage], providers({
      ocr: async () => ({ text: 'Follow Like comments', valid: false }),
      tavily: async () => [],
      lens: async () => [
        ...noisyMatches,
        {
          title: 'Instagram post',
          source: 'Instagram',
          link: 'https://www.instagram.com/p/saved-answer',
          position: 35,
          snippet: `#${expectedTitle}`,
        },
      ],
      judge: async (bundle) => {
        if (!bundle.koreanResults) {
          identificationBundle = bundle;
          return [{ ...candidate, japaneseTitle: '君の膵臓をたべたい' }];
        }
        return [{ ...candidate, japaneseTitle: '君の膵臓をたべたい' }];
      },
    }));

    expect(identificationBundle?.candidateSeeds).toHaveLength(1);
    expect(identificationBundle?.candidateSeeds).toContain(expectedTitle);
    expect(identificationBundle?.candidateClusters).toHaveLength(1);
    expect(result.candidates[0]?.japaneseTitle).toBe(expectedTitle);
    expect(result.candidates[0]?.confidence).toBe('LOW');
  });

  it('does not let Korean verification replace the canonical Japanese title', async () => {
    const canonicalTitle = '放課後のアイドルには秘密がある';
    const unrelatedTitle = '君の膵臓をたべたい';
    let judgmentCalls = 0;
    const result = await runIdentifyPipeline([preparedImage], providers({
      ocr: async () => ({ text: canonicalTitle, valid: true }),
      refineOcr: async (rawText) => ({ rawText, titleCandidates: [canonicalTitle], dialogueCandidates: [], noise: [], queryType: 'TITLE' }),
      tavily: async (query) => query.includes('한국')
        ? [{ title: '너의 췌장을 먹고 싶어', url: 'https://yes24.example/work', content: '공식 정발', score: 0.9 }]
        : [{ title: canonicalTitle, url: 'https://publisher.example/work', content: canonicalTitle, score: 0.9 }],
      judge: async () => {
        judgmentCalls += 1;
        if (judgmentCalls === 1) return [{ ...candidate, japaneseTitle: canonicalTitle, koreanTitle: null, koreanTitleStatus: 'UNKNOWN' as const, publicationStatus: 'UNKNOWN' as const, confidence: 'HIGH' as const }];
        return [{ ...candidate, japaneseTitle: unrelatedTitle, koreanTitle: '너의 췌장을 먹고 싶어', koreanTitleStatus: 'OFFICIAL' as const, confidence: 'HIGH' as const }];
      },
    }));

    expect(result.candidates[0]?.japaneseTitle).toBe(canonicalTitle);
    expect(result.candidates[0]?.koreanTitleStatus).toBe('UNKNOWN');
  });

  it('keeps titles longer than 80 characters intact in Korean research queries', async () => {
    const fullTitle = '長い正式作品名'.repeat(15);
    const queries: string[] = [];
    await runIdentifyPipeline([preparedImage], providers({
      ocr: async () => ({ text: '長い正式作品名', valid: true }),
      refineOcr: async (rawText) => ({ rawText, titleCandidates: ['長い正式作品名'], dialogueCandidates: [], noise: [], queryType: 'TITLE' }),
      tavily: async (query) => {
        queries.push(query);
        return [{ title: fullTitle, url: 'https://publisher.example/work', content: fullTitle, score: 0.9 }];
      },
      judge: async () => [{ ...candidate, japaneseTitle: fullTitle }],
    }));

    expect(queries).toContain(`"${fullTitle}" 한국`);
  });

  it('uses Lens only when OCR is not useful', async () => {
    let lensCalls = 0;
    const result = await runIdentifyPipeline([preparedImage], providers({
      ocr: async () => ({ text: '123 !!!', valid: false }),
      lens: async () => {
        lensCalls += 1;
        return [{ title: '作品名 漫画', source: 'Example', link: 'https://example.com/lens' }];
      },
    }));

    expect(lensCalls).toBe(1);
    expect(result.status).toBe('SUCCESS');
    expect(result.stages.imageAnalysis).toBe('SUCCESS');
  });

  it('keeps low-confidence OCR as a clue and uses the existing Lens fallback when Tavily is irrelevant', async () => {
    const lens = vi.fn(async () => [{
      title: '長い正式作品名 漫画',
      source: 'Example',
      link: 'https://example.com/lens',
    }]);
    const result = await runIdentifyPipeline([preparedImage], providers({
      ocr: async () => ({ text: '長い正式作品', valid: true, ocrConfidence: 18 }),
      tavily: async () => [{
        title: '別作品のニュース',
        url: 'https://example.com/news',
        content: '別作品のニュース記事です。',
        score: 0.9,
      }],
      lens,
      judge: async () => [{ ...candidate, japaneseTitle: '長い正式作品名' }],
    }));

    expect(lens).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('SUCCESS');
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

  it('marks Korean investigation as attempted when the verifier fails after Korean search', async () => {
    let judgmentCalls = 0;
    const result = await runIdentifyPipeline([preparedImage], providers({
      judge: async () => {
        judgmentCalls += 1;
        if (judgmentCalls === 1) return [{ ...candidate, koreanTitle: null, koreanTitleStatus: 'UNKNOWN' as const, publicationStatus: 'UNKNOWN' as const, koreanInvestigationStatus: 'SKIPPED' as const }];
        throw Object.assign(new Error('invalid verifier response'), { status: 502 });
      },
    }));

    expect(judgmentCalls).toBe(2);
    expect(result.status).toBe('PARTIAL_SUCCESS');
    expect(result.candidates[0]?.koreanInvestigationStatus).toBe('SUCCESS');
    expect(result.candidates[0]?.koreanTitleStatus).toBe('UNKNOWN');
  });

  it('continues Korean investigation when canonical title comes from OCR fallback', async () => {
    let judgmentCalls = 0;
    const koreanQueries: string[] = [];
    const result = await runIdentifyPipeline([preparedImage], providers({
      refineOcr: async (rawText) => ({ rawText, titleCandidates: ['作品名'], dialogueCandidates: [], noise: [], queryType: 'TITLE' }),
      tavily: async (query) => {
        koreanQueries.push(query);
        return [{ title: '作品名 한국어판', url: 'https://example.com/work', content: '작품명 정발', score: 0.9 }];
      },
      judge: async () => {
        judgmentCalls += 1;
        throw Object.assign(new Error('canonical unavailable'), { status: 503 });
      },
    }));

    expect(judgmentCalls).toBe(2);
    expect(koreanQueries).toContain('"作品名" 한국');
    expect(result.candidates[0]?.koreanInvestigationStatus).toBe('SUCCESS');
  });

  it.each([false, true])('keeps the Japanese identity during COMMON rejudgment (unrelated model: %s)', async (unrelatedModel) => {
    let judgmentCalls = 0;
    const queries: string[] = [];
    const result = await runIdentifyPipeline([preparedImage], providers({
      ocr: async () => ({ text: '作品名', valid: true }),
      refineOcr: async (rawText) => ({ rawText, titleCandidates: ['作品名'], dialogueCandidates: [], noise: [], queryType: 'TITLE' }),
      tavily: async (query) => {
        queries.push(query);
        if (query.includes('한국')) return [{ title: '作品名', url: 'https://jp.example/work', content: '作品名', score: 0.9 }];
        if (query.includes('translated-title')) return [
          { title: 'translated-title 作品名', url: 'https://community.example/one', content: 'translated-title 作品名', score: 0.9 },
          { title: 'translated-title 作品名', url: 'https://blog.example/two', content: 'translated-title 作品名', score: 0.8 },
        ];
        return [{ title: '作品名 漫画', url: 'https://jp.example/work', content: '作品名', score: 0.9 }];
      },
      judge: async () => {
        judgmentCalls += 1;
        if (judgmentCalls === 1) return [{ ...candidate, japaneseTitle: '作品名', koreanTitle: null, koreanTitleStatus: 'UNKNOWN' as const, publicationStatus: 'UNKNOWN' as const, koreanInvestigationStatus: 'SKIPPED' as const }];
        if (judgmentCalls === 2) return [{ ...candidate, japaneseTitle: '作品名', koreanTitle: 'translated-title', koreanTitleStatus: 'TRANSLATED' as const, publicationStatus: 'UNKNOWN' as const, koreanInvestigationStatus: 'SUCCESS' as const }];
        return [{ ...candidate, japaneseTitle: unrelatedModel ? '君の膵臓をたべたい' : '作品名', koreanTitle: 'translated-title', koreanTitleStatus: 'COMMON' as const, publicationStatus: 'UNKNOWN' as const, koreanInvestigationStatus: 'SUCCESS' as const }];
      },
    }));

    expect(judgmentCalls).toBe(3);
    expect(queries).toContain('"translated-title" "作品名"');
    expect(result.candidates[0]?.japaneseTitle).toBe('作品名');
    expect(result.candidates[0]?.koreanTitle).toBe(unrelatedModel ? null : 'translated-title');
    expect(result.candidates[0]?.koreanTitleStatus).toBe(unrelatedModel ? 'UNKNOWN' : 'COMMON');
    expect(result.candidates[0]?.koreanInvestigationStatus).toBe('SUCCESS');
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
