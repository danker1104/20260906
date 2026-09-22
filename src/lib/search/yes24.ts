import type { Candidate, Yes24Enrichment } from '../domain/types';
import { fetchWithTimeout, readJson } from './provider-utils';

const YES24_API_URL = 'https://apis.yes24.com/v1/goods/itemList';
const YES24_QUERY_TIMEOUT_MS = 8_000;

interface Yes24Item {
  itemId: string;
  title: string;
  author: string;
  originalTitle: string;
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
  const series = firstText(item, ['series', 'seriesName']);
  const publisher = firstText(item, ['publisher', 'publisherName']);
  const coverUrl = absoluteHttpsUrl(firstText(item, ['cover', 'coverUrl', 'image', 'imageUrl', 'thumbnail']));
  const productUrl = absoluteHttpsUrl(firstText(item, ['productUrl', 'goodsUrl', 'url', 'link']))
    || (itemId ? `https://www.yes24.com/Product/Goods/${encodeURIComponent(itemId)}` : '');
  if (!title || !productUrl) return null;
  return { itemId, title, author, originalTitle, series, publisher, coverUrl, productUrl };
}

function normalize(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/gu, ' ')
    .replace(/\s*(?:세트|특별판|한정판|개정판|중고|ebook|e-book|전자책)\s*/giu, ' ')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function normalizeWorkTitle(value: string): string {
  let normalized = normalize(value);
  let previous = '';
  while (normalized !== previous) {
    previous = normalized;
    normalized = normalized.replace(/(?:제?\d+권|전\d+권|\d+부|\d+화|상|중|하|특장판|완전판|애장판|개정판|신장판|초판|한정판|세트|전권)$/u, '').trim();
  }
  return normalized;
}

function normalizeAuthor(value: string): string {
  const normalized = normalize(value);
  const stripped = normalized.replace(/(?:글그림|글|그림|저자|작가|지음|역자|옮김)/gu, '');
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

function titleMatches(candidate: Candidate, item: Yes24Item): boolean {
  const koreanTitle = candidate.koreanTitle ?? '';
  const itemTitles = [item.title, item.series, item.originalTitle].filter(Boolean);
  const bestTitleSimilarity = Math.max(...itemTitles.map((title) => titleSimilarity(koreanTitle, title)), 0);
  if (!koreanTitle || bestTitleSimilarity < 0.7) return false;
  const candidateAuthor = normalizeAuthor(candidate.author ?? '');
  const itemAuthor = normalizeAuthor(item.author);
  if (!candidateAuthor || !itemAuthor) return true;
  const itemAuthors = itemAuthor.split(/[,/&·]|\band\b/iu).map((author) => author.trim()).filter(Boolean);
  if (itemAuthors.some((author) => author === candidateAuthor || author.includes(candidateAuthor) || candidateAuthor.includes(author))) return true;
  const hasDifferentWritingSystem = /[가-힣]/u.test(candidateAuthor) !== /[가-힣]/u.test(itemAuthor)
    || /[ぁ-んァ-ン一-龯]/u.test(candidateAuthor) !== /[ぁ-んァ-ン一-龯]/u.test(itemAuthor);
  return hasDifferentWritingSystem;
}

function volumeRank(title: string): number {
  const normalized = title.replace(/\s+/gu, ' ');
  if (/세트|전권|특별판|한정판|합본|박스/iu.test(normalized)) return 100;
  if (/(?:^|\s|\()1\s*(?:권|부|편|화)?(?:\D|$)/u.test(normalized)) return 0;
  if (/(?:^|\s)[2-9]\s*(?:권|부|편|화)?(?:\D|$)/u.test(normalized)) return 20;
  return 10;
}

function selectRepresentative(items: Yes24Item[]): Yes24Item | null {
  const matched = items.filter((item) => item.coverUrl && item.productUrl);
  return [...matched].sort((left, right) => volumeRank(left.title) - volumeRank(right.title))[0] ?? null;
}

function logSearch(query: string, resultCount: number): void {
  if (process.env.NODE_ENV !== 'production') console.info('[YES24 SEARCH]', { query, resultCount });
}

export async function enrichCandidateWithYes24(candidate: Candidate): Promise<Candidate> {
  const unmatched: Yes24Enrichment = { matched: false };
  const eligibleTitleStatus = candidate.koreanTitleStatus === 'OFFICIAL' || candidate.koreanTitleStatus === 'COMMON';
  if (!eligibleTitleStatus || !candidate.koreanTitle) {
    if (process.env.NODE_ENV !== 'production') {
      console.info('[YES24 SKIP]', {
        reason: 'CALL_CONDITION_NOT_MET',
        koreanTitleStatus: candidate.koreanTitleStatus,
        publicationStatus: candidate.publicationStatus,
        hasKoreanTitle: Boolean(candidate.koreanTitle),
      });
    }
    return { ...candidate, yes24: unmatched };
  }
  const apiKey = process.env.YES24_API_KEY?.trim();
  if (!apiKey) {
    if (process.env.NODE_ENV !== 'production') console.info('[YES24 ERROR]', { type: 'CONFIG', status: null });
    return { ...candidate, yes24: unmatched };
  }

  const url = new URL(YES24_API_URL);
  url.searchParams.set('query', candidate.koreanTitle);
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
    logSearch(candidate.koreanTitle, items.length);
    if (process.env.NODE_ENV !== 'production') {
      console.info('[YES24 CANDIDATES]', items.map((item) => ({
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
    const representative = selectRepresentative(items.filter((item) => titleMatches(candidate, item)));
    if (!representative) {
      if (process.env.NODE_ENV !== 'production') console.info('[YES24 MATCH]', { matched: false });
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
      console.info('[YES24 MATCH]', {
        matched: true,
        itemId: representative.itemId || undefined,
        title: representative.title,
        publisher: representative.publisher || undefined,
        hasCover: Boolean(representative.coverUrl),
        hasProductUrl: Boolean(representative.productUrl),
        matchReason: 'official Korean title and compatible author/title fields',
      });
    }
    return { ...candidate, yes24: enrichment };
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
