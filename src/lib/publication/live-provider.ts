import { z } from 'zod';
import { fetchWithTimeout } from '../search/provider-utils';
import {
  NationalLibraryApiError,
  NationalLibraryConfigError,
  NationalLibraryUpstreamError,
  type NationalLibraryApiErrorCode,
  type NationalLibraryProvider,
  type NationalLibrarySearchParams,
  type NationalLibrarySearchResult,
  type NlRawRecord,
} from './provider';

// API field names and error codes are from the official ISBN 서지정보 API guide:
// https://www.nl.go.kr/NL/contents/N31101030500.do
// This Seoji endpoint uses `cert_key`; the separate holdings-search API uses `key`.
const NL_API_URL = 'https://www.nl.go.kr/seoji/SearchApi.do';
const NL_TIMEOUT_MS = 10_000;
const API_ERROR_CODES = new Set<NationalLibraryApiErrorCode>(['000', '010', '011', '012', '013']);
const apiText = z.union([z.string(), z.number()]).nullable().optional();

const apiRecordSchema = z.object({
  TITLE: apiText,
  VOL: apiText,
  SERIES_TITLE: apiText,
  SERIES_NO: apiText,
  AUTHOR: apiText,
  EA_ISBN: apiText,
  SET_ISBN: apiText,
  PUBLISHER: apiText,
  EDITION_STMT: apiText,
  FORM: apiText,
  PUBLISH_PREDATE: apiText,
  EBOOK_YN: apiText,
  SUBJECT: apiText,
  EA_ADD_CODE: apiText,
  BOOK_INTRODUCTION: apiText,
  BOOK_SUMMARY: apiText,
  TITLE_URL: apiText,
  INPUT_DATE: apiText,
  UPDATE_DATE: apiText,
  DEPOSIT_YN: apiText,
  RELATED_ISBN: apiText,
}).passthrough();

const responseEnvelopeSchema = z.object({}).passthrough();

function normalizeKey(value: string): string {
  return value.replace(/[^a-z0-9]/giu, '').toLocaleLowerCase('en-US');
}

function getScalar(value: unknown): string | number | null {
  if (typeof value === 'string' || typeof value === 'number') return value;
  return null;
}

function nonNegativeInteger(value: string | number | null): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value !== 'string' || !/^\d+$/u.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function findNamedScalar(payload: unknown, names: Set<string>): string | number | null {
  const pending: Array<{ value: unknown; depth: number }> = [{ value: payload, depth: 0 }];
  while (pending.length) {
    const current = pending.shift();
    if (!current || current.depth > 5 || !current.value || typeof current.value !== 'object') continue;
    if (Array.isArray(current.value)) {
      for (const item of current.value) pending.push({ value: item, depth: current.depth + 1 });
      continue;
    }
    for (const [key, value] of Object.entries(current.value)) {
      if (names.has(normalizeKey(key))) {
        const scalar = getScalar(value);
        if (scalar !== null) return scalar;
      }
      if (value && typeof value === 'object') pending.push({ value, depth: current.depth + 1 });
    }
  }
  return null;
}

function findApiErrorCode(payload: unknown): NationalLibraryApiErrorCode | null {
  if (typeof payload === 'string') {
    const directCode = payload.trim().padStart(3, '0');
    if (API_ERROR_CODES.has(directCode as NationalLibraryApiErrorCode)) return directCode as NationalLibraryApiErrorCode;
  }
  const pending: Array<{ value: unknown; depth: number }> = [{ value: payload, depth: 0 }];
  while (pending.length) {
    const current = pending.shift();
    if (!current || current.depth > 5 || !current.value || typeof current.value !== 'object') continue;
    if (Array.isArray(current.value)) {
      for (const item of current.value) pending.push({ value: item, depth: current.depth + 1 });
      continue;
    }
    for (const [key, value] of Object.entries(current.value)) {
      const normalizedKey = normalizeKey(key);
      const scalar = getScalar(value);
      if ((/^(?:error|result)?code$/u.test(normalizedKey) || normalizedKey === 'error' || normalizedKey === 'result') && scalar !== null) {
        const code = String(scalar).trim().padStart(3, '0');
        if (API_ERROR_CODES.has(code as NationalLibraryApiErrorCode)) return code as NationalLibraryApiErrorCode;
      }
      if (value && typeof value === 'object') pending.push({ value, depth: current.depth + 1 });
    }
  }
  return null;
}

function findRecords(payload: unknown): unknown[] | null {
  const recordKeys = new Set(['docs', 'records', 'items', 'resultlist', 'recordlist']);
  const containerKeys = new Set(['data', 'result', 'response', 'results']);
  const pending: Array<{ value: unknown; depth: number }> = [{ value: payload, depth: 0 }];
  while (pending.length) {
    const current = pending.shift();
    if (!current || current.depth > 5 || !current.value || typeof current.value !== 'object') continue;
    if (Array.isArray(current.value)) return current.value;
    for (const [key, value] of Object.entries(current.value)) {
      const normalizedKey = normalizeKey(key);
      if (recordKeys.has(normalizedKey) && Array.isArray(value)) return value;
      if (containerKeys.has(normalizedKey) && value && typeof value === 'object') {
        pending.push({ value, depth: current.depth + 1 });
      }
    }
  }
  return null;
}

