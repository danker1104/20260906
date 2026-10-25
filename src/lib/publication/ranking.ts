import type {
  MangaClassification,
  PublicationQueryType,
  PublicationRelevanceBand,
  PublicationWork,
} from '../domain/publication-types';
import type { NlRawRecord } from './provider';
import {
  hasMangaMarker,
  hasMangaReferenceTitle,
  isExplicitMangaSubject,
  isExplicitNonMangaSubject,
} from './catalog-signals';

export type MangaClassificationReason =
  | 'SUBJECT_MANGA'
  | 'TITLE_MANGA_MARKER'
  | 'DESCRIPTION_MANGA_MARKER'
  | 'SUBJECT_NON_MANGA'
  | 'REFERENCE_MATERIAL'
  | 'SERIES_VOLUME_STRUCTURE'
  | 'CONFLICTING_MEDIA_EVIDENCE'
  | 'NO_CLASSIFYING_EVIDENCE';

export type PublicationResultGroup = 'PRIMARY' | 'ADDITIONAL';
export type AdditionalResultReason = 'LOW_TITLE_RELEVANCE' | 'NON_MANGA_EVIDENCE' | 'TITLE_RELEVANCE_UNKNOWN' | 'WORK_GROUP_UNCERTAIN';

export interface RankedPublicationWork extends PublicationWork {
  mangaClassification: MangaClassification;
  relevanceBand: PublicationRelevanceBand;
  titleRelevanceScore: number;
  mangaEvidenceScore: number;
  classificationReasons: MangaClassificationReason[];
  resultGroup: PublicationResultGroup;
  additionalReason: AdditionalResultReason | null;
}

const MANGA_SCORE_THRESHOLD = 50;

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('ko-KR')
    .replace(/[\u200B-\u200D\uFEFF]/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ');
}

export function normalizePublicationTitle(value: string): string {
  return normalizeSearchText(value);
}

function titleMatchScore(query: string, title: string, isSeriesTitle: boolean): number {
  const queryText = normalizeSearchText(query);
  const titleText = normalizeSearchText(title);
  const queryCompact = queryText.replace(/\s+/gu, '');
  const titleCompact = titleText.replace(/\s+/gu, '');
  if (!queryCompact || !titleCompact) return 0;
  if (queryCompact === titleCompact) return isSeriesTitle ? 130 : 115;

  const shortQuery = queryCompact.length <= 2;
  if (titleCompact.startsWith(queryCompact)) return shortQuery ? 42 : 84;
  if (titleCompact.includes(queryCompact)) return shortQuery ? 22 : 66;

  const queryTokens = queryText.split(' ').filter(Boolean);
  const titleTokens = titleText.split(' ').filter(Boolean);
  if (queryTokens.length > 1 && queryTokens.every((token) => titleTokens.some((titleToken) => titleToken.includes(token)))) {
    return shortQuery ? 24 : 58;
  }
  return 0;
}

function recordTitleScore(query: string, record: NlRawRecord): number {
  const names: Array<{ value: string; isSeries: boolean }> = [
    { value: record.title, isSeries: false },
    ...(record.seriesTitle ? [{ value: record.seriesTitle, isSeries: true }] : []),
  ];
  const withVolume = [record.title, record.volumeLabel].filter(Boolean).join(' ');
  if (withVolume !== record.title) names.push({ value: withVolume, isSeries: false });
  return Math.max(0, ...names.map(({ value, isSeries }) => titleMatchScore(query, value, isSeries)));
}

function normalizeIsbn(value: string): string {
  return value.replace(/[\s-]/gu, '').toUpperCase();
}

function mangaClassification(
  work: PublicationWork,
  records: NlRawRecord[],
): { classification: MangaClassification; evidenceScore: number; reasons: MangaClassificationReason[] } {
  const reasons = new Set<MangaClassificationReason>();
  const subjects = records.map((record) => record.subject ?? '').filter(Boolean);
  const titles = records.flatMap((record) => [record.title, record.seriesTitle ?? '']).filter(Boolean);
  const descriptions = records.flatMap((record) => [record.bookIntroduction ?? '', record.bookSummary ?? '']).filter(Boolean);
  const subjectHasManga = subjects.some(isExplicitMangaSubject);
  const titleHasManga = titles.some(hasMangaMarker);
  const descriptionHasManga = descriptions.some(hasMangaMarker);
  const subjectHasNonManga = subjects.some(isExplicitNonMangaSubject);
  const hasReferenceMaterial = [...subjects, ...titles].some(hasMangaReferenceTitle);
  const hasUnambiguousMangaSubject = records.some((record) => (
    isExplicitMangaSubject(record.subject)
    && !isExplicitNonMangaSubject(record.subject)
    && !hasMangaReferenceTitle(record.subject ?? '')
  ));
  const hasVolumeStructure = work.volumes.some((volume) => volume.volumeNumber !== null || Boolean(volume.volumeLabel))
    || records.some((record) => Boolean(record.volumeLabel || record.seriesNumber));

  const mangaEvidenceScore = Math.max(-100, Math.min(100,
    (subjectHasManga ? 70 : 0)
    + (titleHasManga ? 45 : 0)
    + (descriptionHasManga ? 35 : 0)
    + (subjectHasNonManga ? -70 : 0)
    + (hasReferenceMaterial ? -90 : 0)
    + (hasVolumeStructure ? 5 : 0),
  ));

  if (subjectHasManga) reasons.add('SUBJECT_MANGA');
  if (titleHasManga) reasons.add('TITLE_MANGA_MARKER');
  if (descriptionHasManga) reasons.add('DESCRIPTION_MANGA_MARKER');
  if (subjectHasNonManga) reasons.add('SUBJECT_NON_MANGA');
  if (hasReferenceMaterial) reasons.add('REFERENCE_MATERIAL');
  if (hasVolumeStructure) reasons.add('SERIES_VOLUME_STRUCTURE');

  let classification: MangaClassification;
  const conflictingCatalogEvidence = (hasUnambiguousMangaSubject && (subjectHasNonManga || hasReferenceMaterial))
    || (descriptionHasManga && subjectHasNonManga);
  if (conflictingCatalogEvidence) {
    classification = 'UNCERTAIN';
    reasons.add('CONFLICTING_MEDIA_EVIDENCE');
  } else if (hasUnambiguousMangaSubject) {
    classification = 'MANGA_LIKELY';
  } else if (subjectHasNonManga || hasReferenceMaterial) {
    classification = 'NON_MANGA_LIKELY';
  } else if (mangaEvidenceScore >= 45) {
    classification = 'MANGA_LIKELY';
  } else if (mangaEvidenceScore <= -50) {
    classification = 'NON_MANGA_LIKELY';
  } else {
    classification = 'UNCERTAIN';
    reasons.add('NO_CLASSIFYING_EVIDENCE');
  }

  return { classification, evidenceScore: mangaEvidenceScore, reasons: [...reasons] };
}

