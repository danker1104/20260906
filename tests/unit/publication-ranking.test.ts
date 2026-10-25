import { describe, expect, it } from 'vitest';
import { rankAndClassifyPublicationWorks } from '../../src/lib/publication/ranking';
import { groupVolumesIntoWorks, toPublicationVolume } from '../../src/lib/publication/normalize';
import type { PublicationQueryType } from '../../src/lib/domain/publication-types';
import type { NlRawRecord } from '../../src/lib/publication/provider';

let recordSequence = 0;

function rawRecord(overrides: Partial<NlRawRecord>): NlRawRecord {
  recordSequence += 1;
  return {
    id: `record-${recordSequence}`,
    title: '푸른 궤적 1권',
    volumeLabel: '1권',
    seriesTitle: '푸른 궤적',
    isbn: `9780000000${String(recordSequence).padStart(3, '0')}`,
    author: '가상 작가',
    publisher: '가상 출판사',
    pubPredateYn: 'N',
    expectedPublicationDate: null,
    depositStatus: 'Y',
    coverUrl: null,
    subject: null,
    isbnAdditionalCode: null,
    bookIntroduction: null,
    bookSummary: null,
    ...overrides,
  };
}

function rank(records: NlRawRecord[], query: string, queryType: PublicationQueryType = 'TITLE') {
  const volumes = records.map((record) => toPublicationVolume(record, true));
  const { works } = groupVolumesIntoWorks(volumes, records);
  return rankAndClassifyPublicationWorks(query, queryType, works, records);
}

