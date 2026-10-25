import type { Candidate, Yes24Enrichment } from '../domain/types';
import { fetchWithTimeout, readJson } from './provider-utils';
import { normalizeJapaneseTitle } from './lens-candidates';
import { detectQueryType } from '../publication/normalize';
import { hasFullWorkTitle } from './work-title-verification';
import type { WebSearchResult } from './types';

const YES24_API_URL = 'https://apis.yes24.com/v1/goods/itemList';
const YES24_QUERY_TIMEOUT_MS = 8_000;

interface Yes24Item {
  itemId: string;
  title: string;
  author: string;
  originalTitle: string;
  language: string;
  isbn: string;
  series: string;
  publisher: string;
  coverUrl: string;
  productUrl: string;
}

function text(value: unknown): string {
  return (typeof value === 'string' || typeof value === 'number')
    ? String(value).replace(/\s+/gu, ' ').trim().slice(0, 500)
    : '';
}

function firstText(item: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = text(item[key]);
    if (value) return value;
  }
  return '';
}

function absoluteHttpsUrl(value: string): string {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function unwrapItems(payload: unknown): Record<string, unknown>[] {
  if (!payload || typeof payload !== 'object') return [];
  const root = payload as Record<string, unknown>;
  const candidates = [root.items, root.itemList, root.results, root.data, root.goods];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'));
    if (candidate && typeof candidate === 'object') {
      const nested = candidate as Record<string, unknown>;
      for (const nestedValue of [nested.items, nested.itemList, nested.results, nested.goods]) {
        if (Array.isArray(nestedValue)) return nestedValue.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'));
      }
    }
  }
  return [];
}

function mapItem(item: Record<string, unknown>): Yes24Item | null {
  const itemId = firstText(item, ['itemId', 'goodsId', 'id']);
  const title = firstText(item, ['title', 'goodsName', 'name']);
  const author = firstText(item, ['author', 'authors', 'writer']);
  const originalTitle = firstText(item, ['originalTitle', 'originalName']);
  const language = firstText(item, ['language', 'languageCode', 'productLanguage']);
  const isbn = firstText(item, ['isbn13', 'isbn', 'isbn10']);
  const series = firstText(item, ['series', 'seriesName']);
  const publisher = firstText(item, ['publisher', 'publisherName']);
  const coverUrl = absoluteHttpsUrl(firstText(item, ['cover', 'coverUrl', 'image', 'imageUrl', 'thumbnail']));
  const productUrl = absoluteHttpsUrl(firstText(item, ['productUrl', 'goodsUrl', 'url', 'link']))
    || (itemId ? `https://www.yes24.com/Product/Goods/${encodeURIComponent(itemId)}` : '');
  if (!title || !productUrl) return null;
  return { itemId, title, author, originalTitle, language, isbn, series, publisher, coverUrl, productUrl };
}

function normalize(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/gu, ' ')
    .replace(/\s*(?:세트|특별판|한정판|개정판|중고|ebook|e-book|전자책)\s*/giu, ' ')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function normalizeWorkTitle(value: string): string {
  let normalized = normalize(value.normalize('NFKC').replace(/\s+(?:제\s*)?\d+\s*(?:권|부|화|편)?\s*$/u, ''));
  let previous = '';
  while (normalized !== previous) {
    previous = normalized;
    normalized = normalized.replace(/(?:제?\d+권|전\d+권|\d+부|\d+화|상|중|하|특장판|완전판|애장판|개정판|신장판|초판|한정판|세트|전권)$/u, '').trim();
  }
  return normalized;
}

function normalizeOriginalWorkTitle(value: string): string {
  return normalizeJapaneseTitle(value.normalize('NFKC').replace(/\s+(?:第\s*)?\d+\s*(?:巻|권)?\s*$/u, ''));
}

