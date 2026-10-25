import { describe, expect, it } from 'vitest';
import { mergePublicationWorkPages, mergeUngroupedVolumePages, summarizePublicationVolumes } from '../../src/lib/publication/page-merge';
import type { PublicationVolume, PublicationWork } from '../../src/lib/domain/publication-types';

function volume(overrides: Partial<PublicationVolume> = {}): PublicationVolume {
  return {
    recordId: 'volume-1',
    title: '작품 1권',
    volumeNumber: 1,
    volumeLabel: '1권',
    isbn: '9790000000001',
    author: '작가',
    publisher: '출판사',
    expectedPublicationDate: null,
    status: 'DEPOSITED',
    edition: 'REGULAR',
    coverUrl: null,
    productUrl: null,
    isMock: false,
    ...overrides,
  };
}

function work(volumes: PublicationVolume[], overrides: Partial<PublicationWork> = {}): PublicationWork {
  return {
    workKey: 'series::author::publisher',
    title: '작품',
    author: '작가',
    publisher: '출판사',
    mangaClassification: 'MANGA_LIKELY',
    relevanceBand: 'HIGH',
    volumes,
    ...overrides,
  };
}

describe('publication page merge', () => {
  it('merges later page volumes into the same work and retains edition/ISBN/status fields', () => {
    const first = work([volume({ recordId: 'regular', isbn: '9790000000001' })]);
    const second = work([volume({ recordId: 'special', title: '작품 1권 특별판', isbn: '9790000000002', edition: 'SPECIAL', status: 'UPCOMING', expectedPublicationDate: '2027-01-01' })]);

    const merged = mergePublicationWorkPages([first], [second]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.volumes.map((item) => item.recordId)).toEqual(['regular', 'special']);
    expect(merged[0]?.volumes[1]).toMatchObject({ edition: 'SPECIAL', isbn: '9790000000002', status: 'UPCOMING', expectedPublicationDate: '2027-01-01' });
  });

  it('deduplicates a record repeated on adjacent API pages', () => {
    const repeated = volume({ recordId: 'same-record' });
    const merged = mergePublicationWorkPages([work([repeated])], [work([repeated])]);
    expect(merged[0]?.volumes).toHaveLength(1);
  });

  it('keeps conflicting manga and non-manga evidence uncertain instead of hiding the work', () => {
    const merged = mergePublicationWorkPages(
      [work([volume()], { mangaClassification: 'MANGA_LIKELY' })],
      [work([volume({ recordId: 'v2' })], { mangaClassification: 'NON_MANGA_LIKELY' })],
    );
    expect(merged[0]?.mangaClassification).toBe('UNCERTAIN');
    expect(merged[0]?.relevanceBand).toBe('HIGH');
  });

  it('keeps unrelated page groups as separate results', () => {
    const first = work([volume()]);
    const other = work([volume({ recordId: 'other' })], { workKey: 'other::author::publisher', title: '다른 작품' });
    expect(mergePublicationWorkPages([first], [other])).toHaveLength(2);
  });

  it('merges an uncertain volume from another page when explicit series title, author, and publisher match', () => {
    const unclassified = work([
      volume({ recordId: 'page-1', title: '달의 정원 1권', seriesTitle: '달의 정원', volumeNumber: 1 }),
    ], { workKey: '달의정원::작가::출판사::', title: '달의 정원', mangaClassification: 'UNCERTAIN' });
    const classified = work([
      volume({ recordId: 'page-2', title: '달의 정원 2권', seriesTitle: '달의 정원', volumeNumber: 2, isbn: '9790000000002' }),
    ], { workKey: '달의정원::작가::출판사::MANGA', title: '달의 정원', mangaClassification: 'MANGA_LIKELY' });

    const merged = mergePublicationWorkPages([unclassified], [classified]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.mangaClassification).toBe('MANGA_LIKELY');
    expect(merged[0]?.volumes.map((item) => item.recordId)).toEqual(['page-1', 'page-2']);
  });

  it('does not merge a known novel work with a known manga work across pages', () => {
    const manga = work([volume({ recordId: 'manga' })], { workKey: 'series::author::publisher::MANGA', mangaClassification: 'MANGA_LIKELY' });
    const novel = work([volume({ recordId: 'novel' })], { workKey: 'series::author::publisher::NON_MANGA', mangaClassification: 'NON_MANGA_LIKELY' });
    expect(mergePublicationWorkPages([manga], [novel])).toHaveLength(2);
  });

  it('deduplicates ungrouped records without losing records from a new page', () => {
    const first = volume({ recordId: 'ungrouped-1', isbn: null });
    const next = volume({ recordId: 'ungrouped-2', isbn: null });
    expect(mergeUngroupedVolumePages([first], [first, next]).map((item) => item.recordId)).toEqual(['ungrouped-1', 'ungrouped-2']);
  });

  it('summarizes only loaded volumes and does not infer unseen series volumes', () => {
    const loaded = [
      volume({ recordId: '1', volumeNumber: 1, status: 'DEPOSITED' }),
      volume({ recordId: '3', volumeNumber: 3, status: 'DEPOSITED' }),
      volume({ recordId: '4', volumeNumber: 4, status: 'UPCOMING' }),
    ];
    expect(summarizePublicationVolumes(loaded)).toEqual({ upcomingCount: 1, highestDepositedVolume: 3 });
  });
});