describe('publication title relevance and manga classification', () => {
  it('places an exact manga title before unrelated title-substring results', () => {
    const records = [
      rawRecord({ id: 'novel', title: '푸른 궤적을 읽는 법', seriesTitle: null, subject: '소설' }),
      rawRecord({ id: 'manga', title: '푸른 궤적 1권', subject: '만화' }),
    ];
    const results = rank(records, '푸른 궤적');

    expect(results[0]?.mangaClassification).toBe('MANGA_LIKELY');
    expect(results[0]?.workKey).toContain('가상작가');
    expect(results[0]?.relevanceBand).toBe('HIGH');
    expect(results.at(-1)?.mangaClassification).toBe('NON_MANGA_LIKELY');
  });

  it('matches partial title and series title queries', () => {
    const results = rank([rawRecord({ subject: '만화' })], '푸른 궤');
    expect(results[0]?.relevanceBand).toBe('HIGH');
  });

  it('keeps an exact title with missing manga metadata in the primary group', () => {
    const results = rank([rawRecord({ title: '달과 바다', seriesTitle: null, volumeLabel: null, subject: null, isbnAdditionalCode: null, bookIntroduction: null })], '달과 바다');
    expect(results[0]?.mangaClassification).toBe('UNCERTAIN');
    expect(results[0]?.titleRelevanceScore).toBeGreaterThanOrEqual(100);
    expect(results[0]?.mangaEvidenceScore).toBeLessThan(50);
    expect(results[0]?.resultGroup).toBe('PRIMARY');
    expect(results[0]?.additionalReason).toBeNull();
  });

  it('normalizes spacing and punctuation differences', () => {
    const results = rank([rawRecord({ title: '푸른-  궤적 1권', seriesTitle: '푸른 궤적', subject: '만화' })], '푸른 궤적');
    expect(results[0]?.titleRelevanceScore).toBeGreaterThanOrEqual(100);
  });

  it('preserves meaningful numerals and roman-title tokens', () => {
    const numeric = rank([rawRecord({ title: '20세기 소년 1권', seriesTitle: '20세기 소년', subject: '만화' })], '20세기 소년');
    const roman = rank([rawRecord({ title: 'D.Gray-man 1권', seriesTitle: 'D.Gray-man', subject: '만화' })], 'D.Gray-man');
    expect(numeric[0]?.relevanceBand).toBe('HIGH');
    expect(roman[0]?.relevanceBand).toBe('HIGH');
  });

  it('does not give a very short substring query a high relevance band', () => {
    const results = rank([rawRecord({ title: '가나다라마바사 1권', seriesTitle: '가나다라마바사', subject: null })], '가나');
    expect(results[0]?.relevanceBand).toBe('LOW');
  });

  it('does not classify a multi-volume series as manga without catalog evidence', () => {
    const records = [1, 2, 3].map((volume) => rawRecord({
      id: `unknown-${volume}`,
      title: `푸른 궤적 ${volume}권`,
      volumeLabel: `${volume}권`,
      isbn: `979-11-00000-0${volume}-1`,
      subject: null,
    }));
    const results = rank(records, '푸른 궤적');
    expect(results[0]?.mangaClassification).toBe('UNCERTAIN');
    expect(results[0]?.classificationReasons).toContain('SERIES_VOLUME_STRUCTURE');
  });

  it('uses subject and descriptive fields but keeps a novel with the same title separate', () => {
    const results = rank([
      rawRecord({ id: 'comic', subject: '일본 만화', bookIntroduction: '청춘 만화 작품' }),
      rawRecord({ id: 'novel', title: '푸른 궤적', seriesTitle: null, author: '다른 작가', publisher: '다른 출판사', subject: '청소년 소설' }),
    ], '푸른 궤적');
    expect(results.map((result) => result.mangaClassification)).toContain('MANGA_LIKELY');
    expect(results.map((result) => result.mangaClassification)).toContain('NON_MANGA_LIKELY');
    expect(results).toHaveLength(2);
  });

  it('uses explicit SUBJECT differences to avoid merging a manga with its same-author source novel', () => {
    const results = rank([
      rawRecord({ id: 'manga-medium', title: '달의 정원 1권', seriesTitle: '달의 정원', author: '공동 작가', publisher: '공동 출판사', subject: '만화' }),
      rawRecord({ id: 'novel-medium', title: '달의 정원 1권', seriesTitle: '달의 정원', author: '공동 작가', publisher: '공동 출판사', subject: '소설' }),
    ], '달의 정원');
    expect(results).toHaveLength(2);
    expect(results.map((result) => result.mangaClassification)).toContain('MANGA_LIKELY');
    expect(results.map((result) => result.mangaClassification)).toContain('NON_MANGA_LIKELY');
  });

  it('keeps a high-relevance uncertain work in the primary group and gives clearly non-manga evidence its own reason', () => {
    const results = rank([
      rawRecord({ id: 'uncertain', title: '달의 정원 1권', seriesTitle: '달의 정원', subject: null }),
      rawRecord({ id: 'novel', title: '달의 정원 장편소설', seriesTitle: '달의 정원', author: '다른 작가', publisher: '다른 출판사', subject: '장편소설' }),
    ], '달의 정원');
    const uncertain = results.find((result) => result.mangaClassification === 'UNCERTAIN');
    const nonManga = results.find((result) => result.mangaClassification === 'NON_MANGA_LIKELY');
    expect(uncertain?.resultGroup).toBe('PRIMARY');
    expect(nonManga?.resultGroup).toBe('ADDITIONAL');
    expect(nonManga?.additionalReason).toBe('NON_MANGA_EVIDENCE');
  });

  it('does not treat a manga guide/reference book as a manga merely because its title says 만화', () => {
    const results = rank([
      rawRecord({ title: '만화 작법 공식 가이드', seriesTitle: null, subject: '만화 해설서' }),
    ], '만화 작법 공식 가이드');
    expect(results[0]?.mangaClassification).toBe('NON_MANGA_LIKELY');
    expect(results[0]?.resultGroup).toBe('ADDITIONAL');
    expect(results[0]?.additionalReason).toBe('NON_MANGA_EVIDENCE');
  });

  it('marks catalog manga SUBJECT conflicting with an explicit guide title as uncertain', () => {
    const results = rank([
      rawRecord({ title: '만화 작법 공식 가이드', seriesTitle: null, subject: '만화' }),
    ], '만화 작법 공식 가이드');
    expect(results[0]?.mangaClassification).toBe('UNCERTAIN');
    expect(results[0]?.resultGroup).toBe('PRIMARY');
  });

  it('retains likely-manga rows with missing cover and volume metadata', () => {
    const manga = rawRecord({ title: '장면과 바람', volumeLabel: null, subject: '만화', coverUrl: null });
    const results = rank([manga], '장면과 바람');
    expect(results).toHaveLength(1);
    expect(results[0]?.mangaClassification).toBe('MANGA_LIKELY');
    expect(results[0]?.volumes[0]?.isbn).toBe(manga.isbn);
  });

  it('groups regular and special editions without losing volume and ISBN details', () => {
    const records = [
      rawRecord({ id: 'regular', title: '푸른 궤적 1권', volumeLabel: '1권', isbn: '979-11-00000-01-4', subject: '만화', editionStatement: '일반판' }),
      rawRecord({ id: 'special', title: '푸른 궤적 1권 특별판', volumeLabel: '1권', isbn: '979-11-00000-02-1', subject: '만화', editionStatement: '특별판' }),
    ];
    const results = rank(records, '푸른 궤적');
    expect(results).toHaveLength(1);
    expect(results[0]?.volumes).toHaveLength(2);
    expect(results[0]?.volumes.map((volume) => volume.isbn)).toEqual(['979-11-00000-01-4', '979-11-00000-02-1']);
  });

  it('keeps identical titles from different authors and publishers separate', () => {
    const results = rank([
      rawRecord({ id: 'one', subject: '만화' }),
      rawRecord({ id: 'two', author: '다른 작가', publisher: '다른 출판사', subject: '소설' }),
    ], '푸른 궤적');
    expect(results).toHaveLength(2);
  });

  it('keeps records with missing subject uncertain instead of excluding likely manga', () => {
    const results = rank([rawRecord({ subject: null, isbnAdditionalCode: null, bookIntroduction: null, bookSummary: null })], '푸른 궤적');
    expect(results).toHaveLength(1);
    expect(results[0]?.mangaClassification).toBe('UNCERTAIN');
  });

  it('ranks only the supplied page records and does not infer unseen pages', () => {
    const records = [rawRecord({ id: 'page-1', subject: null })];
    const results = rank(records, '푸른 궤적');
    expect(results).toHaveLength(1);
    expect(results[0]?.volumes).toHaveLength(1);
  });
});