export function diagnoseUngroupedPublicationRecord(
  query: string,
  queryType: PublicationQueryType,
  record: NlRawRecord,
): Pick<RankedPublicationWork, 'titleRelevanceScore' | 'mangaEvidenceScore' | 'mangaClassification' | 'classificationReasons'> & { normalizedTitle: string } {
  const work: PublicationWork = {
    workKey: record.id,
    title: record.seriesTitle ?? record.title,
    author: record.author,
    publisher: record.publisher,
    volumes: [],
  };
  const classification = mangaClassification(work, [record]);
  return {
    normalizedTitle: normalizePublicationTitle(work.title),
    titleRelevanceScore: queryType === 'ISBN'
      ? (record.isbn && normalizeIsbn(record.isbn) === normalizeIsbn(query) ? 150 : 0)
      : recordTitleScore(query, record),
    mangaEvidenceScore: classification.evidenceScore,
    mangaClassification: classification.classification,
    classificationReasons: classification.reasons,
  };
}

function classifyRelevance(score: number): PublicationRelevanceBand {
  return score >= MANGA_SCORE_THRESHOLD ? 'HIGH' : 'LOW';
}

function sortBucket(work: RankedPublicationWork): number {
  if (work.resultGroup === 'PRIMARY' && work.mangaClassification === 'MANGA_LIKELY') return 0;
  if (work.resultGroup === 'PRIMARY') return 1;
  return 2;
}

/** Scores only records in the current provider page; no additional page is requested or inferred. */
export function rankAndClassifyPublicationWorks(
  query: string,
  queryType: PublicationQueryType,
  works: PublicationWork[],
  pageRecords: NlRawRecord[],
): RankedPublicationWork[] {
  const recordsById = new Map(pageRecords.map((record) => [record.id, record]));
  const queryIsbn = normalizeIsbn(query);
  const ranked = works.map((work): RankedPublicationWork => {
    const records = work.volumes
      .map((volume) => recordsById.get(volume.recordId))
      .filter((record): record is NlRawRecord => Boolean(record));
    const titleRelevanceScore = queryType === 'ISBN'
      ? Math.max(0, ...records.map((record) => record.isbn && normalizeIsbn(record.isbn) === queryIsbn ? 150 : 0))
      : Math.max(0, ...records.map((record) => recordTitleScore(query, record)));
    const classification = mangaClassification(work, records);
    const relevanceBand = classifyRelevance(titleRelevanceScore);
    const isClearlyNonManga = classification.classification === 'NON_MANGA_LIKELY';
    const resultGroup: PublicationResultGroup = relevanceBand === 'HIGH' && !isClearlyNonManga ? 'PRIMARY' : 'ADDITIONAL';
    const additionalReason: AdditionalResultReason | null = resultGroup === 'PRIMARY'
      ? null
      : isClearlyNonManga
        ? 'NON_MANGA_EVIDENCE'
        : titleRelevanceScore === 0
          ? 'TITLE_RELEVANCE_UNKNOWN'
          : 'LOW_TITLE_RELEVANCE';
    return {
      ...work,
      mangaClassification: classification.classification,
      relevanceBand,
      titleRelevanceScore,
      mangaEvidenceScore: classification.evidenceScore,
      classificationReasons: classification.reasons,
      resultGroup,
      additionalReason,
    };
  });

  return ranked.sort((left, right) => (
    sortBucket(left) - sortBucket(right)
    || right.titleRelevanceScore - left.titleRelevanceScore
    || right.mangaEvidenceScore - left.mangaEvidenceScore
    || left.title.localeCompare(right.title, 'ko-KR')
  ));
}
