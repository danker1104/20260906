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

  it.each([
    { title: '스파이 패밀리 Spy Family 17', originalTitle: '', author: '작가', matched: true },
    { title: '스파이 패밀리 Spy Family 1', originalTitle: 'SPY×FAMILY', author: '작가', matched: true },
    { title: '스파이 패밀리 Spy Family 15', originalTitle: 'SPY×FAMILY 15', author: '작가', matched: true },
    { title: '스파이 패밀리 22', originalTitle: '', author: '작가', matched: true },
    { title: '스파이 패밀리의 비밀 1', originalTitle: '', author: '작가', matched: false },
    { title: '스파이 패밀리 Official Guide 1', originalTitle: '', author: '작가', matched: false },
    { title: '스파이 패밀리 Spy Family 1', originalTitle: 'ANOTHER WORK', author: '작가', matched: false },
    { title: '스파이 패밀리 Spy Family 1', originalTitle: '', author: '다른 작가', matched: false },
  ])('accepts complete Korean titles with English text and volume numbers without crossing identities: $title / $originalTitle / $author', async ({ title, originalTitle, author, matched }) => {
    vi.stubEnv('YES24_API_KEY', 'test-key');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(yes24Response([{
      itemId: 'complete-title', title, originalTitle, author, publisher: '출판사',
      link: 'https://www.yes24.com/product/goods/12345',
    }]));
    const result = await enrichCandidateWithYes24({
      ...officialCandidate, japaneseTitle: 'SPY×FAMILY', koreanTitle: '스파이 패밀리', confidence: 'LOW',
    });
    expect(result.yes24?.matched).toBe(matched);
    expect(result.confidence).toBe('LOW');
    expect(result.koreanTitle).toBe('스파이 패밀리');
  });

  it('selects volume one from the reported bilingual YES24 catalog results', async () => {
    vi.stubEnv('YES24_API_KEY', 'test-key');
    const volumes = [17, 16, 15, 14, 1, 2, 13, 6, 5, 3];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(yes24Response(volumes.map((volume) => ({
      itemId: `volume-${volume}`, title: `스파이 패밀리 Spy Family ${volume}`, author: '엔도 타츠야 글그림', publisher: '학산문화사',
      ...([15, 1, 2, 13, 3].includes(volume) ? { originalTitle: volume === 1 ? 'SPY×FAMILY' : `SPY×FAMILY ${volume}` } : {}),
    }))));
    const result = await enrichCandidateWithYes24({
      ...officialCandidate, japaneseTitle: 'SPY×FAMILY', koreanTitle: '스파이 패밀리', author: '엔도 타츠야', confidence: 'LOW',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.yes24).toMatchObject({ matched: true, itemId: 'volume-1' });
    expect(result.koreanTitle).toBe('스파이 패밀리');
    expect(result.confidence).toBe('LOW');
  });

  it('preserves meaningful numerals in the work title while selecting volume one', async () => {
    vi.stubEnv('YES24_API_KEY', 'test-key');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(yes24Response([
      { itemId: 'second', title: '20세기 소년 2', author: '작가', publisher: '출판사' },
      { itemId: 'first', title: '20세기 소년 1', author: '작가', publisher: '출판사' },
    ]));
    const result = await enrichCandidateWithYes24({ ...officialCandidate, koreanTitle: '20세기 소년', confidence: 'LOW' });
    expect(result.yes24).toMatchObject({ matched: true, itemId: 'first' });
  });

  it.each([
    { isbn: '9780306406157', matched: true },
    { isbn: '9780140328721', matched: false },
  ])('uses the verified ISBN for the existing lookup and rejects a different ISBN: $isbn', async ({ isbn, matched }) => {
    vi.stubEnv('YES24_API_KEY', 'test-key');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(yes24Response([{
      itemId: 'verified-isbn', title: '밤하늘 책방 1', isbn, author: '작가', publisher: '출판사',
      link: 'https://www.yes24.com/product/goods/12345',
    }]));
    const result = await enrichCandidateWithYes24({
      ...officialCandidate, koreanTitle: '밤하늘 책방', confidence: 'LOW', publicationStatus: 'UNKNOWN',
    }, [], '9780306406157');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).searchParams.get('query')).toBe('9780306406157');
    expect(result.yes24?.matched).toBe(matched);
  });

  it.each([
    { title: '정반대의 너와 나', confidence: 'LOW', matched: false },
    { title: '정반대의 너와 나', confidence: 'HIGH', matched: true },
    { title: '정반대인 너와 나', confidence: 'LOW', matched: true },
    { title: '완전히 다른 이야기', confidence: 'HIGH', matched: false },
  ] as const)('keeps catalog matching separate from Korean name discovery: $title / $confidence', async ({ title, confidence, matched }) => {
    vi.stubEnv('YES24_API_KEY', 'test-key');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(yes24Response([{
      itemId: 'similar-title', title: `${title} 1권`, author: '작가', publisher: '출판사',
      link: 'https://www.yes24.com/product/goods/12345',
    }]));
    const result = await enrichCandidateWithYes24({
      ...officialCandidate, koreanTitle: '정반대인 너와 나', confidence,
      koreanTitleStatus: 'TRANSLATED', publicationStatus: 'UNKNOWN',
    });
    expect(result.yes24?.matched).toBe(matched);
    expect(result.koreanTitle).toBe('정반대인 너와 나');
    expect(result.koreanTitleStatus).toBe('TRANSLATED');
    expect(result.publicationStatus).toBe('UNKNOWN');
  });

  it('keeps existing representative-volume selection independent of Korean name similarity', async () => {
    vi.stubEnv('YES24_API_KEY', 'test-key');
    const reference = '단다단';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(yes24Response([
      { itemId: 'second', title: `${reference} 2`, author: '작가', publisher: '출판사', link: 'https://www.yes24.com/product/goods/12345' },
      { itemId: 'first', title: `${reference} 1`, author: '작가', publisher: '출판사', link: 'https://www.yes24.com/product/goods/12346' },
      { itemId: 'third', title: `${reference} 3`, author: '작가', publisher: '출판사', link: 'https://www.yes24.com/product/goods/12347' },
    ]));
    const result = await enrichCandidateWithYes24({ ...officialCandidate, koreanTitle: reference });
    expect(result.yes24).toMatchObject({ matched: true, itemId: 'first' });
  });

  it.each(['verified', 'wrong-original', 'unsafe-url'])('reuses an existing LOW search link only with matching original and a safe YES24 URL: %s', async (kind) => {
    vi.stubEnv('YES24_API_KEY', '');
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const result = await enrichCandidateWithYes24({
      ...officialCandidate, japaneseTitle: '正反対な君と僕', koreanTitle: '정반대인 너와 나',
      confidence: 'LOW', koreanTitleStatus: 'TRANSLATED', publicationStatus: 'UNKNOWN',
    }, [{
      title: '정반대의 너와 나 1권 - YES24',
      url: kind === 'unsafe-url' ? 'https://www.yes24.com.evil.example/product/goods/184510430' : 'https://www.yes24.com/product/goods/184510430',
      content: `일본 원제 『${kind === 'wrong-original' ? '君の膵臓をたべたい' : '正反対な君と僕'}』 한국어판 만화`, score: 0.9,
    }]);
    expect(result.yes24?.matched).toBe(kind === 'verified');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.confidence).toBe('LOW');
    expect(result.koreanTitle).toBe(kind === 'verified' ? '정반대의 너와 나' : '정반대인 너와 나');
    expect(result.koreanTitleStatus).toBe(kind === 'verified' ? 'OFFICIAL' : 'TRANSLATED');
  });

  it('matches a LOW reference title against the actual catalog instead of requiring release confirmation first', async () => {
    vi.stubEnv('YES24_API_KEY', 'test-key');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(yes24Response([{
      itemId: '184510430', title: '정반대의 너와 나 1권', originalTitle: '正反対な君と僕',
      author: '아가사와 코챠', publisher: '학산문화사', link: 'https://www.yes24.com/product/goods/184510430',
    }]));
    const result = await enrichCandidateWithYes24({
      ...officialCandidate, japaneseTitle: '正反対な君と僕', koreanTitle: '정반대인 너와 나', author: '阿賀沢紅茶',
      confidence: 'LOW', koreanTitleStatus: 'TRANSLATED', publicationStatus: 'UNKNOWN',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.yes24?.matched).toBe(true);
    expect(result.confidence).toBe('LOW');
    expect(result.koreanTitle).toBe('정반대의 너와 나');
    expect(result.koreanTitleStatus).toBe('OFFICIAL');
  });

  it.each(['9780306406157', '9780306406158'])('validates an optional catalog ISBN without requiring one: %s', async (isbn) => {
    vi.stubEnv('YES24_API_KEY', 'test-key');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(yes24Response([{
      itemId: 'mock-isbn', title: '작품명 1권', author: '작가', publisher: '출판사', isbn,
    }]));
    const result = await enrichCandidateWithYes24(officialCandidate);
    expect(result.yes24?.matched).toBe(isbn === '9780306406157');
  });

  it.each([{ title: '정반대의 너와 나 1권 [직수입일서]', language: '' }, { title: '정반대의 너와 나 1권', language: 'jpn' }])('does not attach a Japanese import as a Korean release: $title $language', async (item) => {
    vi.stubEnv('YES24_API_KEY', 'test-key');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(yes24Response([{
      itemId: 'mock-import', originalTitle: '正反対な君と僕', author: '아가사와 코챠', publisher: '일본 출판사', ...item,
    }]));
    const result = await enrichCandidateWithYes24({ ...officialCandidate, japaneseTitle: '正反対な君と僕', koreanTitle: '정반대의 너와 나' });
    expect(result.yes24?.matched).toBe(false);
  });

  it('queries a verified Korean release even when OCR uncertainty lowered image confidence (Case 05)', async () => {
    vi.stubEnv('YES24_API_KEY', 'test-key');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(yes24Response([{
      itemId: '184510430', title: '정반대의 너와 나 1권', originalTitle: '正反対な君と僕',
      author: '아가사와 코챠', publisher: '학산문화사',
      cover: 'https://image.yes24.com/mock-case05-cover.jpg',
      link: 'https://www.yes24.com/product/goods/184510430',
    }]));
    const result = await enrichCandidateWithYes24({
      ...officialCandidate, japaneseTitle: '正反対な君と僕', koreanTitle: '정반대의 너와 나',
      author: '阿賀沢紅茶', confidence: 'LOW',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.confidence).toBe('LOW');
    expect(result.yes24).toMatchObject({
      matched: true, itemId: '184510430', publisher: '학산문화사',
      productUrl: 'https://www.yes24.com/product/goods/184510430',
      coverUrl: 'https://image.yes24.com/mock-case05-cover.jpg',
    });
  });

  it.each(['星空の図書館', '星空の図書館の続編'])('checks original identity before Korean title similarity: %s', async (originalTitle) => {
    vi.stubEnv('YES24_API_KEY', 'test-key');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(yes24Response([{
      itemId: 'same-original', title: '밤하늘 책방 1권', originalTitle, author: '작가',
      publisher: '출판사', productUrl: 'https://www.yes24.com/Product/Goods/same-original',
    }]));
    const result = await enrichCandidateWithYes24({
      ...officialCandidate, japaneseTitle: '星空の図書館', koreanTitle: '별하늘의 도서관', koreanTitleStatus: 'TRANSLATED',
    });
    expect(result.yes24?.matched).toBe(originalTitle === '星空の図書館');
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

  it('allows YES24 lookup for a confirmed COMMON Korean title', async () => {
    vi.stubEnv('YES24_API_KEY', 'test-key');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(yes24Response([]));

    const result = await enrichCandidateWithYes24({ ...officialCandidate, koreanTitleStatus: 'COMMON' });

    expect(result.yes24).toEqual({ matched: false });
  });

  it('uses an AI/reference Korean title as a lookup query without relabeling its title status', async () => {
    vi.stubEnv('YES24_API_KEY', 'test-key');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(yes24Response([
      { itemId: '21', title: '작품명 1권', author: '작가', publisher: '출판사', cover: 'https://image.yes24.com/21.jpg', productUrl: 'https://www.yes24.com/Product/Goods/21' },
    ]));

    const result = await enrichCandidateWithYes24({
      ...officialCandidate,
      koreanTitle: '작품명',
      koreanTitleStatus: 'TRANSLATED',
      publicationStatus: 'UNKNOWN',
    });

    expect(result.koreanTitleStatus).toBe('TRANSLATED');
    expect(result.yes24).toMatchObject({ matched: true, itemId: '21' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps a matching YES24 product even when the catalog omits its cover image', async () => {
    vi.stubEnv('YES24_API_KEY', 'test-key');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(yes24Response([
      { itemId: '22', title: '작품명 1권', author: '작가', publisher: '출판사', productUrl: 'https://www.yes24.com/Product/Goods/22' },
    ]));

    const result = await enrichCandidateWithYes24(officialCandidate);

    expect(result.yes24).toMatchObject({ matched: true, itemId: '22', productUrl: 'https://www.yes24.com/Product/Goods/22' });
    expect(result.yes24?.coverUrl).toBeUndefined();
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

  it('rejects a Korean title match when the YES24 original Japanese title conflicts with the canonical title', async () => {
    vi.stubEnv('YES24_API_KEY', 'test-key');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(yes24Response([
      {
        itemId: 'popular-unrelated-work',
        title: '너의 췌장을 먹고 싶어 1권',
        originalTitle: '君の膵臓をたべたい',
        author: '스미노 요루',
        publisher: '다른 출판사',
        productUrl: 'https://www.yes24.com/Product/Goods/popular-unrelated-work',
      },
    ]));

    const result = await enrichCandidateWithYes24({
      ...officialCandidate,
      japaneseTitle: '放課後のアイドルには秘密がある',
      koreanTitle: '너의 췌장을 먹고 싶어',
      author: 'あまねかしこ',
    });

    expect(result.yes24).toEqual({ matched: false });
  });

  it('keeps the MangaFind result when YES24 fails', async () => {
    vi.stubEnv('YES24_API_KEY', 'test-key');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 429 }));

    const result = await enrichCandidateWithYes24(officialCandidate);

    expect(result.japaneseTitle).toBe('作品名');
    expect(result.yes24).toEqual({ matched: false });
  });

  it('skips YES24 when no Korean lookup title is available', async () => {
    vi.stubEnv('YES24_API_KEY', 'test-key');
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    const result = await enrichCandidateWithYes24({ ...officialCandidate, confidence: 'MEDIUM', koreanTitle: null, koreanTitleStatus: 'UNKNOWN', publicationStatus: 'UNKNOWN' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.yes24).toEqual({ matched: false });
  });
});
