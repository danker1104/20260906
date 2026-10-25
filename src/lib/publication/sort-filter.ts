import type { PublicationVolume, VolumeSortOrder, VolumeStatusFilter } from '../domain/publication-types';

export function filterVolumesByStatus(volumes: PublicationVolume[], filter: VolumeStatusFilter): PublicationVolume[] {
  if (filter === 'ALL') return volumes;
  if (filter === 'UPCOMING') return volumes.filter((volume) => volume.status === 'UPCOMING');
  if (filter === 'DEPOSITED') return volumes.filter((volume) => volume.status === 'DEPOSITED');
  return volumes.filter((volume) => volume.status === 'REGISTERED');
}

export function sortVolumes(volumes: PublicationVolume[], order: VolumeSortOrder): PublicationVolume[] {
  const sorted = [...volumes];
  if (order === 'VOLUME_DESC') {
    return sorted.sort((left, right) => (right.volumeNumber ?? -1) - (left.volumeNumber ?? -1));
  }
  if (order === 'EXPECTED_DATE') {
    return sorted.sort((left, right) => {
      if (!left.expectedPublicationDate) return 1;
      if (!right.expectedPublicationDate) return -1;
      return left.expectedPublicationDate.localeCompare(right.expectedPublicationDate);
    });
  }
  return sorted.sort((left, right) => (left.volumeNumber ?? Number.MAX_SAFE_INTEGER) - (right.volumeNumber ?? Number.MAX_SAFE_INTEGER));
}
