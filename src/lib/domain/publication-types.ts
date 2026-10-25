export const nlApiModes = ['mock', 'live'] as const;
export type NlApiMode = (typeof nlApiModes)[number];

export const publicationQueryTypes = ['TITLE', 'ISBN'] as const;
export type PublicationQueryType = (typeof publicationQueryTypes)[number];

// ISBN registration is not the same as a confirmed release; deposit confirms a copy was received.
export const volumeStatuses = ['UPCOMING', 'DATE_PASSED', 'DEPOSITED', 'REGISTERED', 'UNKNOWN'] as const;
export type VolumeStatus = (typeof volumeStatuses)[number];

export const editionKinds = ['REGULAR', 'SPECIAL', 'COMPLETE', 'EBOOK', 'UNKNOWN'] as const;
export type EditionKind = (typeof editionKinds)[number];

export const volumeSortOrders = ['VOLUME_ASC', 'VOLUME_DESC', 'EXPECTED_DATE'] as const;
export type VolumeSortOrder = (typeof volumeSortOrders)[number];

export const volumeStatusFilters = ['ALL', 'UPCOMING', 'DEPOSITED', 'REGISTERED'] as const;
export type VolumeStatusFilter = (typeof volumeStatusFilters)[number];

export const mangaClassifications = ['MANGA_LIKELY', 'UNCERTAIN', 'NON_MANGA_LIKELY'] as const;
export type MangaClassification = (typeof mangaClassifications)[number];

export const publicationRelevanceBands = ['HIGH', 'LOW'] as const;
export type PublicationRelevanceBand = (typeof publicationRelevanceBands)[number];

export interface PublicationVolume {
  recordId: string;
  title: string;
  seriesTitle?: string | null;
  seriesNumber?: string | null;
  volumeNumber: number | null;
  volumeLabel: string | null;
  isbn: string | null;
  isbnSource?: 'EA_ISBN' | 'SET_ISBN' | null;
  author: string | null;
  publisher: string | null;
  editionStatement?: string | null;
  form?: string | null;
  ebookYn?: 'Y' | 'N' | null;
  expectedPublicationDate: string | null;
  inputDate?: string | null;
  updateDate?: string | null;
  relatedIsbn?: string | null;
  status: VolumeStatus;
  edition: EditionKind;
  coverUrl: string | null;
  productUrl: string | null;
  isMock: boolean;
}

export interface PublicationWork {
  workKey: string;
  title: string;
  author: string | null;
  publisher: string | null;
  volumes: PublicationVolume[];
  mangaClassification?: MangaClassification;
  relevanceBand?: PublicationRelevanceBand;
}

export interface PublicationSearchResponse {
  query: string;
  queryType: PublicationQueryType;
  mode: NlApiMode;
  page: number;
  pageSize: number;
  hasMore: boolean;
  totalCount: number;
  works: PublicationWork[];
  /** Volumes whose work grouping could not be determined with confidence; never merged into `works` by guesswork. */
  ungroupedVolumes: PublicationVolume[];
}

export const publicationErrorCodes = [
  'INVALID_QUERY',
  'CONFIG_ERROR',
  'API_REJECTED',
  'TIMEOUT',
  'UPSTREAM_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;
export type PublicationErrorCode = (typeof publicationErrorCodes)[number];

export interface PublicationErrorResponse {
  error: {
    code: PublicationErrorCode;
    message: string;
    requestId: string;
  };
}

export interface Yes24LookupResponse {
  mode: NlApiMode;
  matched: boolean;
  itemId?: string;
  title?: string;
  coverUrl?: string;
  productUrl?: string;
  publisher?: string;
}
