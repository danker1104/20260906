import type {
  EditionKind,
  PublicationQueryType,
  PublicationVolume,
  PublicationWork,
  VolumeStatus,
} from '../domain/publication-types';
import type { NlRawRecord } from './provider';
import { explicitCatalogMediumHint } from './catalog-signals';

function isValidIsbn10(digits: string): boolean {
  if (digits.length !== 10) return false;
  let sum = 0;
  for (let index = 0; index < 10; index += 1) {
    const char = digits[index];
    const value = char === 'X' ? 10 : Number(char);
    if (Number.isNaN(value)) return false;
    sum += (10 - index) * value;
  }
  return sum % 11 === 0;
}

function isValidIsbn13(digits: string): boolean {
  if (digits.length !== 13 || !/^\d{13}$/u.test(digits)) return false;
  let sum = 0;
  for (let index = 0; index < 13; index += 1) {
    sum += Number(digits[index]) * (index % 2 === 0 ? 1 : 3);
  }
  return sum % 10 === 0;
}

/** Detects whether a raw search query is an ISBN (10 or 13 digit, checksum-valid) or free-text title. */
export function detectQueryType(query: string): PublicationQueryType {
  const stripped = query.replace(/[\s-]/gu, '').toUpperCase();
  if (isValidIsbn10(stripped) || isValidIsbn13(stripped)) return 'ISBN';
  return 'TITLE';
}

const KOREAN_NUMERALS: Record<string, number> = {
  일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9, 십: 10,
};

/** Extracts a volume number from a title such as "작품명 3권" or "작품명 제3화". Returns null when absent/ambiguous. */
export function extractVolumeNumber(title: string): number | null {
  const plainNumber = title.trim().match(/^\d+$/u);
  if (plainNumber?.[0]) return Number(plainNumber[0]);
  const arabicMatch = title.match(/제?\s*(\d+)\s*(?:권|부|화|편)/u);
  if (arabicMatch?.[1]) return Number(arabicMatch[1]);

  const koreanMatch = title.match(/제?\s*([일이삼사오육칠팔구십]+)\s*(?:권|부|화|편)/u);
  if (koreanMatch?.[1] && KOREAN_NUMERALS[koreanMatch[1]]) return KOREAN_NUMERALS[koreanMatch[1]];

  return null;
}

export function extractVolumeLabel(title: string): string | null {
  const match = title.match(/(제?\s*\d+\s*(?:권|부|화|편)|제?\s*[일이삼사오육칠팔구십]+\s*(?:권|부|화|편))/u);
  return match?.[1]?.trim() ?? null;
}

/** Rule-based edition classification — no AI, plain keyword matching. */
export function detectEdition(title: string): EditionKind {
  if (/전자책|e-?book|ebook/iu.test(title)) return 'EBOOK';
  if (/완전판|애장판|전권|합본|박스\s*세트/u.test(title)) return 'COMPLETE';
  if (/특별판|한정판|초회판|초판한정/u.test(title)) return 'SPECIAL';
  if (/권|부|화|편/u.test(title)) return 'REGULAR';
  return 'UNKNOWN';
}

/**
 * Status precedence: a deposited copy is ground truth regardless of predate flags.
 * ISBN registration alone is never treated as a confirmed release.
 */
export function determineVolumeStatus(record: NlRawRecord, today: Date = new Date()): VolumeStatus {
  if (record.depositStatus === 'Y') return 'DEPOSITED';
  if (record.pubPredateYn === 'Y' && record.expectedPublicationDate) {
    const expected = new Date(`${record.expectedPublicationDate}T00:00:00Z`);
    if (!Number.isNaN(expected.getTime())) {
      return expected.getTime() > today.getTime() ? 'UPCOMING' : 'DATE_PASSED';
    }
  }
  if (record.isbn) return 'REGISTERED';
  return 'UNKNOWN';
}

function normalizeForGrouping(value: string): string {
  return value
    .toLocaleLowerCase('ko-KR')
    .replace(/\([^)]*\)|\[[^\]]*\]/gu, ' ')
    .replace(/제?\d+\s*(?:권|부|화|편)|제?[일이삼사오육칠팔구십]+\s*(?:권|부|화|편)/gu, ' ')
    .replace(/완전판|애장판|전권|합본|박스\s*세트|특별판|한정판|초회판|초판한정|전자책|e-?book|ebook|세트/giu, ' ')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .trim();
}

