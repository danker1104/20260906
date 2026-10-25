import type { NlApiMode, PublicationQueryType } from '../domain/publication-types';

/** Raw 국립중앙도서관 서지정보(Seoji) record shape, before status/volume/edition normalization. */
export interface NlRawRecord {
  id: string;
  title: string;
  volumeLabel?: string | null;
  seriesTitle?: string | null;
  seriesNumber?: string | null;
  isbn: string | null;
  isbnSource?: 'EA_ISBN' | 'SET_ISBN' | null;
  author: string | null;
  publisher: string | null;
  editionStatement?: string | null;
  form?: string | null;
  ebookYn?: 'Y' | 'N' | null;
  subject?: string | null;
  isbnAdditionalCode?: string | null;
  bookIntroduction?: string | null;
  bookSummary?: string | null;
  /** 'Y' when the record itself is a future publication-date pre-registration. */
  pubPredateYn: 'Y' | 'N' | null;
  /** Expected publication date in YYYY-MM-DD form. */
  expectedPublicationDate: string | null;
  /** 'Y' once a physical copy has been deposited (CIP/납본), independent of sale status. */
  depositStatus: 'Y' | 'N' | null;
  coverUrl: string | null;
  inputDate?: string | null;
  updateDate?: string | null;
  relatedIsbn?: string | null;
}

export interface NationalLibrarySearchParams {
  query: string;
  queryType: PublicationQueryType;
  page: number;
  pageSize: number;
}

export interface NationalLibrarySearchResult {
  pageNo: number;
  records: NlRawRecord[];
  totalCount: number;
  hasMore: boolean;
}

export interface NationalLibraryProvider {
  readonly mode: NlApiMode;
  search(params: NationalLibrarySearchParams, signal?: AbortSignal): Promise<NationalLibrarySearchResult>;
}

export type NationalLibraryApiErrorCode = '000' | '010' | '011' | '012' | '013';

export class NationalLibraryApiError extends Error {
  constructor(readonly code: NationalLibraryApiErrorCode) {
    super(`National Library API rejected the request (${code})`);
    this.name = 'NationalLibraryApiError';
  }
}

export class NationalLibraryConfigError extends Error {
  constructor(message = 'NL_API_KEY is not configured for NL_API_MODE=live') {
    super(message);
    this.name = 'NationalLibraryConfigError';
  }
}

export class NationalLibraryUpstreamError extends Error {
  constructor(message: string, readonly code: 'TIMEOUT' | 'HTTP' | 'INVALID_JSON' | 'INVALID_SHAPE' | 'NETWORK' = 'NETWORK') {
    super(message);
    this.name = 'NationalLibraryUpstreamError';
  }
}

export function getPublicationMode(): NlApiMode {
  return process.env.NL_API_MODE?.trim() === 'live' ? 'live' : 'mock';
}
