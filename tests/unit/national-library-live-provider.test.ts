import { afterEach, describe, expect, it, vi } from 'vitest';
import { liveNationalLibraryProvider } from '../../src/lib/publication/live-provider';
import { NationalLibraryApiError, NationalLibraryConfigError, NationalLibraryUpstreamError } from '../../src/lib/publication/provider';

const params = {
  query: '시험 제목',
  queryType: 'TITLE' as const,
  page: 1,
  pageSize: 10,
};

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

describe('National Library Live Provider (network mocked)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('fails before fetch when the live API key is missing', async () => {
    vi.stubEnv('NL_API_KEY', '');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await expect(liveNationalLibraryProvider.search(params)).rejects.toBeInstanceOf(NationalLibraryConfigError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends the documented title parameters and maps documented bibliographic fields', async () => {
    vi.stubEnv('NL_API_KEY', 'test-key-never-real');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({
      PAGE_NO: '1',
      TOTAL_COUNT: '1',
      docs: [{
        TITLE: '작품명',
        VOL: '제 2 권',
        SERIES_TITLE: '작품명',
        SERIES_NO: '2',
        AUTHOR: '가상 작가',
        EA_ISBN: '0012345678901',
        SET_ISBN: '9780000000000',
        PUBLISHER: '가상 출판사',
        EDITION_STMT: '특별판',
        FORM: '종이책',
        PUBLISH_PREDATE: '20261231',
        EBOOK_YN: 'N',
        SUBJECT: '만화',
        EA_ADD_CODE: '05690',
        BOOK_INTRODUCTION: '가상 만화 소개',
        BOOK_SUMMARY: '가상 만화 요약',
        TITLE_URL: null,
        INPUT_DATE: '20260101',
        UPDATE_DATE: '20260201',
        DEPOSIT_YN: 'Y',
        RELATED_ISBN: '9781111111111',
      }],
    }));

    const result = await liveNationalLibraryProvider.search(params);
    const requestUrl = new URL(String(fetchSpy.mock.calls[0]?.[0]));
    const record = result.records[0];

    expect(requestUrl.origin + requestUrl.pathname).toBe('https://www.nl.go.kr/seoji/SearchApi.do');
    expect(requestUrl.searchParams.get('result_style')).toBe('json');
    expect(requestUrl.searchParams.get('page_no')).toBe('1');
    expect(requestUrl.searchParams.get('page_size')).toBe('10');
    expect(requestUrl.searchParams.get('title')).toBe('시험 제목');
    expect(requestUrl.searchParams.has('isbn')).toBe(false);
    expect(result.totalCount).toBe(1);
    expect(result.pageNo).toBe(1);
    expect(record).toMatchObject({
      title: '작품명',
      volumeLabel: '제 2 권',
      seriesTitle: '작품명',
      seriesNumber: '2',
      isbn: '0012345678901',
      publisher: '가상 출판사',
      editionStatement: '특별판',
      form: '종이책',
      expectedPublicationDate: '2026-12-31',
      ebookYn: 'N',
      subject: '만화',
      isbnAdditionalCode: '05690',
      bookIntroduction: '가상 만화 소개',
      bookSummary: '가상 만화 요약',
      inputDate: '2026-01-01',
      updateDate: '2026-02-01',
      depositStatus: 'Y',
      relatedIsbn: '9781111111111',
      coverUrl: null,
    });
  });

  it('uses isbn instead of title for an ISBN query', async () => {
    vi.stubEnv('NL_API_KEY', 'test-key-never-real');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ PAGE_NO: '1', TOTAL_COUNT: '0', docs: [] }));

    const result = await liveNationalLibraryProvider.search({ ...params, query: '0012345678901', queryType: 'ISBN' });
    const requestUrl = new URL(String(fetchSpy.mock.calls[0]?.[0]));

    expect(requestUrl.searchParams.get('isbn')).toBe('0012345678901');
    expect(requestUrl.searchParams.has('title')).toBe(false);
    expect(result.records).toEqual([]);
    expect(result.totalCount).toBe(0);
  });

  it('removes ISBN separators while preserving leading zeroes', async () => {
    vi.stubEnv('NL_API_KEY', 'test-key-never-real');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ PAGE_NO: '1', TOTAL_COUNT: '0', docs: [] }));

    await liveNationalLibraryProvider.search({ ...params, query: '001-2345-6789-01', queryType: 'ISBN' });

    const requestUrl = new URL(String(fetchSpy.mock.calls[0]?.[0]));
    expect(requestUrl.searchParams.get('isbn')).toBe('0012345678901');
  });

  it('maps documented API error codes in an HTTP 200 response to typed errors', async () => {
    vi.stubEnv('NL_API_KEY', 'test-key-never-real');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ error: { code: '011' } }));

    await expect(liveNationalLibraryProvider.search(params)).rejects.toMatchObject<Partial<NationalLibraryApiError>>({ code: '011' });
  });

  it('recognizes a documented error code returned directly in a result value', async () => {
    vi.stubEnv('NL_API_KEY', 'test-key-never-real');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ result: '010' }));

    await expect(liveNationalLibraryProvider.search(params)).rejects.toMatchObject<Partial<NationalLibraryApiError>>({ code: '010' });
  });

  it('does not turn an unknown response shape into an empty successful search', async () => {
    vi.stubEnv('NL_API_KEY', 'test-key-never-real');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ message: 'unrecognized shape' }));

    await expect(liveNationalLibraryProvider.search(params)).rejects.toBeInstanceOf(NationalLibraryUpstreamError);
  });

  it('does not treat a blank total count as a valid empty result', async () => {
    vi.stubEnv('NL_API_KEY', 'test-key-never-real');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ PAGE_NO: '1', TOTAL_COUNT: '', docs: [] }));

    await expect(liveNationalLibraryProvider.search(params)).rejects.toMatchObject({ code: 'INVALID_SHAPE' });
  });

  it('uses no automatic retries after an HTTP error', async () => {
    vi.stubEnv('NL_API_KEY', 'test-key-never-real');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({}, 503));

    await expect(liveNationalLibraryProvider.search(params)).rejects.toBeInstanceOf(NationalLibraryUpstreamError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('turns invalid dates and non-Y/N flags into unknown values', async () => {
    vi.stubEnv('NL_API_KEY', 'test-key-never-real');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({
      PAGE_NO: '1',
      TOTAL_COUNT: '1',
      docs: [{ TITLE: '날짜 오류', EA_ISBN: '0012345678901', PUBLISH_PREDATE: '20260230', DEPOSIT_YN: 'unknown' }],
    }));

    const result = await liveNationalLibraryProvider.search(params);

    expect(result.records[0]).toMatchObject({
      expectedPublicationDate: null,
      pubPredateYn: 'N',
      depositStatus: null,
      isbn: '0012345678901',
    });
  });

  it('honors an aborted caller signal without sending the API key in an error', async () => {
    vi.stubEnv('NL_API_KEY', 'test-key-never-real');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      if (init?.signal?.aborted) {
        const error = new Error('aborted');
        error.name = 'AbortError';
        throw error;
      }
      return response({ PAGE_NO: '1', TOTAL_COUNT: '0', docs: [] });
    });
    const controller = new AbortController();
    controller.abort();

    const rejection = liveNationalLibraryProvider.search(params, controller.signal);
    await expect(rejection).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.results[0]?.type).not.toBe('throw');
  });
});