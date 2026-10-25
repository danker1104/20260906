import { normalizeJapaneseTitle } from './lens-candidates';
import type { WebSearchResult } from './types';

function searchWorkTitle(result: Pick<WebSearchResult, 'title'>): string {
  return result.title
    .replace(/\s*[|｜].*$/u, '')
    .replace(/\s*(?:第?\s*\d+\s*(?:巻|話)|公式.*|漫画|マンガ|コミック|試し読み|作品情報|連載ページ).*$/u, '')
    .trim();
}

export function hasFullWorkTitle(result: Pick<WebSearchResult, 'title' | 'content'>, title: string): boolean {
  const normalized = normalizeJapaneseTitle(title);
  if (normalized.length < 3) return false;
  const pageTitle = searchWorkTitle(result);
  if (normalizeJapaneseTitle(pageTitle) === normalized) return true;
  return [...`${result.title}\n${result.content}`.matchAll(/[『「【《]([^』」】》]+)[』」】》]/gu)]
    .some((match) => normalizeJapaneseTitle(match[1]) === normalized);
}

export function ocrTitleSimilarity(ocrTitle: string, officialTitle: string): number {
  const left = [...normalizeJapaneseTitle(ocrTitle)].slice(0, 80);
  const fullRight = [...normalizeJapaneseTitle(officialTitle)].slice(0, 80);
  if (left.length < 4 || fullRight.length < 4) return 0;
  const right = fullRight.slice(0, Math.max(left.length, 4));
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const above = previous[column];
      previous[column] = Math.min(above + 1, previous[column - 1] + 1, diagonal + Number(left[row - 1] !== right[column - 1]));
      diagonal = above;
    }
  }
  return 1 - previous[right.length] / Math.max(left.length, right.length);
}

export function findVerifiedOcrCorrections(ocrTitles: string[], results: WebSearchResult[]): string[] {
  const titles = [...new Set(results.map(searchWorkTitle))];
  const verified = verifiedOcrWorkTitles(titles, results)
    .filter((title) => ocrTitles.some((ocrTitle) => ocrTitleSimilarity(ocrTitle, title) >= 0.8));
  const distinct = [...new Map(verified.map((title) => [normalizeJapaneseTitle(title), title])).values()];
  return distinct.length === 1 ? distinct : [];
}

function sourceDomain(url: string): string {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./u, ''); } catch { return ''; }
}

export function isJapaneseWorkSource(result: Pick<WebSearchResult, 'url'>): boolean {
  const domain = sourceDomain(result.url);
  return Boolean(domain) && !/(?:^|\.)(?:yes24\.com|nl\.go\.kr|aladin\.co\.kr|kyobobook\.co\.kr)$/u.test(domain);
}

export function verifiedOcrWorkTitles(titles: string[], results: WebSearchResult[]): string[] {
  const officialDomain = /(?:^|\.)(?:hakusensha\.co\.jp|shueisha\.co\.jp|shogakukan\.co\.jp|kodansha\.co\.jp|kadokawa\.co\.jp|younganimal\.com|comic-days\.com|shonenjump\.com|sunday-webry\.com|comic-walker\.com|magapoke\.jp|magazinepocket\.com)$/u;
  return titles.filter((title) => {
    const evidence = results.filter((result) => isJapaneseWorkSource(result)
      && hasFullWorkTitle(result, title)
      && /漫画|マンガ|コミック|manga|comic|連載/iu.test(`${result.title} ${result.content}`));
    return evidence.some((result) => officialDomain.test(sourceDomain(result.url)))
      || new Set(evidence.filter((result) => /連載|出版社|著者|作者|原作|単行本|serialization|publisher/iu.test(`${result.title} ${result.content}`))
        .map((result) => {
          const domain = sourceDomain(result.url);
          const labels = domain.split('.');
          return labels.slice(/\.(?:co|ne|or|ac)\.(?:jp|kr)$/u.test(domain) ? -3 : -2).join('.');
        })).size >= 2;
  });
}