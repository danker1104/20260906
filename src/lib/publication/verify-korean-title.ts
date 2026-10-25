import type { Candidate } from '../domain/types';
import { detectQueryType } from './normalize';
import type { NationalLibraryProvider, NlRawRecord } from './provider';
import { getNationalLibraryProvider } from './provider-factory';
import { diagnoseUngroupedPublicationRecord } from './ranking';
import { findMatchingKoreanTitle } from '../search/korean-title';

interface TitleVerificationOptions {
  provider?: NationalLibraryProvider;
  timeoutMs?: number;
  allowNameCorrection?: boolean;
}

export interface KoreanTitleVerification {
  candidate: Candidate;
  isbn?: string;
}

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
}

function authorMatches(author: string | null, record: NlRawRecord): boolean {
  if (!author || !record.author) return true;
  const differentScript = /[가-힣]/u.test(author) !== /[가-힣]/u.test(record.author)
    || /[ぁ-んァ-ン一-龯]/u.test(author) !== /[ぁ-んァ-ン一-龯]/u.test(record.author);
  if (differentScript) return true;
  return record.author.split(/[,/&·;]/u).some((name) => (
    normalize(name.replace(/\s+(?:글|그림|지음|저자|옮김)\s*$/u, '')) === normalize(author)
  ));
}

function catalogWorkTitle(record: NlRawRecord): string {
  return record.seriesTitle?.trim() || record.title
    .replace(/\s*(?:제\s*)?\d+\s*(?:권|부|화|편)\s*$/u, '')
    .replace(/\s+\d+\s*$/u, '').trim();
}

function eligibleBook(candidate: Candidate, record: NlRawRecord): boolean {
  if (!record.isbn || detectQueryType(record.isbn) !== 'ISBN' || !record.publisher?.trim()) return false;
  if (/직수입|일본어판|일서|原書/u.test(`${record.title} ${record.form ?? ''}`)) return false;
  return authorMatches(candidate.author, record)
    && diagnoseUngroupedPublicationRecord(candidate.koreanTitle ?? '', 'TITLE', record).mangaClassification === 'MANGA_LIKELY';
}

export async function verifyKoreanTitleWithIsbn(
  candidate: Candidate,
  options: TitleVerificationOptions = {},
): Promise<KoreanTitleVerification> {
  const unchanged = { candidate };
  const timeoutMs = Math.min(4_000, options.timeoutMs ?? 4_000);
  if (!candidate.koreanTitle || !/[가-힣]/u.test(candidate.koreanTitle) || timeoutMs <= 0) return unchanged;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const provider = options.provider ?? getNationalLibraryProvider();
    if (provider.mode !== 'live') return unchanged;
    const result = await Promise.race([
      provider.search({ query: candidate.koreanTitle, queryType: 'TITLE', page: 1, pageSize: 10 }, controller.signal),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('Catalog verification timeout'));
        }, timeoutMs);
      }),
    ]);
    const eligible = result.records.filter((record) => eligibleBook(candidate, record));
    const names = eligible.map(catalogWorkTitle).filter((title) => /[가-힣]/u.test(title));
    const selectedTitle = options.allowNameCorrection === false
      ? names.find((title) => normalize(title) === normalize(candidate.koreanTitle ?? ''))
      : findMatchingKoreanTitle(candidate.koreanTitle, names);
    if (!selectedTitle) return unchanged;
    const matches = eligible.filter((record) => normalize(catalogWorkTitle(record)) === normalize(selectedTitle));
    const identities = new Set(matches.map((record) => JSON.stringify([normalize(record.author ?? ''), normalize(record.publisher ?? '')])));
    if (!matches.length || identities.size !== 1) return unchanged;
    const isbn = matches[0].isbn!.replace(/[\s-]/gu, '').toUpperCase();
    return {
      isbn,
      candidate: {
        ...candidate,
        koreanTitle: options.allowNameCorrection === false ? candidate.koreanTitle : selectedTitle,
        koreanTitleStatus: 'OFFICIAL',
        koreanInvestigationStatus: 'SUCCESS',
        evidence: [...new Set<Candidate['evidence'][number]>(['PUBLISHER_MATCH', ...candidate.evidence])].slice(0, 5),
      },
    };
  } catch {
    return unchanged;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}