export function toPublicationVolume(record: NlRawRecord, isMock: boolean): PublicationVolume {
  const editionText = [record.title, record.editionStatement, record.form].filter(Boolean).join(' ');
  return {
    recordId: record.id,
    title: record.title,
    seriesTitle: record.seriesTitle ?? null,
    seriesNumber: record.seriesNumber ?? null,
    volumeNumber: extractVolumeNumber(record.volumeLabel ?? '') ?? extractVolumeNumber(record.title),
    volumeLabel: record.volumeLabel ?? extractVolumeLabel(record.title),
    isbn: record.isbn,
    isbnSource: record.isbnSource ?? null,
    author: record.author,
    publisher: record.publisher,
    editionStatement: record.editionStatement ?? null,
    form: record.form ?? null,
    ebookYn: record.ebookYn ?? null,
    expectedPublicationDate: record.expectedPublicationDate,
    inputDate: record.inputDate ?? null,
    updateDate: record.updateDate ?? null,
    relatedIsbn: record.relatedIsbn ?? null,
    status: determineVolumeStatus(record),
    edition: record.ebookYn === 'Y' ? 'EBOOK' : detectEdition(editionText),
    coverUrl: record.coverUrl,
    productUrl: null,
    isMock,
  };
}

/**
 * Groups volumes into works by normalized title + author. Records missing an author are
 * never guessed into a work — they are reported separately so the UI can show them as-is.
 */
export function groupVolumesIntoWorks(
  volumes: PublicationVolume[],
  sourceRecords: NlRawRecord[] = [],
): { works: PublicationWork[]; ungroupedVolumes: PublicationVolume[] } {
  const works = new Map<string, PublicationWork>();
  const ungroupedVolumes: PublicationVolume[] = [];
  const seenIsbns = new Set<string>();
  const sourceById = new Map(sourceRecords.map((record) => [record.id, record]));
  const baseKeyByVolumeId = new Map<string, string>();
  const explicitMediumsByBaseKey = new Map<string, Set<string>>();

  for (const volume of volumes) {
    if (!volume.author) continue;
    const title = normalizeForGrouping(volume.seriesTitle ?? volume.title);
    if (!title) continue;
    const baseKey = `${title}::${normalizeForGrouping(volume.author)}::${normalizeForGrouping(volume.publisher ?? '')}`;
    baseKeyByVolumeId.set(volume.recordId, baseKey);
    const sourceRecord = sourceById.get(volume.recordId);
    const mediumHint = sourceRecord ? explicitCatalogMediumHint(sourceRecord) : null;
    if (!mediumHint) continue;
    const mediums = explicitMediumsByBaseKey.get(baseKey) ?? new Set<string>();
    mediums.add(mediumHint);
    explicitMediumsByBaseKey.set(baseKey, mediums);
  }

  for (const volume of volumes) {
    if (volume.isbn && volume.isbnSource !== 'SET_ISBN') {
      const dedupeIsbn = volume.isbn.replace(/[^0-9Xx]/gu, '').toUpperCase();
      if (seenIsbns.has(dedupeIsbn)) continue;
      seenIsbns.add(dedupeIsbn);
    }

    const normalizedTitle = normalizeForGrouping(volume.seriesTitle ?? volume.title);
    if (!normalizedTitle || !volume.author) {
      ungroupedVolumes.push(volume);
      continue;
    }

    const baseKey = baseKeyByVolumeId.get(volume.recordId)
      ?? `${normalizedTitle}::${normalizeForGrouping(volume.author)}::${normalizeForGrouping(volume.publisher ?? '')}`;
    const sourceRecord = sourceById.get(volume.recordId);
    const explicitMedium = sourceRecord ? explicitCatalogMediumHint(sourceRecord) : null;
    const pageMediums = explicitMediumsByBaseKey.get(baseKey);
    const inferredForPage = !explicitMedium && pageMediums?.size === 1 ? [...pageMediums][0] : null;
    const mediumDiscriminator = explicitMedium ?? inferredForPage ?? (pageMediums && pageMediums.size > 1 ? 'UNCLASSIFIED' : '');
    const workKey = `${baseKey}::${mediumDiscriminator}`;
    const existing = works.get(workKey);
    if (existing) {
      existing.volumes.push(volume);
      continue;
    }
    works.set(workKey, {
      workKey,
      title: volume.seriesTitle ?? (volume.title.replace(/\s*(제?\d+\s*(?:권|부|화|편)|제?[일이삼사오육칠팔구십]+\s*(?:권|부|화|편)).*$/u, '').trim() || volume.title),
      author: volume.author,
      publisher: volume.publisher,
      volumes: [volume],
    });
  }

  return { works: [...works.values()], ungroupedVolumes };
}
