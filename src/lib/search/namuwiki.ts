import type { Candidate } from '../domain/types';
import { canonicalNamuWikiUrl } from '../validation/namuwiki';
import type { WebSearchResult } from './types';
import { normalizeJapaneseTitle } from './lens-candidates';

function normalizeTitle(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, '').toLocaleLowerCase();
}

export function getNamuWikiWorkIdentity(result: WebSearchResult, japaneseTitle: string): { url: string; koreanTitle: string | null } | null {
  const url = canonicalNamuWikiUrl(result.url);
  if (!url) return null;
  const documentTitle = decodeURIComponent(new URL(url).pathname.slice(3));
  const suffix = documentTitle.match(/\(([^)]+)\)$/u)?.[1];
  if (suffix && !/^(?:만화|일본만화|일본의만화)$/u.test(suffix.replace(/\s+/gu, ''))) return null;
  let workTitle = documentTitle.replace(/\((?:만화|일본\s*만화|일본의\s*만화)\)$/u, '').trim();
  const resultHeader = result.title.replace(/\s*[-–—|]\s*나무위키\s*$/u, '').trim();
  const resultTitle = normalizeTitle(resultHeader);
  if (resultTitle !== normalizeTitle(documentTitle) && resultTitle !== normalizeTitle(workTitle)) {
    const headerSuffix = resultHeader.match(/\(([^)]+)\)$/u)?.[1];
    if (!/넘겨주기|리다이렉트|\bredirect\b/iu.test(result.content) || !/[가-힣]/u.test(resultHeader)
      || /[:/\\?#]/u.test(resultHeader)
      || (headerSuffix && !/^(?:만화|일본만화|일본의만화)$/u.test(headerSuffix.replace(/\s+/gu, '')))) return null;
    workTitle = resultHeader.replace(/\((?:만화|일본\s*만화|일본의\s*만화)\)$/u, '').trim();
  }
  const normalizedOriginal = normalizeJapaneseTitle(japaneseTitle);
  const japaneseSegments = result.content.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}][\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々・\d \t「」『』!?！？。、]*/gu) ?? [];
  const quotedTitles = [...result.content.matchAll(/[『「【《"“]([^』」】》"”\r\n]{1,200})[』」】》"”]/gu)].map((match) => match[1]);
  const latinTitles = result.content.match(/[A-Za-z0-9][A-Za-z0-9 .×&:/+;!?_-]*/gu) ?? [];
  if (!normalizedOriginal || ![...japaneseSegments, ...quotedTitles, ...latinTitles]
    .some((segment) => normalizeJapaneseTitle(segment) === normalizedOriginal)) return null;
  return { url, koreanTitle: /[가-힣]/u.test(workTitle) ? workTitle : null };
}

export function enrichCandidatesWithNamuWiki(candidates: Candidate[], results: WebSearchResult[]): Candidate[] {
  return candidates.map(({ namuWikiUrl: _unverifiedUrl, ...candidate }) => {
    const japaneseTitle = normalizeTitle(candidate.japaneseTitle);
    const koreanTitle = candidate.koreanTitleStatus === 'OFFICIAL' || candidate.koreanTitleStatus === 'COMMON'
      ? normalizeTitle(candidate.koreanTitle ?? '')
      : '';

    for (const result of results) {
      const identity = getNamuWikiWorkIdentity(result, candidate.japaneseTitle);
      if (identity) return { ...candidate, namuWikiUrl: identity.url };
      const url = canonicalNamuWikiUrl(result.url);
      if (!url) continue;
      const documentTitle = normalizeTitle(decodeURIComponent(new URL(url).pathname.slice(3)));
      const workTitle = documentTitle.replace(/\((?:만화|일본만화|일본의만화)\)$/u, '');
      const resultTitle = normalizeTitle(result.title.replace(/\s*[-–—|]\s*나무위키\s*$/u, ''));
      if (resultTitle !== documentTitle && resultTitle !== workTitle) continue;
      const matchesJapanese = Boolean(japaneseTitle && workTitle === japaneseTitle);
      const matchesKorean = Boolean(koreanTitle && workTitle === koreanTitle);
      if (!matchesJapanese && !matchesKorean) continue;
      const content = normalizeTitle(`${result.title} ${result.content}`);
      const hasJapaneseIdentity = Boolean(japaneseTitle && content.includes(japaneseTitle));
      const hasMangaSignal = /만화|漫画|manga/iu.test(content);
      if (!hasJapaneseIdentity && !hasMangaSignal) continue;
      return { ...candidate, namuWikiUrl: url };
    }
    return candidate;
  });
}