function containsFullKoreanWorkTitle(reference: string, value: string): boolean {
  const expected = normalizeWorkTitle(reference);
  const actual = normalizeWorkTitle(value);
  if (!/[가-힣]/u.test(reference) || expected.length < 3 || !actual.startsWith(expected)) return false;
  const suffix = actual.slice(expected.length);
  return (!suffix || /^[a-z0-9]+$/iu.test(suffix))
    && !/\b(?:guide(?:book)?|fanbook|artbook|novel)\b/iu.test(value);
}

function normalizeAuthor(value: string): string {
  const normalized = normalize(value);
  const stripped = normalized.replace(/(?:글그림|글|그림|저자|작가|지음|역자|옮김)$/gu, '');
  return stripped || normalized;
}

function titleSimilarity(left: string, right: string): number {
  const normalizedLeft = normalizeWorkTitle(left);
  const normalizedRight = normalizeWorkTitle(right);
  if (!normalizedLeft || !normalizedRight) return 0;
  if (normalizedLeft === normalizedRight) return 1;
  if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) {
    return Math.min(normalizedLeft.length, normalizedRight.length) / Math.max(normalizedLeft.length, normalizedRight.length);
  }
  const leftCharacters = [...normalizedLeft];
  const rightCharacters = [...normalizedRight];
  const previous = Array.from({ length: rightCharacters.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= leftCharacters.length; leftIndex += 1) {
    let diagonal = previous[0] ?? 0;
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= rightCharacters.length; rightIndex += 1) {
      const above = previous[rightIndex] ?? 0;
      previous[rightIndex] = leftCharacters[leftIndex - 1] === rightCharacters[rightIndex - 1]
        ? diagonal
        : 1 + Math.min(diagonal, above, previous[rightIndex - 1] ?? 0);
      diagonal = above;
    }
  }
  const distance = previous[rightCharacters.length] ?? Math.max(leftCharacters.length, rightCharacters.length);
  return 1 - distance / Math.max(leftCharacters.length, rightCharacters.length);
}

function titleMatches(candidate: Candidate, item: Yes24Item, verifiedIsbn?: string): boolean {
  const reject = (reason: string): false => {
    if (process.env.NODE_ENV !== 'production') console.info('[YES24 MATCH REJECTED]', { reason });
    return false;
  };
  if (item.isbn && detectQueryType(item.isbn) !== 'ISBN') return reject('INVALID_ISBN');
  const itemIsbn = item.isbn.replace(/[\s-]/gu, '').toUpperCase();
  if (verifiedIsbn && itemIsbn && itemIsbn !== verifiedIsbn) return reject('ISBN_CONFLICT');
  const matchesIsbn = Boolean(verifiedIsbn && itemIsbn === verifiedIsbn);
  if (/직수입|일본어판|일본판|일서|洋書|輸入|原書/u.test(`${item.title} ${item.series}`)
    || /^(?:ja|jpn|japanese|日本語)$/iu.test(item.language)
    || (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(item.title) && !/[가-힣]/u.test(item.title))) return reject('JAPANESE_IMPORT');
  const koreanTitle = candidate.koreanTitle ?? '';
  const itemTitles = [item.title, item.series].filter(Boolean);
  const bestTitleSimilarity = Math.max(...itemTitles.map((title) => titleSimilarity(koreanTitle, title)), 0);
  const matchesCompleteTitle = itemTitles.some((title) => containsFullKoreanWorkTitle(koreanTitle, title));
  const hasOriginal = Boolean(item.originalTitle.trim());
  const matchesOriginal = hasOriginal && normalizeOriginalWorkTitle(candidate.japaneseTitle) === normalizeOriginalWorkTitle(item.originalTitle);
  if (hasOriginal && !matchesOriginal) return reject('ORIGINAL_TITLE_CONFLICT');
  if (!matchesOriginal && !matchesIsbn && !matchesCompleteTitle
    && (!koreanTitle || bestTitleSimilarity < 0.7)) return reject('KOREAN_TITLE_MISMATCH');
  if (candidate.confidence !== 'HIGH' && !matchesOriginal && !matchesIsbn && !matchesCompleteTitle
    && !itemTitles.some((title) => normalizeWorkTitle(koreanTitle) === normalizeWorkTitle(title))) return reject('LOW_CONFIDENCE_TITLE_NOT_EXACT');
  const candidateAuthor = normalizeAuthor(candidate.author ?? '');
  const itemAuthor = normalizeAuthor(item.author);
  if (!candidateAuthor || !itemAuthor) return true;
  const itemAuthors = itemAuthor.split(/[,/&·]|\band\b/iu).map((author) => author.trim()).filter(Boolean);
  if (itemAuthors.some((author) => author === candidateAuthor || author.includes(candidateAuthor) || candidateAuthor.includes(author))) return true;
  const hasDifferentWritingSystem = /[가-힣]/u.test(candidateAuthor) !== /[가-힣]/u.test(itemAuthor)
    || /[ぁ-んァ-ン一-龯]/u.test(candidateAuthor) !== /[ぁ-んァ-ン一-龯]/u.test(itemAuthor);
  return hasDifferentWritingSystem || reject('AUTHOR_CONFLICT');
}

