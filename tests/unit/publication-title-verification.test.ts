import { describe, expect, it, vi } from 'vitest';
import type { Candidate } from '../../src/lib/domain/types';
import type { NationalLibraryProvider, NlRawRecord } from '../../src/lib/publication/provider';
import { verifyKoreanTitleWithIsbn } from '../../src/lib/publication/verify-korean-title';

const candidate: Candidate = {
  rank: 1, japaneseTitle: '星空の図書館', koreanTitle: '밤하늘 책방', koreanTitleStatus: 'TRANSLATED',
  publicationStatus: 'UNKNOWN', confidence: 'LOW', evidence: ['WORK_TITLE_MATCH'], author: '작가',
  koreanInvestigationStatus: 'SUCCESS',
};

const record: NlRawRecord = {
  id: 'verified-book', title: '밤하늘 책방 1', seriesTitle: '밤하늘 책방', isbn: '9780306406157',
  author: '작가', publisher: '출판사', subject: '만화', pubPredateYn: 'N',
  expectedPublicationDate: null, depositStatus: 'N', coverUrl: null,
};

function provider(records: NlRawRecord[], mode: 'live' | 'mock' = 'live'): NationalLibraryProvider {
  return { mode, search: vi.fn(async () => ({ pageNo: 1, records, totalCount: records.length, hasMore: false })) };
}

describe('Korean title ISBN verification', () => {
  it('confirms the selected Korean name from a live manga ISBN record without inventing a release', async () => {
    const catalog = provider([record]);
    const result = await verifyKoreanTitleWithIsbn(candidate, { provider: catalog });
    expect(catalog.search).toHaveBeenCalledWith({ query: '밤하늘 책방', queryType: 'TITLE', page: 1, pageSize: 10 }, expect.any(AbortSignal));
    expect(result.isbn).toBe(record.isbn);
    expect(result.candidate).toMatchObject({ koreanTitle: '밤하늘 책방', koreanTitleStatus: 'OFFICIAL', publicationStatus: 'UNKNOWN', confidence: 'LOW' });
    expect(result.candidate.evidence).toContain('PUBLISHER_MATCH');
    expect(candidate.koreanTitleStatus).toBe('TRANSLATED');
  });

  it.each([
    { reference: '스파이x패밀리', catalogTitle: '스파이 패밀리' },
    { reference: '정반대인 너와 나', catalogTitle: '정반대의 너와 나' },
  ])('selects the real catalog name before exact ISBN confirmation: $reference', async ({ reference, catalogTitle }) => {
    const selected = { ...candidate, koreanTitle: reference };
    const catalog = provider([{ ...record, title: `${catalogTitle} 1`, seriesTitle: catalogTitle }]);
    const result = await verifyKoreanTitleWithIsbn(selected, { provider: catalog });
    expect(result.candidate).toMatchObject({ koreanTitle: catalogTitle, koreanTitleStatus: 'OFFICIAL', confidence: 'LOW', publicationStatus: 'UNKNOWN' });
    expect(result.isbn).toBe(record.isbn);
    expect(catalog.search).toHaveBeenCalledTimes(1);
  });

  it('does not replace a preferred verified NamuWiki name with a different catalog name', async () => {
    const selected = { ...candidate, koreanTitle: '스파이x패밀리' };
    const catalog = provider([{ ...record, title: '스파이 패밀리 1', seriesTitle: '스파이 패밀리' }]);
    expect(await verifyKoreanTitleWithIsbn(selected, { provider: catalog, allowNameCorrection: false })).toEqual({ candidate: selected });
  });

  it('does not choose between multiple similar catalog names', async () => {
    const catalog = provider([
      { ...record, title: '밤하늘 책방은 1', seriesTitle: '밤하늘 책방은' },
      { ...record, id: 'other-title', title: '밤하늘 책방의 1', seriesTitle: '밤하늘 책방의' },
    ]);
    expect(await verifyKoreanTitleWithIsbn(candidate, { provider: catalog })).toEqual({ candidate });
  });

  it.each([
    { name: 'invalid ISBN', overrides: { isbn: '9780306406158' } },
    { name: 'no ISBN', overrides: { isbn: null } },
    { name: 'novel with the same title', overrides: { subject: '소설' } },
    { name: 'unclassified book', overrides: { subject: null } },
    { name: 'different work', overrides: { title: '밤하늘 책방 이야기 1', seriesTitle: '밤하늘 책방 이야기' } },
    { name: 'conflicting author', overrides: { author: '다른 작가' } },
    { name: 'missing publisher', overrides: { publisher: null } },
  ])('does not confirm $name', async ({ overrides }) => {
    const result = await verifyKoreanTitleWithIsbn(candidate, { provider: provider([{ ...record, ...overrides }]) });
    expect(result).toEqual({ candidate });
  });

  it('does not use mock catalog data as confirmation', async () => {
    const catalog = provider([record], 'mock');
    expect(await verifyKoreanTitleWithIsbn(candidate, { provider: catalog })).toEqual({ candidate });
    expect(catalog.search).not.toHaveBeenCalled();
  });

  it('skips the catalog call when the remaining time budget is exhausted', async () => {
    const catalog = provider([record]);
    expect(await verifyKoreanTitleWithIsbn(candidate, { provider: catalog, timeoutMs: 0 })).toEqual({ candidate });
    expect(catalog.search).not.toHaveBeenCalled();
  });

  it('does not guess between same-title works by different authors', async () => {
    const unknownAuthor = { ...candidate, author: null };
    const result = await verifyKoreanTitleWithIsbn(unknownAuthor, { provider: provider([record, { ...record, id: 'other', author: '다른 작가' }]) });
    expect(result).toEqual({ candidate: unknownAuthor });
  });

  it('preserves the result on catalog failure or timeout', async () => {
    const failing: NationalLibraryProvider = { mode: 'live', search: vi.fn(async () => { throw new Error('unavailable'); }) };
    expect(await verifyKoreanTitleWithIsbn(candidate, { provider: failing })).toEqual({ candidate });
    const hanging: NationalLibraryProvider = { mode: 'live', search: vi.fn(() => new Promise<never>(() => {})) };
    expect(await verifyKoreanTitleWithIsbn(candidate, { provider: hanging, timeoutMs: 5 })).toEqual({ candidate });
  });
});