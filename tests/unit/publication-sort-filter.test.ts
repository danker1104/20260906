import { describe, expect, it } from 'vitest';
import { filterVolumesByStatus, sortVolumes } from '../../src/lib/publication/sort-filter';
import type { PublicationVolume } from '../../src/lib/domain/publication-types';

function volume(overrides: Partial<PublicationVolume>): PublicationVolume {
  return {
    recordId: 'r',
    title: 't',
    volumeNumber: null,
    volumeLabel: null,
    isbn: null,
    author: null,
    publisher: null,
    expectedPublicationDate: null,
    status: 'UNKNOWN',
    edition: 'UNKNOWN',
    coverUrl: null,
    productUrl: null,
    isMock: true,
    ...overrides,
  };
}

describe('filterVolumesByStatus', () => {
  const volumes = [
    volume({ recordId: '1', status: 'UPCOMING' }),
    volume({ recordId: '2', status: 'DEPOSITED' }),
    volume({ recordId: '3', status: 'REGISTERED' }),
  ];

  it('returns everything for ALL', () => {
    expect(filterVolumesByStatus(volumes, 'ALL')).toHaveLength(3);
  });

  it('filters to a single status', () => {
    expect(filterVolumesByStatus(volumes, 'DEPOSITED').map((v) => v.recordId)).toEqual(['2']);
  });
});

describe('sortVolumes', () => {
  const volumes = [
    volume({ recordId: 'c', volumeNumber: 3 }),
    volume({ recordId: 'a', volumeNumber: 1 }),
    volume({ recordId: 'b', volumeNumber: 2 }),
  ];

  it('sorts ascending by volume number', () => {
    expect(sortVolumes(volumes, 'VOLUME_ASC').map((v) => v.recordId)).toEqual(['a', 'b', 'c']);
  });

  it('sorts descending by volume number', () => {
    expect(sortVolumes(volumes, 'VOLUME_DESC').map((v) => v.recordId)).toEqual(['c', 'b', 'a']);
  });

  it('sorts by expected publication date, pushing volumes without a date to the end', () => {
    const dated = [
      volume({ recordId: 'later', expectedPublicationDate: '2026-06-01' }),
      volume({ recordId: 'no-date', expectedPublicationDate: null }),
      volume({ recordId: 'earlier', expectedPublicationDate: '2026-01-01' }),
    ];
    expect(sortVolumes(dated, 'EXPECTED_DATE').map((v) => v.recordId)).toEqual(['earlier', 'later', 'no-date']);
  });
});
