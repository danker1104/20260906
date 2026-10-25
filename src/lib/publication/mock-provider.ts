import {
  MOCK_EMPTY_QUERY_TOKEN,
  MOCK_ERROR_QUERY_TOKEN,
  MOCK_NL_RECORDS,
} from './mock-data';
import {
  NationalLibraryUpstreamError,
  type NationalLibraryProvider,
  type NationalLibrarySearchParams,
  type NationalLibrarySearchResult,
  type NlRawRecord,
} from './provider';

function normalizeIsbn(value: string): string {
  return value.replace(/[^0-9Xx]/gu, '').toUpperCase();
}

function matches(record: NlRawRecord, params: NationalLibrarySearchParams): boolean {
  if (params.queryType === 'ISBN') {
    return record.isbn !== null && normalizeIsbn(record.isbn) === normalizeIsbn(params.query);
  }
  return record.title.toLocaleLowerCase('ko-KR').includes(params.query.toLocaleLowerCase('ko-KR'));
}

/**
 * Mock National Library provider. Reads a fixed, clearly-labelled in-memory dataset —
 * it never performs network I/O, so NL_API_MODE=mock has zero external API cost.
 */
export const mockNationalLibraryProvider: NationalLibraryProvider = {
  mode: 'mock',
  async search(params: NationalLibrarySearchParams): Promise<NationalLibrarySearchResult> {
    if (params.query.includes(MOCK_ERROR_QUERY_TOKEN)) {
      throw new NationalLibraryUpstreamError('Simulated upstream error for mock-mode error-path testing.');
    }
    if (params.query.includes(MOCK_EMPTY_QUERY_TOKEN)) {
      return { pageNo: params.page, records: [], totalCount: 0, hasMore: false };
    }

    const allMatches = MOCK_NL_RECORDS.filter((record) => matches(record, params));
    const start = (params.page - 1) * params.pageSize;
    const page = allMatches.slice(start, start + params.pageSize);
    return {
      pageNo: params.page,
      records: page,
      totalCount: allMatches.length,
      hasMore: start + page.length < allMatches.length,
    };
  },
};
