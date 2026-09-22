import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Candidate } from '../../src/lib/domain/types';
import { enrichCandidateWithYes24 } from '../../src/lib/search/yes24';

const officialCandidate: Candidate = {
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

const yes24Response = (items: unknown[]) => new Response(JSON.stringify({ items }), { status: 200 });

describe('YES24 enrichment', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('matches an official Korean release and selects a representative first volume', async () => {
    vi.stubEnv('YES24_API_KEY', 'test-key');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(yes24Response([
      { itemId: '2', title: '작품명 2권', author: '작가', publisher: '출판사', cover: 'https://image.yes24.com/2.jpg', productUrl: 'https://www.yes24.com/Product/Goods/2' },
      { itemId: '1', title: '작품명 1권', author: '작가', publisher: '출판사', cover: 'https://image.yes24.com/1.jpg', productUrl: 'https://www.yes24.com/Product/Goods/1' },
    ]));

    const result = await enrichCandidateWithYes24(officialCandidate);

    expect(result.yes24).toMatchObject({ matched: true, itemId: '1', title: '작품명 1권', coverUrl: 'https://image.yes24.com/1.jpg', productUrl: 'https://www.yes24.com/Product/Goods/1' });
    const [requestUrl, requestInit] = fetchMock.mock.calls[0] ?? [];
    expect(String(requestUrl)).toContain('https://apis.yes24.com/v1/goods/itemList');
    expect((requestInit as RequestInit).headers).toMatchObject({ 'X-Api-Key': 'test-key' });
  });

  it('matches a YES24 title with edition and subtitle differences', async () => {
    vi.stubEnv('YES24_API_KEY', 'test-key');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(yes24Response([
      { itemId: '11', title: '타코피의 원죄 완전판 1권', author: '작가', publisher: '출판사', cover: 'https://image.yes24.com/11.jpg', productUrl: 'https://www.yes24.com/Product/Goods/11' },
    ]));

    const result = await enrichCandidateWithYes24({ ...officialCandidate, koreanTitle: '타코피의 원죄' });

    expect(result.yes24).toMatchObject({ matched: true, itemId: '11' });
  });

  it('ignores common author role labels from YES24 author fields', async () => {
    vi.stubEnv('YES24_API_KEY', 'test-key');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(yes24Response([
      { itemId: '12', title: '타코피의 원죄 : 하', author: 'Taizan5 글 그림', publisher: '대원', cover: 'https://image.yes24.com/12/L', link: 'https://www.yes24.com/product/goods/12' },
    ]));

    const result = await enrichCandidateWithYes24({ ...officialCandidate, koreanTitle: '타코피의 원죄', author: 'Taizan5' });

    expect(result.yes24).toMatchObject({ matched: true, itemId: '12' });
  });

  it('keeps a title match when author names use different writing systems', async () => {
    vi.stubEnv('YES24_API_KEY', 'test-key');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(yes24Response([
      { itemId: 117872327, title: '타코피의 원죄 : 하', author: 'Taizan5 글그림', publisher: '대원', cover: 'https://image.yes24.com/117872327/L', link: 'https://www.yes24.com/product/goods/117872327' },
    ]));

    const result = await enrichCandidateWithYes24({ ...officialCandidate, koreanTitle: '타코피의 원죄', author: '타이잔5' });

    expect(result.yes24).toMatchObject({ matched: true, itemId: '117872327', productUrl: 'https://www.yes24.com/product/goods/117872327' });
  });

  it('matches multiple creators when YES24 inserts role labels between names', async () => {
    vi.stubEnv('YES24_API_KEY', 'test-key');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(yes24Response([
      { itemId: 24023143, title: '호리미야 1', author: 'HERO 글/하기와라 다이스케 그림', publisher: '학산문화사', cover: 'https://image.yes24.com/24023143/L', link: 'https://www.yes24.com/product/goods/24023143' },
    ]));

    const result = await enrichCandidateWithYes24({ ...officialCandidate, koreanTitle: '호리미야', author: 'HERO/하기와라 다이스케' });

    expect(result.yes24).toMatchObject({ matched: true, itemId: '24023143' });
  });

  it('allows YES24 lookup for a confirmed COMMON Korean title', async () => {
    vi.stubEnv('YES24_API_KEY', 'test-key');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(yes24Response([]));

    const result = await enrichCandidateWithYes24({ ...officialCandidate, koreanTitleStatus: 'COMMON' });

    expect(result.yes24).toEqual({ matched: false });
  });

  it('uses YES24 to verify a COMMON title when publication is unconfirmed', async () => {
    vi.stubEnv('YES24_API_KEY', 'test-key');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(yes24Response([]));

    const result = await enrichCandidateWithYes24({ ...officialCandidate, koreanTitleStatus: 'COMMON', publicationStatus: 'UNKNOWN' });

    expect(result.yes24).toEqual({ matched: false });
  });

  it('rejects a same-title item with a conflicting author', async () => {
    vi.stubEnv('YES24_API_KEY', 'test-key');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(yes24Response([
      { itemId: '1', title: '작품명 1권', author: '다른 작가', cover: 'https://image.yes24.com/1.jpg', productUrl: 'https://www.yes24.com/Product/Goods/1' },
    ]));

    const result = await enrichCandidateWithYes24(officialCandidate);

    expect(result.yes24).toEqual({ matched: false });
  });

  it('keeps the MangaFind result when YES24 fails', async () => {
    vi.stubEnv('YES24_API_KEY', 'test-key');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 429 }));

    const result = await enrichCandidateWithYes24(officialCandidate);

    expect(result.japaneseTitle).toBe('作品名');
    expect(result.yes24).toEqual({ matched: false });
  });
});
