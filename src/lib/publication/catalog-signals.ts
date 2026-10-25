import type { NlRawRecord } from './provider';

export type CatalogMediumHint = 'MANGA' | 'NON_MANGA';

const MANGA_TERMS = /만화|코믹(?:스)?|manga|comics?|graphic\s+novel|漫画|マンガ|コミック/iu;
const NON_MANGA_SUBJECT_TERMS = /소설|문학|학습서|수험서|교재|교과서|에세이|수필|해설서|연구서|小説|文学|学習書|参考書|教科書|解説/iu;
const REFERENCE_TERMS = /공식\s*가이드|팬북|해설서|연구서|독본|교본|교재|학습서|수험서|그리는\s*법|작법|분석서|ガイドブック|解説書|研究書/iu;

export function explicitCatalogMediumHint(record: NlRawRecord): CatalogMediumHint | null {
  const subject = record.subject ?? '';
  const titleText = [record.title, record.seriesTitle ?? ''].join(' ');
  const description = [record.bookIntroduction ?? '', record.bookSummary ?? ''].join(' ');
  const hasReferenceSignal = REFERENCE_TERMS.test(`${subject} ${titleText}`);

  if (hasReferenceSignal || NON_MANGA_SUBJECT_TERMS.test(subject)) return 'NON_MANGA';
  if (MANGA_TERMS.test(subject) || MANGA_TERMS.test(titleText) || MANGA_TERMS.test(description)) return 'MANGA';
  return null;
}

export function isExplicitMangaSubject(value: string | null | undefined): boolean {
  return Boolean(value && MANGA_TERMS.test(value));
}

export function hasMangaMarker(value: string | null | undefined): boolean {
  return Boolean(value && MANGA_TERMS.test(value));
}

export function isExplicitNonMangaSubject(value: string | null | undefined): boolean {
  return Boolean(value && NON_MANGA_SUBJECT_TERMS.test(value));
}

export function hasMangaReferenceTitle(value: string): boolean {
  return REFERENCE_TERMS.test(value);
}