function volumeRank(title: string): number {
  const normalized = title.replace(/\s+/gu, ' ');
  if (/세트|전권|특별판|한정판|합본|박스/iu.test(normalized)) return 100;
  if (/(?:^|\s|\()1\s*(?:권|부|편|화)?(?:\D|$)/u.test(normalized)) return 0;
  if (/(?:^|\s)[2-9]\s*(?:권|부|편|화)?(?:\D|$)/u.test(normalized)) return 20;
  return 10;
}

function selectRepresentative(items: Yes24Item[]): Yes24Item | null {
  const matched = items.filter((item) => item.productUrl);
  return [...matched].sort((left, right) => volumeRank(left.title) - volumeRank(right.title))[0] ?? null;
}

function logSearch(query: string, resultCount: number): void {
  if (process.env.NODE_ENV !== 'production') console.info('[YES24 SEARCH]', { query, resultCount });
}

function usePublishedKoreanTitle(candidate: Candidate, item: Yes24Item, koreanEditionVerified: boolean): Candidate {
  if (!koreanEditionVerified || !item.originalTitle
    || normalizeOriginalWorkTitle(item.originalTitle) !== normalizeOriginalWorkTitle(candidate.japaneseTitle)) return candidate;
  const title = (item.series || item.title)
    .replace(/\s*[-–—|]\s*(?:YES24|예스24).*$/iu, '')
    .replace(/\s+(?:특별판|한정판|완전판|세트)\s*$/u, '')
    .replace(/\s+(?:제\s*|전\s*)?\d+(?:\s*[-~〜]\s*\d+)?\s*(?:권|부|편)?(?:\s*세트)?\s*$/u, '')
    .trim();
  if (!/[가-힣]/u.test(title) || /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(title)) return candidate;
  const koreanTitle = candidate.koreanTitle && containsFullKoreanWorkTitle(candidate.koreanTitle, title)
    ? candidate.koreanTitle : title;
  return { ...candidate, koreanTitle, koreanTitleStatus: 'OFFICIAL', publicationStatus: 'CONFIRMED' };
}

export async function enrichCandidateWithYes24(candidate: Candidate, searchResults: WebSearchResult[] = [], verifiedIsbn?: string): Promise<Candidate> {
  const lookupIsbn = verifiedIsbn && detectQueryType(verifiedIsbn) === 'ISBN'
    ? verifiedIsbn.replace(/[\s-]/gu, '').toUpperCase() : undefined;
  const unmatched: Yes24Enrichment = { matched: false };
  const eligibleTitleStatus = candidate.koreanTitleStatus !== 'UNKNOWN';
  if (!eligibleTitleStatus || !candidate.koreanTitle || !candidate.japaneseTitle) {
    if (process.env.NODE_ENV !== 'production') {
      console.info('[YES24 SKIP]', {
        reason: 'CALL_CONDITION_NOT_MET',
        confidence: candidate.confidence,
        koreanTitleStatus: candidate.koreanTitleStatus,
        publicationStatus: candidate.publicationStatus,
        hasKoreanTitle: Boolean(candidate.koreanTitle),
      });
    }
    return { ...candidate, yes24: unmatched };
  }
  for (const result of searchResults) {
    try {
      const sourceUrl = new URL(result.url);
      const itemId = sourceUrl.pathname.match(/^\/product\/goods\/(\d+)\/?$/iu)?.[1];
      if (sourceUrl.protocol !== 'https:' || !/^(?:www\.)?yes24\.com$/iu.test(sourceUrl.hostname)
        || sourceUrl.username || sourceUrl.password || sourceUrl.port || !itemId
        || !hasFullWorkTitle(result, candidate.japaneseTitle)) continue;
      sourceUrl.search = '';
      sourceUrl.hash = '';
      const productUrl = sourceUrl.toString();
      const item: Yes24Item = {
        itemId, title: result.title.replace(/\s*[-–—|]\s*(?:YES24|예스24).*$/iu, '').trim(),
        author: '', originalTitle: candidate.japaneseTitle, language: '', isbn: '', series: '', publisher: '', coverUrl: '', productUrl,
      };
      if (/직수입|일본어판|일본판|일서|洋書|輸入|原書/u.test(result.content) || !titleMatches(candidate, item)) continue;
      const published = usePublishedKoreanTitle(candidate, item, /한국어판|정식\s*한국판|국내\s*출판|번역\s*출간/u.test(result.content));
      if (process.env.NODE_ENV !== 'production') console.info('[YES24 REUSED SEARCH]', { reason: 'EXACT_ORIGINAL', hasProductUrl: true });
      return { ...published, yes24: { matched: true, itemId, title: item.title, productUrl } };
    } catch {
      continue;
    }
  }
  const apiKey = process.env.YES24_API_KEY?.trim();
  if (!apiKey) {
    if (process.env.NODE_ENV !== 'production') console.info('[YES24 ERROR]', { type: 'CONFIG', status: null });
    return { ...candidate, yes24: unmatched };
  }

  const url = new URL(YES24_API_URL);
  url.searchParams.set('query', lookupIsbn ?? candidate.koreanTitle);
  url.searchParams.set('category', 'BOOK');
  url.searchParams.set('page', '1');
  url.searchParams.set('pageSize', '10');
  url.searchParams.set('detail', 'Y');

  try {
    const response = await fetchWithTimeout(url, {
      method: 'GET',
      headers: { 'X-Api-Key': apiKey, accept: 'application/json' },
    }, YES24_QUERY_TIMEOUT_MS);
    const payload = await readJson(response);
    const items = response.ok ? unwrapItems(payload).map(mapItem).filter((item): item is Yes24Item => Boolean(item)) : [];
    logSearch(lookupIsbn ?? candidate.koreanTitle, items.length);
    if (process.env.NODE_ENV !== 'production') {
      console.info('[YES24 TOP RESULTS]', items.map((item) => ({
        itemId: item.itemId || undefined,
        title: item.title,
        author: item.author || undefined,
        originalTitle: item.originalTitle || undefined,
        series: item.series || undefined,
        publisher: item.publisher || undefined,
      })));
    }
    if (!response.ok) {
      if (process.env.NODE_ENV !== 'production') console.info('[YES24 ERROR]', { type: 'HTTP', status: response.status });
      return { ...candidate, yes24: unmatched };
    }
    const representative = selectRepresentative(items.filter((item) => titleMatches(candidate, item, lookupIsbn)));
    if (!representative) {
      if (process.env.NODE_ENV !== 'production') console.info('[YES24 FINAL SELECTION]', { matched: false });
      return { ...candidate, yes24: unmatched };
    }
    const enrichment: Yes24Enrichment = {
      matched: true,
      ...(representative.itemId ? { itemId: representative.itemId } : {}),
      title: representative.title,
      ...(representative.coverUrl ? { coverUrl: representative.coverUrl } : {}),
      productUrl: representative.productUrl,
      ...(representative.publisher ? { publisher: representative.publisher } : {}),
    };
    if (process.env.NODE_ENV !== 'production') {
      console.info('[YES24 FINAL SELECTION]', {
        matched: true,
        itemId: representative.itemId || undefined,
        title: representative.title,
        publisher: representative.publisher || undefined,
        hasCover: Boolean(representative.coverUrl),
        hasProductUrl: Boolean(representative.productUrl),
        matchReason: 'official Korean title and compatible author/title fields',
      });
    }
    return { ...usePublishedKoreanTitle(candidate, representative, true), yes24: enrichment };
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.info('[YES24 ERROR]', {
        type: error instanceof Error && error.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK',
        status: null,
      });
    }
    return { ...candidate, yes24: unmatched };
  }
}