function text(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function date(value: unknown): string | null {
  const normalized = text(value);
  if (!normalized) return null;
  const match = normalized.match(/^(\d{4})\D?(\d{2})\D?(\d{2})$/u);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.getUTCFullYear() !== year || parsed.getUTCMonth() + 1 !== month || parsed.getUTCDate() !== day) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function flag(value: unknown): 'Y' | 'N' | null {
  const normalized = text(value)?.toUpperCase();
  return normalized === 'Y' || normalized === 'N' ? normalized : null;
}

function safeHttpsUrl(value: unknown): string | null {
  const normalized = text(value);
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function mapRecord(raw: z.infer<typeof apiRecordSchema>): NlRawRecord | null {
  const title = text(raw.TITLE);
  if (!title) return null;
  const volumeLabel = text(raw.VOL);
  const seriesTitle = text(raw.SERIES_TITLE);
  const seriesNumber = text(raw.SERIES_NO);
  const author = text(raw.AUTHOR);
  const publisher = text(raw.PUBLISHER);
  const editionIsbn = text(raw.EA_ISBN);
  const setIsbn = text(raw.SET_ISBN);
  const isbn = editionIsbn ?? setIsbn;
  const expectedPublicationDate = date(raw.PUBLISH_PREDATE);
  return {
    id: editionIsbn ?? `${seriesTitle ?? title}::${author ?? ''}::${publisher ?? ''}::${volumeLabel ?? ''}::${seriesNumber ?? ''}`,
    title,
    volumeLabel,
    seriesTitle,
    seriesNumber,
    isbn,
    isbnSource: editionIsbn ? 'EA_ISBN' : setIsbn ? 'SET_ISBN' : null,
    author,
    publisher,
    editionStatement: text(raw.EDITION_STMT),
    form: text(raw.FORM),
    ebookYn: flag(raw.EBOOK_YN),
    subject: text(raw.SUBJECT),
    isbnAdditionalCode: text(raw.EA_ADD_CODE),
    bookIntroduction: text(raw.BOOK_INTRODUCTION),
    bookSummary: text(raw.BOOK_SUMMARY),
    pubPredateYn: expectedPublicationDate ? 'Y' : 'N',
    expectedPublicationDate,
    depositStatus: flag(raw.DEPOSIT_YN),
    coverUrl: safeHttpsUrl(raw.TITLE_URL),
    inputDate: date(raw.INPUT_DATE),
    updateDate: date(raw.UPDATE_DATE),
    relatedIsbn: text(raw.RELATED_ISBN),
  };
}

function parseResponse(payload: unknown, requestedPage: number, pageSize: number): NationalLibrarySearchResult {
  const envelope = responseEnvelopeSchema.safeParse(payload);
  if (!envelope.success && !Array.isArray(payload)) {
    throw new NationalLibraryUpstreamError('National Library response did not match the expected JSON object shape.', 'INVALID_SHAPE');
  }

  const apiErrorCode = findApiErrorCode(payload);
  if (apiErrorCode) throw new NationalLibraryApiError(apiErrorCode);

  const rawRecords = findRecords(payload);
  const totalValue = findNamedScalar(payload, new Set(['totalcount']));
  const pageValue = findNamedScalar(payload, new Set(['pageno']));
  const parsedTotal = nonNegativeInteger(totalValue);
  const parsedPage = pageValue === null ? requestedPage : nonNegativeInteger(pageValue);

  if ((rawRecords === null && parsedTotal !== 0) || parsedTotal === null || parsedPage === null || parsedPage < 1) {
    throw new NationalLibraryUpstreamError('National Library response is missing valid pagination or record data.', 'INVALID_SHAPE');
  }

  const records: NlRawRecord[] = [];
  for (const raw of rawRecords ?? []) {
    const parsedRecord = apiRecordSchema.safeParse(raw);
    if (!parsedRecord.success) {
      throw new NationalLibraryUpstreamError('A National Library bibliographic record did not match the expected schema.', 'INVALID_SHAPE');
    }
    const mapped = mapRecord(parsedRecord.data);
    if (mapped) records.push(mapped);
  }
  if ((rawRecords?.length ?? 0) > 0 && records.length === 0) {
    throw new NationalLibraryUpstreamError('National Library records did not contain usable titles.', 'INVALID_SHAPE');
  }

  return {
    pageNo: parsedPage,
    records,
    totalCount: parsedTotal,
    hasMore: parsedPage * pageSize < parsedTotal,
  };
}

/** Live National Library provider. It performs one request per search and never retries. */
export const liveNationalLibraryProvider: NationalLibraryProvider = {
  mode: 'live',
  async search(params: NationalLibrarySearchParams, signal?: AbortSignal): Promise<NationalLibrarySearchResult> {
    const apiKey = process.env.NL_API_KEY?.trim();
    if (!apiKey) throw new NationalLibraryConfigError();

    const url = new URL(NL_API_URL);
    url.searchParams.set('cert_key', apiKey);
    url.searchParams.set('result_style', 'json');
    url.searchParams.set('page_no', String(params.page));
    url.searchParams.set('page_size', String(params.pageSize));
    const searchValue = params.queryType === 'ISBN'
      ? params.query.replace(/[\s-]/gu, '')
      : params.query;
    url.searchParams.set(params.queryType === 'ISBN' ? 'isbn' : 'title', searchValue);

    let response: Response;
    try {
      response = await fetchWithTimeout(url, { method: 'GET', cache: 'no-store' }, NL_TIMEOUT_MS, signal);
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'AbortError';
      throw new NationalLibraryUpstreamError(
        timedOut ? 'National Library request timed out.' : 'National Library request failed.',
        timedOut ? 'TIMEOUT' : 'NETWORK',
      );
    }
    if (!response.ok) throw new NationalLibraryUpstreamError(`National Library returned HTTP ${response.status}.`, 'HTTP');

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new NationalLibraryUpstreamError('National Library returned invalid JSON.', 'INVALID_JSON');
    }
    return parseResponse(payload, params.page, params.pageSize);
  },
};