import type { MangaClassification, PublicationWork, PublicationVolume, VolumeStatus } from '../domain/publication-types';

function mergeClassification(left: MangaClassification | undefined, right: MangaClassification | undefined): MangaClassification {
  const classifications = new Set([left ?? 'UNCERTAIN', right ?? 'UNCERTAIN']);
  if (classifications.has('MANGA_LIKELY') && classifications.has('NON_MANGA_LIKELY')) return 'UNCERTAIN';
  if (classifications.has('MANGA_LIKELY')) return 'MANGA_LIKELY';
  if (classifications.has('NON_MANGA_LIKELY')) return 'NON_MANGA_LIKELY';
  return 'UNCERTAIN';
}

export function mergePublicationWorkPages(existing: PublicationWork[], incoming: PublicationWork[]): PublicationWork[] {
  const merged = new Map(existing.map((work) => [work.workKey, { ...work, volumes: [...work.volumes] }]));

  for (const nextWork of incoming) {
    let current = merged.get(nextWork.workKey);
    if (!current) {
      current = [...merged.values()].find((candidate) => canMergeAcrossPage(candidate, nextWork));
    }
    if (!current) {
      merged.set(nextWork.workKey, { ...nextWork, volumes: [...nextWork.volumes] });
      continue;
    }

    const seenRecordIds = new Set(current.volumes.map((volume) => volume.recordId));
    for (const volume of nextWork.volumes) {
      if (seenRecordIds.has(volume.recordId)) continue;
      seenRecordIds.add(volume.recordId);
      current.volumes.push(volume);
    }
    current.mangaClassification = mergeClassification(current.mangaClassification, nextWork.mangaClassification);
    current.relevanceBand = current.relevanceBand === 'HIGH' || nextWork.relevanceBand === 'HIGH' ? 'HIGH' : 'LOW';
  }

  return [...merged.values()];
}

function mediumDiscriminator(workKey: string): 'MANGA' | 'NON_MANGA' | 'UNCLASSIFIED' | 'UNKNOWN' | null {
  if (workKey.endsWith('::MANGA')) return 'MANGA';
  if (workKey.endsWith('::NON_MANGA')) return 'NON_MANGA';
  if (workKey.endsWith('::UNCLASSIFIED')) return 'UNCLASSIFIED';
  if (workKey.endsWith('::')) return 'UNKNOWN';
  return null;
}

function baseWorkKey(workKey: string): string {
  const discriminator = mediumDiscriminator(workKey);
  return discriminator ? workKey.slice(0, workKey.lastIndexOf('::')) : workKey;
}

function canMergeAcrossPage(left: PublicationWork, right: PublicationWork): boolean {
  if (baseWorkKey(left.workKey) !== baseWorkKey(right.workKey)) return false;
  const leftMedium = mediumDiscriminator(left.workKey);
  const rightMedium = mediumDiscriminator(right.workKey);
  if (!leftMedium || !rightMedium) return false;

  const isUnknownPair = leftMedium === 'UNKNOWN' && rightMedium === 'MANGA' && right.mangaClassification === 'MANGA_LIKELY'
    || leftMedium === 'UNKNOWN' && rightMedium === 'NON_MANGA' && right.mangaClassification === 'NON_MANGA_LIKELY'
    || rightMedium === 'UNKNOWN' && leftMedium === 'MANGA' && left.mangaClassification === 'MANGA_LIKELY'
    || rightMedium === 'UNKNOWN' && leftMedium === 'NON_MANGA' && left.mangaClassification === 'NON_MANGA_LIKELY';
  if (!isUnknownPair) return false;

  const leftSeries = new Set(left.volumes.map((volume) => volume.seriesTitle?.normalize('NFKC').trim()).filter(Boolean));
  const rightSeries = new Set(right.volumes.map((volume) => volume.seriesTitle?.normalize('NFKC').trim()).filter(Boolean));
  return leftSeries.size === 1 && rightSeries.size === 1 && [...leftSeries][0] === [...rightSeries][0];
}

export function mergeUngroupedVolumePages(existing: PublicationVolume[], incoming: PublicationVolume[]): PublicationVolume[] {
  const seenRecordIds = new Set(existing.map((volume) => volume.recordId));
  return [...existing, ...incoming.filter((volume) => !seenRecordIds.has(volume.recordId))];
}

export function summarizePublicationVolumes(volumes: PublicationVolume[]): {
  upcomingCount: number;
  highestDepositedVolume: number | null;
} {
  const depositedVolumes = volumes
    .filter((volume) => volume.status === 'DEPOSITED' && volume.volumeNumber !== null)
    .map((volume) => volume.volumeNumber as number);
  return {
    upcomingCount: volumes.filter((volume) => volume.status === 'UPCOMING').length,
    highestDepositedVolume: depositedVolumes.length ? Math.max(...depositedVolumes) : null,
  };
}

export function countLoadedVolumes(works: PublicationWork[], ungroupedVolumes: PublicationVolume[]): number {
  return works.reduce((count, work) => count + work.volumes.length, 0) + ungroupedVolumes.length;
}
