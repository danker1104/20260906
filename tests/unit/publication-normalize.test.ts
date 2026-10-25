import { describe, expect, it } from 'vitest';
import {
  detectEdition,
  detectQueryType,
  determineVolumeStatus,
  extractVolumeLabel,
  extractVolumeNumber,
  groupVolumesIntoWorks,
  toPublicationVolume,
} from '../../src/lib/publication/normalize';
import type { NlRawRecord } from '../../src/lib/publication/provider';

function record(overrides: Partial<NlRawRecord>): NlRawRecord {
  return {
    id: 'rec-1',
    title: '[Mock] 테스트 작품 1권',
    isbn: '979-11-00000-01-4',
    author: '김가상',
    publisher: '가상출판사',
    pubPredateYn: 'N',
    expectedPublicationDate: null,
    depositStatus: 'N',
    coverUrl: null,
    ...overrides,
  };
}

describe('detectQueryType', () => {
  it('recognizes a valid ISBN-13 regardless of hyphenation', () => {
    expect(detectQueryType('979-11-00000-01-4')).toBe('ISBN');
  });

  it('recognizes a valid ISBN-10 with an X check digit', () => {
    expect(detectQueryType('123456789X')).toBe('ISBN');
  });

  it('treats a digit string with a bad checksum as a title query', () => {
    expect(detectQueryType('9791100000011')).toBe('TITLE');
  });

  it('treats free text as a title query', () => {
    expect(detectQueryType('타코피의 원죄')).toBe('TITLE');
  });
});

describe('extractVolumeNumber / extractVolumeLabel', () => {
  it('extracts an arabic volume number', () => {
    expect(extractVolumeNumber('작품명 3권')).toBe(3);
    expect(extractVolumeLabel('작품명 3권')).toBe('3권');
  });

  it('extracts a Korean numeral volume number', () => {
    expect(extractVolumeNumber('작품명 삼권')).toBe(3);
  });

  it('returns null when no volume marker is present', () => {
    expect(extractVolumeNumber('작품명 완결 세트')).toBeNull();
  });
});

describe('detectEdition', () => {
  it('classifies special, complete, ebook, regular, and unknown editions', () => {
    expect(detectEdition('작품명 1권 특별판')).toBe('SPECIAL');
    expect(detectEdition('작품명 완전판')).toBe('COMPLETE');
    expect(detectEdition('작품명 전자책 1권')).toBe('EBOOK');
    expect(detectEdition('작품명 1권')).toBe('REGULAR');
    expect(detectEdition('작품명')).toBe('UNKNOWN');
  });
});

describe('determineVolumeStatus', () => {
  const today = new Date('2026-01-01T00:00:00Z');

  it('treats deposit as ground truth even when a predate is also present', () => {
    const status = determineVolumeStatus(record({ depositStatus: 'Y', pubPredateYn: 'Y', expectedPublicationDate: '2026-06-01' }), today);
    expect(status).toBe('DEPOSITED');
  });

  it('classifies a future predate as UPCOMING', () => {
    const status = determineVolumeStatus(record({ pubPredateYn: 'Y', expectedPublicationDate: '2026-06-01' }), today);
    expect(status).toBe('UPCOMING');
  });

  it('classifies a past predate with no deposit as DATE_PASSED', () => {
    const status = determineVolumeStatus(record({ pubPredateYn: 'Y', expectedPublicationDate: '2025-01-01' }), today);
    expect(status).toBe('DATE_PASSED');
  });

  it('classifies an ISBN-only record as REGISTERED', () => {
    const status = determineVolumeStatus(record({ isbn: '979-11-00000-09-1' }), today);
    expect(status).toBe('REGISTERED');
  });

  it('classifies a record with nothing confirmed as UNKNOWN', () => {
    const status = determineVolumeStatus(record({ isbn: null }), today);
    expect(status).toBe('UNKNOWN');
  });
});

describe('groupVolumesIntoWorks', () => {
  it('groups same-author volumes into one work (Work A scenario)', () => {
    const isbns = ['979-11-00000-01-4', '979-11-00000-02-1', '979-11-00000-03-8'];
    const volumes = [1, 2, 3].map((n, index) => toPublicationVolume(record({ id: `a-${n}`, title: `[Mock] 작품 A ${n}권`, isbn: isbns[index] }), true));
    const { works, ungroupedVolumes } = groupVolumesIntoWorks(volumes);
    expect(works).toHaveLength(1);
    expect(works[0]?.volumes).toHaveLength(3);
    expect(ungroupedVolumes).toHaveLength(0);
  });

  it('groups edition variants of the same volume into one work (Work B scenario)', () => {
    const volumes = [
      toPublicationVolume(record({ id: 'b-1', title: '[Mock] 작품 B 1권', isbn: '979-11-00000-11-3' }), true),
      toPublicationVolume(record({ id: 'b-1-special', title: '[Mock] 작품 B 1권 특별판', isbn: '979-11-00000-12-0' }), true),
    ];
    const { works } = groupVolumesIntoWorks(volumes);
    expect(works).toHaveLength(1);
    expect(works[0]?.volumes).toHaveLength(2);
  });

  it('keeps a similarly-named but differently-authored work separate (Work C scenario)', () => {
    const volumes = [
      toPublicationVolume(record({ id: 'a-1', title: '[Mock] 작품 A 1권', author: '김가상', isbn: '979-11-00000-01-4' }), true),
      toPublicationVolume(record({ id: 'c-1', title: '[Mock] 작품 에이 1권', author: '박다른작가', isbn: '979-11-00000-21-2' }), true),
    ];
    const { works } = groupVolumesIntoWorks(volumes);
    expect(works).toHaveLength(2);
  });

  it('keeps records from different publishers in separate works', () => {
    const volumes = [
      toPublicationVolume(record({ id: 'pub-a', title: '[Mock] 같은 제목 1권', isbn: '979-11-00000-01-4', publisher: '출판사 A' }), true),
      toPublicationVolume(record({ id: 'pub-b', title: '[Mock] 같은 제목 2권', isbn: '979-11-00000-02-1', publisher: '출판사 B' }), true),
    ];
    expect(groupVolumesIntoWorks(volumes).works).toHaveLength(2);
  });

  it('does not deduplicate distinct volumes that only share a set ISBN', () => {
    const volumes = [
      toPublicationVolume(record({ id: 'set-1', title: '[Mock] 세트 작품 1권', isbn: '9780000000000', isbnSource: 'SET_ISBN' }), false),
      toPublicationVolume(record({ id: 'set-2', title: '[Mock] 세트 작품 2권', isbn: '9780000000000', isbnSource: 'SET_ISBN' }), false),
    ];
    expect(groupVolumesIntoWorks(volumes).works[0]?.volumes).toHaveLength(2);
  });

  it('reports volumes with no author as ungrouped instead of guessing', () => {
    const volumes = [toPublicationVolume(record({ id: 'edge-1', title: '[Mock] 작품 엣지', author: null, isbn: null }), true)];
    const { works, ungroupedVolumes } = groupVolumesIntoWorks(volumes);
    expect(works).toHaveLength(0);
    expect(ungroupedVolumes).toHaveLength(1);
  });

  it('deduplicates records sharing the same ISBN', () => {
    const volumes = [
      toPublicationVolume(record({ id: 'dup-1', isbn: '979-11-00000-01-4' }), true),
      toPublicationVolume(record({ id: 'dup-2', isbn: '979-11-00000-01-4' }), true),
    ];
    const { works } = groupVolumesIntoWorks(volumes);
    expect(works[0]?.volumes).toHaveLength(1);
  });
});
