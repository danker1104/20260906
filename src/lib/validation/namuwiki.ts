import { z } from 'zod';

export function canonicalNamuWikiUrl(value: string): string | undefined {
  try {
    if (value.length > 2048 || /[\u0000-\u0020\u007f\\]/u.test(value)) return undefined;
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'namu.wiki' || url.port || url.username || url.password) return undefined;
    if (!url.pathname.startsWith('/w/')) return undefined;
    const title = decodeURIComponent(url.pathname.slice(3));
    if (!title.trim() || /[/\\?#\u0000-\u001f\u007f]/u.test(title)) return undefined;
    if (/^(?:파일|틀|분류|나무위키|사용자|토론|특수|휴지통|위키운영):/u.test(title)) return undefined;
    return `https://namu.wiki/w/${encodeURIComponent(title)}`;
  } catch {
    return undefined;
  }
}

export const namuWikiUrlSchema = z.string().refine(
  (value) => canonicalNamuWikiUrl(value) === value,
  'Expected a canonical HTTPS NamuWiki document URL',
);