// --- Publication Search on-demand lookup -----------------------------------------------
// Separate entry point for the Publication Search feature's "구매 정보 확인" button.
// Reuses the fetch/parsing helpers above instead of a second YES24 provider. Gated by
// NL_API_MODE so the Publication Search mock mode never performs a real YES24 call, even
// though YES24_API_KEY may already be configured for the image-identification pipeline.
const publicationYes24Cache = new Map<string, { expiresAt: number; value: Yes24Enrichment }>();
const PUBLICATION_YES24_CACHE_TTL_MS = 10 * 60 * 1000;

function isPublicationLiveMode(): boolean {
  return process.env.NL_API_MODE?.trim() === 'live';
}

export interface PublicationYes24LookupParams {
  isbn?: string | null;
  title: string;
  author?: string | null;
}

export async function lookupYes24ForPublication(params: PublicationYes24LookupParams): Promise<Yes24Enrichment> {
  const cacheKey = params.isbn ? `isbn:${params.isbn}` : `title:${normalize(params.title)}:${normalize(params.author ?? '')}`;
  const cached = publicationYes24Cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const cacheAndReturn = (value: Yes24Enrichment): Yes24Enrichment => {
    publicationYes24Cache.set(cacheKey, { expiresAt: Date.now() + PUBLICATION_YES24_CACHE_TTL_MS, value });
    return value;
  };

  if (!isPublicationLiveMode()) {
    if (process.env.NODE_ENV !== 'production') console.info('[YES24 PUBLICATION SKIP]', { reason: 'MOCK_MODE' });
    return cacheAndReturn({ matched: false });
  }

  const apiKey = process.env.YES24_API_KEY?.trim();
  if (!apiKey) {
    if (process.env.NODE_ENV !== 'production') console.info('[YES24 PUBLICATION ERROR]', { type: 'CONFIG' });
    return cacheAndReturn({ matched: false });
  }

  const url = new URL(YES24_API_URL);
  url.searchParams.set('query', params.isbn ?? params.title);
  url.searchParams.set('category', 'BOOK');
  url.searchParams.set('page', '1');
  url.searchParams.set('pageSize', '5');
  url.searchParams.set('detail', 'Y');

  try {
    const response = await fetchWithTimeout(url, {
      method: 'GET',
      headers: { 'X-Api-Key': apiKey, accept: 'application/json' },
    }, YES24_QUERY_TIMEOUT_MS);
    const payload = await readJson(response);
    const items = response.ok ? unwrapItems(payload).map(mapItem).filter((item): item is Yes24Item => Boolean(item)) : [];
    const representative = items[0];
    if (!representative) return cacheAndReturn({ matched: false });
    return cacheAndReturn({
      matched: true,
      ...(representative.itemId ? { itemId: representative.itemId } : {}),
      title: representative.title,
      ...(representative.coverUrl ? { coverUrl: representative.coverUrl } : {}),
      productUrl: representative.productUrl,
      ...(representative.publisher ? { publisher: representative.publisher } : {}),
    });
  } catch {
    return cacheAndReturn({ matched: false });
  }
}
