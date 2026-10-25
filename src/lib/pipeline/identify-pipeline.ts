import sharp from 'sharp';
import type { Candidate, IdentifyStatus, ImageAnalysis, PreparedImage, StageStatus, VerificationStatus } from '../domain/types';
import type { AzureFoundryGateway } from '../ai/azure-foundry-gateway';
import { createAzureFoundryGateway } from '../ai/azure-foundry-gateway';
import { canonicalResolverPrompt, canonicalResolverSystemPrompt, finalJudgmentPrompt, finalJudgmentSystemPrompt } from '../ai/prompts';
import { finalJudgment, refineOcrForSearch } from './stages';
import { isQuotaError } from './stage-utils';
import { extractJapaneseText, getOcrUsabilityReason } from '../search/ocr-space';
import { searchTavily } from '../search/tavily';
import { searchGoogleLens } from '../search/serpapi';
import { enrichCandidateWithYes24 } from '../search/yes24';
import { enrichCandidatesWithNamuWiki, getNamuWikiWorkIdentity } from '../search/namuwiki';
import { verifyKoreanTitleWithIsbn } from '../publication/verify-korean-title';
import type { EvidenceCluster, IdentifyDiagnosticCode, LensDiagnostic, LensMatch, OcrExtraction, RankedLensCandidate, ResearchBundle, ResearchCandidate, ResearchProviders, TavilyConflict, WebSearchResult } from '../search/types';
import { normalizeKoreanSearchTranslation } from '../search/korean-title';
import { ExternalProviderError, uniqueBy } from '../search/provider-utils';
import { buildRefinedJapaneseQueries, refineOcrQueries, scoreOcrTitleCandidate, type OcrQueryRefinement } from '../search/query-refinement';
import { normalizeJapaneseTitle, rankLensCandidates } from '../search/lens-candidates';
import { findVerifiedOcrCorrections, hasFullWorkTitle, isJapaneseWorkSource, verifiedOcrWorkTitles } from '../search/work-title-verification';
import { hashResearchCacheText, InMemoryTtlCache } from '../search/memory-cache';
import { assertDeadline, getTotalTimeoutMs, RequestDeadlineError } from './request-deadline';

export type { ResearchProviders } from '../search/types';

const foundryResultCache = new InMemoryTtlCache<ResearchCandidate[]>({
  clone: (candidates) => candidates.map((candidate) => ({ ...candidate, evidence: [...candidate.evidence] })),
});
const ocrRefinementCache = new InMemoryTtlCache<OcrQueryRefinement>({ clone: (result) => ({ ...result }) });

function logProviderFailure(error: unknown): void {
  if (error instanceof ExternalProviderError) {
    console.error(JSON.stringify({ event: 'external_provider_error', code: error.code }));
  }
}

function safeDiagnosticText(value: string): string {
  return value
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Z]{2,}\b/giu, '[EMAIL]')
    .replace(/https?:\/\/\S+/giu, '[URL]')
    .replace(/@[\p{L}\p{N}_.-]{2,}/gu, '[ACCOUNT]')
    .replace(/\b\d{5,}\b/gu, '[NUMBER]')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 160);
}

function summarizeOcrText(value: string): Record<string, number | boolean> {
  const japaneseCharacters = [...value].filter((character) => /[\u3040-\u30ff\u3400-\u9fff]/u.test(character)).length;
  const latinCharacters = [...value].filter((character) => /[A-Za-z]/u.test(character)).length;
  return {
    charCount: value.length,
    lineCount: value.split(/[\r\n]+/u).filter(Boolean).length,
    japaneseCharacters,
    latinCharacters,
    hasAccountMarker: /@[\p{L}\p{N}_.-]{2,}/u.test(value),
    hasUrl: /https?:\/\//iu.test(value),
  };
}

export interface PipelineStages {
  imageAnalysis: StageStatus;
  finalJudgment: StageStatus;
}

export interface IdentifyPipelineResult {
  stages: PipelineStages;
  candidates: Candidate[];
  analysis?: ImageAnalysis;
  status: IdentifyStatus;
  verificationStatus?: VerificationStatus;
  failureStage?: keyof PipelineStages;
  failureReason?: 'TIMEOUT' | 'UPSTREAM_ERROR' | 'INVALID_MODEL_RESPONSE' | 'RATE_LIMITED';
  diagnosticCodes?: IdentifyDiagnosticCode[];
}

function foundryDiagnosticCode(error: unknown): IdentifyDiagnosticCode {
  if (isQuotaError(error)) return 'FOUNDRY_RATE_LIMITED';
  if (error && typeof error === 'object' && 'failureReason' in error
    && (error as { failureReason?: string }).failureReason === 'INVALID_MODEL_RESPONSE') return 'FOUNDRY_INVALID_RESPONSE';
  return 'FOUNDRY_UNAVAILABLE';
}

function getVerificationStatus(error: unknown): VerificationStatus {
  if (error && typeof error === 'object' && 'verificationStatus' in error) {
    const value = (error as { verificationStatus?: VerificationStatus }).verificationStatus;
    if (value) return value;
  }
  if (isQuotaError(error)) return 'RATE_LIMITED';
  return 'AI_UNAVAILABLE';
}

function toJapaneseQueries(texts: string[], lensMatches: LensMatch[]): string[] {
  const clues = uniqueBy([...texts, ...lensMatches.map((match) => match.title)], (value) => value)
    .filter((value) => value.length >= 2);
  const clue = texts.length > 0 ? clues.join(' ').slice(0, 240) : clues[0];
  if (!clue) return [];
  return texts.length > 0 ? [`${clue} 漫画`, `${clue} マンガ`] : [`${clue} 漫画`];
}

function hasRelevantResult(result: WebSearchResult, clues: string[]): boolean {
  const haystack = `${result.title} ${result.content}`.replace(/\s+/gu, '');
  return clues.some((clue) => {
    const meaningful = clue.replace(/[^\p{L}\p{N}]/gu, '');
    if (meaningful.length < 2) return false;
    const fragments = clue.match(/[\u3040-\u30ff\u3400-\u9fff]{2,}/gu) ?? [];
    if (fragments.some((fragment) => fragment.length <= 12 && haystack.includes(fragment))) return true;
    if (meaningful.length < 4) return false;
    const trigrams = [...new Set(Array.from({ length: meaningful.length - 2 }, (_, index) => meaningful.slice(index, index + 3)))];
    const matchingTrigrams = trigrams.filter((trigram) => haystack.includes(trigram)).length;
    return matchingTrigrams >= Math.max(2, Math.ceil(trigrams.length * 0.4));
  });
}

const genericEvidenceTerms = /^(漫画|マンガ|コミック|表現|描画|chapter|episode|official|manga|comic)$/iu;
const nonMangaPattern = /chatbot|ai friend|assistant|waifu|app|application|download|pinterest|collection|gallery|service|商品|アプリ|ダウンロード|コレクション|ギャラリー/iu;
const mangaContextPattern = /漫画|マンガ|manga|comic|原作|chapter|episode|巻|話|#/u;

function normalizeEvidenceSignal(value: string): string {
  return value.replace(/[\s「」『』「」|｜.,!?！？:：()[\]{}<>]/gu, '').toLocaleLowerCase();
}

function similarEvidenceSignal(left: string, right: string): boolean {
  const normalizedLeft = normalizeEvidenceSignal(left);
  const normalizedRight = normalizeEvidenceSignal(right);
  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft === normalizedRight || normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) return true;
  if (normalizedLeft.length < 4 || normalizedRight.length < 4) return false;
  const leftTrigrams = new Set(Array.from({ length: normalizedLeft.length - 2 }, (_, index) => normalizedLeft.slice(index, index + 3)));
  const rightTrigrams = new Set(Array.from({ length: normalizedRight.length - 2 }, (_, index) => normalizedRight.slice(index, index + 3)));
  const intersection = [...leftTrigrams].filter((trigram) => rightTrigrams.has(trigram)).length;
  return intersection / Math.max(leftTrigrams.size, rightTrigrams.size) >= 0.55;
}

function extractEvidenceSignals(title: string, content = ''): string[] {
  const haystack = `${title} ${content}`;
  const hashtags = [...haystack.matchAll(/#([\p{L}\p{N}_-]{2,})/gu)].map((match) => match[1]);
  const japaneseFragments = haystack.match(/[\u3040-\u30ff\u3400-\u9fff][\u3040-\u30ff\u3400-\u9fff\s・「」『』]{1,}/gu) ?? [];
  const signals = [...hashtags, ...japaneseFragments]
    .map((signal) => signal.replace(/\s+/gu, ' ').trim())
    .filter((signal) => signal.length >= 2 && !genericEvidenceTerms.test(signal));
  if (signals.length > 0) return uniqueBy(signals, normalizeEvidenceSignal).slice(0, 5);
  const fallback = title.replace(/\s+/gu, ' ').trim().slice(0, 160);
  return fallback ? [fallback] : [];
}

function createEvidenceCluster(signal: string): EvidenceCluster {
  const normalizedTitle = normalizeJapaneseTitle(signal);
  return {
    clusterId: `evidence-${normalizedTitle}`,
    candidateTitle: signal,
    normalizedTitle,
    score: 2,
    signals: [signal],
    lensEvidence: [],
    tavilyEvidence: [],
    independentSourceCount: 0,
    lensEvidenceCount: 0,
    tavilyEvidenceCount: 0,
    mangaSignals: [],
    nonMangaSignals: [],
    conflictingEvidence: [],
  };
}

function buildEvidenceClusters(
  lensCandidates: ReturnType<typeof rankLensCandidates>,
  lensMatches: LensMatch[],
  tavilyResults: WebSearchResult[],
  titleCandidates: string[] = [],
  tavilyConflicts: Array<{ candidateTitle: string; title: string; sourceDomain: string }> = [],
): EvidenceCluster[] {
  const clusters = new Map<string, EvidenceCluster>();
  for (const candidate of lensCandidates) {
    const matchesByUrl = new Map(lensMatches.map((match) => [match.link, match]));
    const lensEvidence = candidate.evidence.map((evidence) => {
      const match = matchesByUrl.get(evidence.sourceUrl);
      return { ...evidence, title: match?.title ?? evidence.candidateTitle, source: match?.source ?? evidence.sourceDomain };
    });
    const sourceDomains = new Set(lensEvidence.map((item) => item.sourceDomain).filter(Boolean));
    clusters.set(candidate.normalizedTitle, {
      clusterId: candidate.clusterId,
      candidateTitle: candidate.candidateTitle,
      normalizedTitle: candidate.normalizedTitle,
      score: candidate.score,
      signals: uniqueBy(lensEvidence.map((item) => item.candidateTitle), normalizeJapaneseTitle),
      lensEvidence,
      tavilyEvidence: [],
      independentSourceCount: sourceDomains.size,
      lensEvidenceCount: new Set(lensEvidence.map((item) => item.sourceUrl)).size,
      tavilyEvidenceCount: 0,
      mangaSignals: uniqueBy(lensEvidence
        .filter((item) => item.evidenceType === 'HASHTAG' || item.evidenceType === 'QUOTED_TITLE' || mangaContextPattern.test(`${item.context ?? ''} ${item.candidateTitle}`))
        .map((item) => item.candidateTitle), normalizeJapaneseTitle),
      nonMangaSignals: uniqueBy(lensEvidence
        .filter((item) => nonMangaPattern.test(`${item.context ?? ''} ${item.title} ${item.source}`))
        .map((item) => item.candidateTitle), normalizeJapaneseTitle),
      conflictingEvidence: [],
    });
  }

  for (const title of titleCandidates) {
    const normalizedTitle = normalizeJapaneseTitle(title);
    if (normalizedTitle && !clusters.has(normalizedTitle)) clusters.set(normalizedTitle, createEvidenceCluster(title));
  }

  for (const result of tavilyResults) {
    const normalizedQueryTitle = normalizeJapaneseTitle(result.searchCandidateTitle ?? '');
    const cluster = normalizedQueryTitle ? clusters.get(normalizedQueryTitle) : undefined;
    if (!cluster || !hasRelevantResult(result, [cluster.candidateTitle])) continue;
    if (!cluster.tavilyEvidence.some((evidence) => evidence.url === result.url)) {
      cluster.tavilyEvidence.push({ title: result.title, url: result.url, content: result.content.slice(0, 320), searchQuery: result.searchQuery });
    }
    cluster.tavilyEvidenceCount = cluster.tavilyEvidence.length;
    cluster.signals = uniqueBy([...cluster.signals, ...extractEvidenceSignals(result.title, result.content)], normalizeJapaneseTitle);
    cluster.mangaSignals = uniqueBy([
      ...cluster.mangaSignals,
      ...extractEvidenceSignals(result.title, result.content).filter((signal) => mangaContextPattern.test(signal)),
    ], normalizeJapaneseTitle);
    cluster.score += 2;
  }

  for (const conflict of tavilyConflicts) {
    const cluster = clusters.get(normalizeJapaneseTitle(conflict.candidateTitle));
    if (!cluster || cluster.conflictingEvidence.some((item) => item.title === conflict.title && item.sourceDomain === conflict.sourceDomain)) continue;
    cluster.conflictingEvidence.push({ title: conflict.title.slice(0, 120), sourceDomain: conflict.sourceDomain });
  }

  return [...clusters.values()]
    .map((cluster) => {
      const sources = new Set([
        ...cluster.lensEvidence.map((evidence) => evidence.sourceDomain),
        ...cluster.tavilyEvidence.map((evidence) => getSourceDomain(evidence.url)),
      ].filter(Boolean));
      return {
        ...cluster,
        mangaSignals: uniqueBy(cluster.mangaSignals, normalizeJapaneseTitle),
        nonMangaSignals: uniqueBy(cluster.nonMangaSignals, normalizeJapaneseTitle),
        independentSourceCount: sources.size,
        conflictingEvidence: cluster.conflictingEvidence.slice(0, 3),
      };
    })
    .sort((left, right) => right.score - left.score || right.independentSourceCount - left.independentSourceCount);
}

interface JapaneseSearchBatch {
  results: WebSearchResult[];
  conflicts: Array<{ candidateTitle: string; title: string; sourceDomain: string }>;
}

async function searchTavilyQueries(
  providers: ResearchProviders,
  queries: string[],
  clues: string[] = [],
  deadlineAt = Date.now() + getTotalTimeoutMs(),
  queryCandidates: string[] = clues,
  candidateSource: 'OCR' | 'LENS' = 'OCR',
  requireFullTitle = false,
): Promise<JapaneseSearchBatch> {
  const results: WebSearchResult[] = [];
  const conflicts: JapaneseSearchBatch['conflicts'] = [];
  for (const [index, query] of queries.slice(0, 2).entries()) {
    assertDeadline(deadlineAt);
    try {
      const response = await providers.tavily(query);
      assertDeadline(deadlineAt);
      const queryCandidate = queryCandidates[index];
      const queryClues = queryCandidate ? [queryCandidate] : clues;
      const corrections = requireFullTitle ? findVerifiedOcrCorrections(queryClues, response) : [];
      const relevant = queryClues.length > 0
        ? response.filter((result) => corrections.some((title) => hasFullWorkTitle(result, title)) || (hasRelevantResult(result, queryClues)
          && (!requireFullTitle || queryClues.some((title) => hasFullWorkTitle(result, title)
            || normalizeJapaneseTitle(result.title).includes(normalizeJapaneseTitle(title))
            || normalizeJapaneseTitle(result.content).includes(normalizeJapaneseTitle(title))))))
        : response;
      if (queryCandidate) {
        conflicts.push(...response
          .filter((result) => !relevant.some((item) => item.url === result.url))
          .map((result) => ({ candidateTitle: queryCandidate, title: result.title, sourceDomain: getSourceDomain(result.url) })));
      }
      results.push(...relevant.map((result) => ({
        ...result,
        searchQuery: query,
        ...(queryCandidate ? { searchCandidateTitle: corrections.find((title) => hasFullWorkTitle(result, title)) ?? queryCandidate } : {}),
        searchCandidateSource: candidateSource,
      })));
      if (queryClues.length > 0 && relevant.length > 0
        && (!requireFullTitle || verifiedOcrWorkTitles(queryClues, relevant).length > 0 || corrections.length > 0)) break;
    } catch (error) {
      if (error instanceof RequestDeadlineError) throw error;
      logProviderFailure(error);
    }
  }
  return {
    results: uniqueBy(results, (result) => result.url).slice(0, 10),
    conflicts: uniqueBy(conflicts, (conflict) => `${normalizeJapaneseTitle(conflict.candidateTitle)}|${conflict.sourceDomain}|${conflict.title}`).slice(0, 8),
  };
}

async function runLensFallback(
  providers: ResearchProviders,
  images: PreparedImage[],
  deadlineAt: number,
  reason: 'NO_TITLE_CANDIDATE' | 'UNVERIFIED_OCR_TITLE' | 'CONFLICTING_OCR_TITLES',
  cropBoundsByImage: Array<{ top: number; bottom: number } | undefined> = [],
): Promise<LensMatch[]> {
  const selectedImage = selectLensImage(images);
  const selectedIndex = images.indexOf(selectedImage);
  const cropBounds = cropBoundsByImage[selectedIndex];
  let lensImage = selectedImage;
  let cropBuffer: Buffer | undefined;
  if (cropBounds) {
    const top = Math.max(0, Math.floor(cropBounds.top));
    const bottom = Math.min(selectedImage.height, Math.ceil(cropBounds.bottom));
    if (bottom - top >= selectedImage.height * 0.5) {
      try {
        cropBuffer = await sharp(selectedImage.buffer)
          .extract({ left: 0, top, width: selectedImage.width, height: bottom - top })
          .toFormat(selectedImage.mimeType === 'image/jpeg' ? 'jpeg' : selectedImage.mimeType === 'image/webp' ? 'webp' : 'png')
          .toBuffer();
        lensImage = { ...selectedImage, buffer: cropBuffer, height: bottom - top };
      } catch {
        cropBuffer = undefined;
      }
    }
  }
  if (process.env.NODE_ENV !== 'production') {
    console.info('[LENS FALLBACK]', { status: 'STARTED', reason });
    console.info('[SNS SCREEN CROP]', {
      appliedTo: 'LENS',
      applied: lensImage !== selectedImage,
      reason: lensImage !== selectedImage ? 'SOCIAL_UI_BOUNDS_CONFIRMED' : cropBounds ? 'CROP_FAILED_OR_TOO_SMALL' : 'NO_SAFE_BOUNDS',
    });
    console.info('[LENS SELECTED IMAGE]', {
      index: selectedIndex,
      mimeType: selectedImage.mimeType,
      size: selectedImage.buffer.length,
    });
  }
  assertDeadline(deadlineAt);
  try {
    const matches = await providers.lens(lensImage);
    assertDeadline(deadlineAt);
    return matches;
  } catch (error) {
    if (error instanceof RequestDeadlineError) throw error;
    logProviderFailure(error);
    const providerDiagnostic = error && typeof error === 'object' && 'lensDiagnostic' in error
      ? (error as { lensDiagnostic?: LensDiagnostic }).lensDiagnostic
      : undefined;
    const diagnostic: LensDiagnostic = providerDiagnostic ?? {
      stage: error instanceof ExternalProviderError && error.code === 'SERPAPI_UPLOAD_ERROR' ? 'UPLOAD' : 'SEARCH',
      uploadStatus: null,
      imageIdExists: false,
      searchStatus: null,
      visualMatchCount: 0,
      error: error instanceof Error ? error.message.slice(0, 200) : 'LENS_ERROR',
      failureCode: error instanceof ExternalProviderError && error.code === 'SERPAPI_UPLOAD_ERROR' ? 'LENS_UPLOAD_FAILED' : 'LENS_SEARCH_FAILED',
    };
    const emptyMatches = [] as LensMatch[] & { diagnostic?: LensDiagnostic };
    emptyMatches.diagnostic = diagnostic;
    return emptyMatches;
  } finally {
    cropBuffer?.fill(0);
  }
}

function buildAnalysis(ocrTexts: string[], queries: string[], lensMatches: LensMatch[], lensCandidates: RankedLensCandidate[] = []): ImageAnalysis {
  const dialogues = ocrTexts.filter((text) => text.length >= 6).slice(0, 20);
  const possibleTitles = uniqueBy([
    ...lensCandidates.map((candidate) => candidate.candidateTitle),
    ...lensMatches.map((match) => match.title),
  ], normalizeJapaneseTitle).slice(0, 10);
  return {
    ocr: ocrTexts,
    dialogues,
    characterNames: [],
    possibleTitles,
    authorNames: [],
    publishers: [],
    otherClues: lensMatches.map((match) => match.source).filter(Boolean).slice(0, 10),
    searchQueries: { japanese: queries, korean: [] },
  };
}

function candidateSeeds(
  tavilyResults: WebSearchResult[],
  lensMatches: LensMatch[],
  titleCandidates: string[] = [],
  lensCandidates: RankedLensCandidate[] = [],
): string[] {
  if (lensCandidates.length > 0 || lensMatches.length > 0) {
    const isNoisyLensResponse = lensMatches.length > 20 || lensCandidates.length > 20;
    const directLensTitles = lensCandidates
      .filter((candidate) => candidate.confidence !== 'LOW'
        && candidate.evidence.some((item) => item.evidenceType === 'TITLE' || item.evidenceType === 'QUOTED_TITLE' || item.evidenceType === 'HASHTAG'))
      .map((candidate) => candidate.extractedJapaneseTitle);
    return uniqueBy([
      ...titleCandidates,
      ...directLensTitles,
      ...lensCandidates.filter((candidate) => candidate.confidence !== 'LOW').map((candidate) => candidate.candidateTitle),
      ...(!lensCandidates.length ? tavilyResults.filter((result) => result.searchCandidateSource === 'OCR').map((result) => result.title) : []),
    ], normalizeJapaneseTitle)
      .filter((title) => title.length >= 2)
      .slice(0, isNoisyLensResponse ? 5 : 10);
  }
  return uniqueBy([
    ...titleCandidates,
    ...tavilyResults.map((result) => result.title),
  ], (title) => title)
    .filter((title) => title.length >= 2)
    .slice(0, 10);
}

function selectLensImage(images: PreparedImage[]): PreparedImage {
  return images.reduce((best, image) => image.width * image.height > best.width * best.height ? image : best);
}

function fallbackCandidates(seeds: string[]): Candidate[] {
  return seeds.slice(0, 3).map((title, index) => ({
    rank: (index + 1) as 1 | 2 | 3,
    japaneseTitle: title,
    pronunciation: null,
    koreanTitle: null,
    koreanTitleStatus: 'UNKNOWN' as const,
    publicationStatus: 'UNKNOWN' as const,
    confidence: 'LOW' as const,
    evidence: ['SEARCH_CONSISTENCY' as const],
    author: null,
    koreanInvestigationStatus: 'FAILED' as const,
  }));
}

function normalizeCandidates<T extends Candidate>(candidates: T[]): T[] {
  return candidates.slice(0, 3).map((candidate, index) => ({ ...candidate, rank: (index + 1) as 1 | 2 | 3 }));
}

function cleanJapaneseTitle(value: string): string {
  return value
    .replace(/\s*(?:第\s*\d+\s*(?:話|巻|章)|\d+\s*(?:話|巻)|(?:episode|chapter|vol(?:ume)?|ep)\s*[-.]?\s*\d+).*$/iu, '')
    .replace(/\s*[|｜].*$/u, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function hasKoreanInformation(candidate: Candidate): boolean {
  return Boolean(candidate.koreanTitle && candidate.koreanTitleStatus !== 'UNKNOWN');
}

function selectSingleCandidate(candidates: Candidate[], koreanCandidates: Candidate[] = []): Candidate[] {
  const enriched = candidates.map((candidate) => {
    if (hasKoreanInformation(candidate)) return candidate;
    const matchingKorean = koreanCandidates.find((koreanCandidate) => (
      hasKoreanInformation(koreanCandidate)
      && cleanJapaneseTitle(koreanCandidate.japaneseTitle) === cleanJapaneseTitle(candidate.japaneseTitle)
    ));
    return matchingKorean ? {
      ...candidate,
      koreanTitle: matchingKorean.koreanTitle,
      koreanTitleStatus: matchingKorean.koreanTitleStatus,
      publicationStatus: matchingKorean.publicationStatus,
      koreanInvestigationStatus: matchingKorean.koreanInvestigationStatus,
    } : candidate;
  });
  const selected = enriched.find(hasKoreanInformation) ?? enriched[0];
  if (!selected) return [];
  return [{
    ...selected,
    rank: 1,
    japaneseTitle: cleanJapaneseTitle(selected.japaneseTitle),
  }];
}

function preserveKoreanInvestigationStatus(candidates: Candidate[], investigatedCandidates: Candidate[]): Candidate[] {
  return candidates.map((candidate) => {
    const investigated = investigatedCandidates.find((item) => (
      cleanJapaneseTitle(item.japaneseTitle) === cleanJapaneseTitle(candidate.japaneseTitle)
    ));
    return investigated ? { ...candidate, koreanInvestigationStatus: investigated.koreanInvestigationStatus } : candidate;
  });
}

function alignKoreanJudgmentToCanonicalTitle(canonicalCandidates: Candidate[], koreanCandidates: Candidate[]): Candidate[] {
  const canonicalCandidate = canonicalCandidates[0];
  if (!canonicalCandidate) return [];
  const matchingKoreanCandidate = koreanCandidates.find((candidate) => (
    normalizeJapaneseTitle(candidate.japaneseTitle) === normalizeJapaneseTitle(canonicalCandidate.japaneseTitle)
  ));
  if (!matchingKoreanCandidate) {
    return [{
      ...canonicalCandidate,
      rank: 1,
      koreanTitle: null,
      koreanTitleStatus: 'UNKNOWN',
      publicationStatus: 'UNKNOWN',
    }];
  }

  const confidenceOrder = { LOW: 0, MEDIUM: 1, HIGH: 2 } as const;
  const confidence = confidenceOrder[matchingKoreanCandidate.confidence] < confidenceOrder[canonicalCandidate.confidence]
    ? matchingKoreanCandidate.confidence
    : canonicalCandidate.confidence;
  return [{
    ...canonicalCandidate,
    rank: 1,
    koreanTitle: matchingKoreanCandidate.koreanTitle,
    koreanTitleStatus: matchingKoreanCandidate.koreanTitleStatus,
    publicationStatus: matchingKoreanCandidate.publicationStatus,
    confidence,
    evidence: uniqueBy([...canonicalCandidate.evidence, ...matchingKoreanCandidate.evidence], (code) => code).slice(0, 5),
  }];
}

function titlesReferToSameLensCandidate(left: string, right: string): boolean {
  const normalizedLeft = normalizeJapaneseTitle(left);
  const normalizedRight = normalizeJapaneseTitle(right);
  return normalizedLeft === normalizedRight
    || (Math.min(normalizedLeft.length, normalizedRight.length) >= 6
      && (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)));
}

function preserveStrongLensCandidate(
  canonicalCandidates: ResearchCandidate[],
  lensCandidates: RankedLensCandidate[],
  results: WebSearchResult[],
): { candidates: ResearchCandidate[]; preservedTitle: string | null } {
  const strongDirectCandidates = lensCandidates.filter((candidate) => (
    candidate.confidence !== 'LOW'
    && candidate.evidence.some((item) => item.evidenceType === 'TITLE' || item.evidenceType === 'QUOTED_TITLE' || item.evidenceType === 'HASHTAG')
  ));
  if (strongDirectCandidates.length !== 1) return { candidates: canonicalCandidates, preservedTitle: null };

  const directCandidate = strongDirectCandidates[0];
  if (canonicalCandidates.some((candidate) => titlesReferToSameLensCandidate(candidate.japaneseTitle, directCandidate.extractedJapaneseTitle))) {
    return { candidates: canonicalCandidates, preservedTitle: null };
  }
  const directTitle = normalizeJapaneseTitle(directCandidate.extractedJapaneseTitle);
  const verifiedReading = canonicalCandidates.some((candidate) => results.some((result) => (
    normalizeJapaneseTitle(result.searchCandidateTitle ?? '') === directTitle
    && verifiedOcrWorkTitles([candidate.japaneseTitle], [result]).length > 0
    && [...result.content.matchAll(/[『「]([^』」\r\n]{1,200})[』」]\s*[（(]([^）)\r\n]{1,200})[）)]/gu)]
      .some((match) => normalizeJapaneseTitle(match[1]) === normalizeJapaneseTitle(candidate.japaneseTitle)
        && normalizeJapaneseTitle(match[2]) === directTitle)
  )));
  if (verifiedReading) return { candidates: canonicalCandidates, preservedTitle: null };

  return {
    candidates: [{
      rank: 1,
      japaneseTitle: directCandidate.extractedJapaneseTitle,
      pronunciation: null,
      koreanTitle: null,
      koreanTitleStatus: 'UNKNOWN',
      publicationStatus: 'UNKNOWN',
      confidence: 'LOW',
      evidence: ['WORK_TITLE_MATCH', 'VISUAL_CLUE_MATCH'],
      author: null,
      koreanInvestigationStatus: 'SKIPPED',
    }],
    preservedTitle: directCandidate.extractedJapaneseTitle,
  };
}

function createUnverifiedLensCandidates(lensCandidates: RankedLensCandidate[]): Candidate[] {
  const evidencePriority = (candidate: RankedLensCandidate) => candidate.evidence.reduce((priority, item) => {
    const typePriority = item.evidenceType === 'HASHTAG' ? 0 : item.evidenceType === 'QUOTED_TITLE' ? 1 : item.evidenceType === 'TITLE' ? 2 : 3;
    return Math.min(priority, typePriority);
  }, 3);
  return lensCandidates
    .filter((candidate) => candidate.confidence !== 'LOW'
      && candidate.evidence.some((item) => item.evidenceType === 'TITLE' || item.evidenceType === 'QUOTED_TITLE' || item.evidenceType === 'HASHTAG'))
    .sort((left, right) => evidencePriority(left) - evidencePriority(right)
      || right.score - left.score
      || left.position - right.position)
    .slice(0, 3)
    .map((candidate, index) => ({
      rank: (index + 1) as 1 | 2 | 3,
      japaneseTitle: candidate.extractedJapaneseTitle,
      pronunciation: null,
      koreanTitle: null,
      koreanTitleStatus: 'UNKNOWN',
      publicationStatus: 'UNKNOWN',
      confidence: 'LOW',
      evidence: ['VISUAL_CLUE_MATCH', 'SEARCH_CONSISTENCY'],
      author: null,
      koreanInvestigationStatus: 'SKIPPED',
    }));
}

async function enrichYes24(candidates: Candidate[], results: WebSearchResult[], deadlineAt: number): Promise<Candidate[]> {
  const enriched = await Promise.all(candidates.map(async (candidate) => {
    const verifiedNames = uniqueBy(results.flatMap((result) => {
      const identity = getNamuWikiWorkIdentity(result, candidate.japaneseTitle);
      return identity?.koreanTitle ? [identity.koreanTitle] : [];
    }), normalizeJapaneseTitle);
    const selected = verifiedNames.length === 1 ? {
      ...candidate,
      koreanTitle: verifiedNames[0],
      koreanTitleStatus: normalizeJapaneseTitle(candidate.koreanTitle ?? '') === normalizeJapaneseTitle(verifiedNames[0])
        ? candidate.koreanTitleStatus : 'TRANSLATED' as const,
    } : candidate;
    const verified = await verifyKoreanTitleWithIsbn(selected, {
      timeoutMs: Math.max(0, deadlineAt - Date.now() - 8_000),
      allowNameCorrection: verifiedNames.length !== 1,
    });
    const next = await enrichCandidateWithYes24(verified.candidate, results, verified.isbn);
    if (verifiedNames.length !== 1 || normalizeJapaneseTitle(next.koreanTitle ?? '') === normalizeJapaneseTitle(verifiedNames[0])) return next;
    const title = verifiedNames[0];
    return {
      ...next,
      koreanTitle: title,
      koreanTitleStatus: normalizeJapaneseTitle(verified.candidate.koreanTitle ?? '') === normalizeJapaneseTitle(title)
        ? verified.candidate.koreanTitleStatus : 'TRANSLATED' as const,
    };
  }));
  return enrichCandidatesWithNamuWiki(enriched, results);
}

export function extractJapaneseTitle(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function normalizedKoreanText(value: string): string {
  return value.replace(/\s+/gu, '').toLocaleLowerCase();
}

function getSourceDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./u, ''); } catch { return url; }
}

function detectSocialPlatform(rawOcrText: string, lensMatches: LensMatch[]): string {
  const context = `${rawOcrText} ${lensMatches.map((match) => `${match.source} ${match.link}`).join(' ')}`;
  if (/instagram(?:\.com)?/iu.test(context)) return 'INSTAGRAM';
  if (/tiktok(?:\.com)?/iu.test(context)) return 'TIKTOK';
  if (/(?:twitter(?:\.com)?|x\.com)/iu.test(context)) return 'X';
  if (/pixiv(?:\.net)?/iu.test(context)) return 'PIXIV';
  return 'NONE';
}

function hasRepeatedCommonEvidence(title: string, japaneseTitle: string, results: WebSearchResult[]): boolean {
  const titleText = normalizedKoreanText(title);
  const japaneseFragments = japaneseTitle.match(/[\u3040-\u30ff\u3400-\u9fff]{2,}/gu) ?? [];
  const domains = new Set(
    results
      .filter((result) => {
        const haystack = normalizedKoreanText(`${result.title} ${result.content}`);
        const hasTitle = haystack.includes(titleText);
        const hasJapaneseIdentity = japaneseFragments.some((fragment) => haystack.includes(normalizedKoreanText(fragment)));
        return hasTitle && hasJapaneseIdentity;
      })
      .map((result) => getSourceDomain(result.url)),
  );
  return domains.size >= 2;
}

async function enrichKoreanInformation(
  candidates: ResearchCandidate[],
  tavily: ResearchProviders['tavily'],
  deadlineAt = Date.now() + getTotalTimeoutMs(),
): Promise<{ candidates: Candidate[]; hadFailure: boolean; queries: string[]; results: WebSearchResult[]; titleCandidates: string[]; verifiedAliases: string[]; official: string[]; common: string[] }> {
  const japaneseTitle = extractJapaneseTitle(candidates[0]?.japaneseTitle ?? '');
  const translation = normalizeKoreanSearchTranslation(candidates[0]?.koreanSearchTranslation);
  const queries: string[] = [];
  let hadFailure = false;
  let results: WebSearchResult[] = [];
  if (process.env.NODE_ENV !== 'production') {
    console.info('[KOREAN INVESTIGATION START]', { hasCanonicalTitle: Boolean(japaneseTitle) });
  }

  const normalizeKoreanTitleCandidate = (value: string): string | null => {
    const title = value
      .replace(/\s*[-–—|]\s*(?:나무위키|알라딘|교보문고|YES24|예스24)\s*$/iu, '')
      .replace(/\s+[-–—|]\s*$/u, '')
      .replace(/\s+(?:\d+권?|한국어판|만화책|eBook|전자책|단행본|세트|정발|공식|판매|출간|출판)+\s*$/giu, '')
      .replace(/\s+/gu, ' ')
      .trim();
    const ignored = /^(공식|판매|정발|출판|출간|한국어|제목|만화|만화책|도서|전자책|eBook)$/u;
    const commerceNotice = /국내\s*배송만\s*가능|해외\s*거래처\s*사정|직수입\s*취소\s*수수료|^안내\s*·\s*도서$/u;
    return title.length >= 2 && /[가-힣]/u.test(title) && !ignored.test(title) && !commerceNotice.test(title) ? title : null;
  };

  const extractTitleCandidates = (items: WebSearchResult[]): string[] => {
    const counts = new Map<string, number>();
    for (const item of items) {
      for (const source of [item.title, item.content, item.url]) {
        const matches = source.match(/[가-힣A-Za-z0-9][가-힣A-Za-z0-9·&'’×.+: -]{1,}/gu) ?? [];
        for (const match of matches) {
          const candidate = normalizeKoreanTitleCandidate(match);
          if (candidate) counts.set(candidate, (counts.get(candidate) ?? 0) + 1);
        }
      }
    }
    return [...counts.entries()].sort((left, right) => right[1] - left[1]).map(([candidate]) => candidate).slice(0, 5);
  };

  const titleEvidence = (items: WebSearchResult[]) => {
    const evidence = new Map<string, { count: number; domains: Set<string>; official: boolean }>();
    for (const item of items) {
      let domain = item.url;
      try { domain = new URL(item.url).hostname.replace(/^www\./u, ''); } catch { /* keep the URL as a stable source key */ }
      const haystack = `${item.title} ${item.content}`;
      const official = domain !== 'namu.wiki' && (/정발|정식(?:출판|발매)|정식 한국어판|한국어판|한국판|국내 출판|번역 출간/u.test(haystack)
        || /kyobobook|yes24|aladin|ridibooks|ridi\.|series\.naver|page\.kakao|publisher|출판사/u.test(item.url.toLowerCase()));
      const matches = [item.title, item.content].flatMap((source) => source.match(/[가-힣A-Za-z0-9][가-힣A-Za-z0-9·&'’×.+: -]{1,}/gu) ?? []);
      for (const match of matches) {
        const candidate = normalizeKoreanTitleCandidate(match);
        if (!candidate || candidate.length < 3) continue;
        const current = evidence.get(candidate) ?? { count: 0, domains: new Set<string>(), official: false };
        current.count += 1;
        current.domains.add(domain);
        current.official ||= official;
        evidence.set(candidate, current);
      }
    }
    const ranked = [...evidence.entries()].sort((left, right) => right[1].domains.size - left[1].domains.size || right[1].count - left[1].count);
    return {
      official: ranked.filter(([, value]) => value.official).map(([candidate]) => candidate).slice(0, 5),
      common: ranked.filter(([, value]) => value.domains.size >= 2 && !value.official).map(([candidate]) => candidate).slice(0, 5),
    };
  };

  const hasStrongEvidence = (items: WebSearchResult[], titleCandidates: string[]) => items.some((item) => {
    if (getSourceDomain(item.url) === 'namu.wiki') return false;
    const haystack = `${item.title} ${item.content}`;
    const source = item.url.toLowerCase();
    const hasTitle = titleCandidates.some((candidate) => haystack.includes(candidate));
    const hasSaleSignal = /정발|출판|출간|한국어판|정식|판매|구매|eBook|전자책|단행본|재고|도서/u.test(haystack);
    const hasStrongSource = /kyobobook|yes24|aladin|ridibooks|ridi\.|series\.naver|page\.kakao|publisher|출판사/u.test(source);
    const hasJapaneseSignal = (japaneseTitle.match(/[\u3040-\u30ff\u3400-\u9fff]{2,}/gu) ?? []).some((fragment) => haystack.includes(fragment));
    const matchesOriginal = !translation || normalizeJapaneseTitle(haystack).includes(normalizeJapaneseTitle(japaneseTitle));
    return hasTitle && hasSaleSignal && (hasStrongSource || hasJapaneseSignal) && matchesOriginal;
  });

  const runKoreanQuery = async (query: string, number: 1 | 2) => {
    queries.push(query);
    if (process.env.NODE_ENV !== 'production') {
      console.info('[KOREAN SEARCH QUERY]', { number, query: safeDiagnosticText(query) });
    }
    assertDeadline(deadlineAt);
    try {
      const response = await tavily(query);
      assertDeadline(deadlineAt);
      results = uniqueBy([...results, ...response], (result) => result.url).slice(0, 20);
      if (process.env.NODE_ENV !== 'production') console.info('[KOREAN TAVILY RESULTS]', { count: response.length });
    } catch (error) {
      if (error instanceof RequestDeadlineError) throw error;
      logProviderFailure(error);
      hadFailure = true;
    }
  };

  if (japaneseTitle) await runKoreanQuery(translation ? `"${translation}" 만화` : `"${japaneseTitle}" 한국`, 1);
  const verifiedNamuTitles = () => uniqueBy(results.flatMap((result) => {
    const identity = getNamuWikiWorkIdentity(result, japaneseTitle);
    return identity?.koreanTitle ? [identity.koreanTitle] : [];
  }), normalizeJapaneseTitle);
  const verifiedAlias = verifiedNamuTitles()[0];
  let titleCandidates = extractTitleCandidates(results);
  const shouldRunSecondQuery = Boolean(japaneseTitle) && (Boolean(translation) || titleCandidates.length > 0) && !hasStrongEvidence(results, titleCandidates);
  if (process.env.NODE_ENV !== 'production') console.info('[KOREAN QUERY 2 REQUIRED]', shouldRunSecondQuery);
  if (shouldRunSecondQuery) {
    const secondQuery = translation
      ? verifiedAlias ? `"${verifiedAlias}" 만화` : `"${japaneseTitle}" 한국`
      : `"${titleCandidates[0]}" 만화`;
    await runKoreanQuery(secondQuery, 2);
    titleCandidates = extractTitleCandidates(results);
  }

  const verifiedAliases = verifiedNamuTitles();
  titleCandidates = uniqueBy([...verifiedAliases, ...titleCandidates], normalizeJapaneseTitle).slice(0, 5);
  const koreanTitleCandidate = titleCandidates[0] ?? null;
  const matchesVerifiedAlias = (result: WebSearchResult) => {
    if (/[\u3040-\u30ff\u3400-\u9fff]/u.test(result.content)) return false;
    const titles = result.title.match(/[가-힣A-Za-z0-9][가-힣A-Za-z0-9·&'’×.+: -]{1,}/gu) ?? [];
    return titles.some((title) => verifiedAliases.some((alias) => (
      normalizeJapaneseTitle(normalizeKoreanTitleCandidate(title) ?? '') === normalizeJapaneseTitle(alias)
    )));
  };
  const identityResults = translation
    ? results.filter((result) => getSourceDomain(result.url) === 'namu.wiki'
      ? Boolean(getNamuWikiWorkIdentity(result, japaneseTitle))
      : normalizeJapaneseTitle(`${result.title} ${result.content}`).includes(normalizeJapaneseTitle(japaneseTitle)) || matchesVerifiedAlias(result))
    : results;
  const classifiedTitles = titleEvidence(identityResults);
  if (process.env.NODE_ENV !== 'production') {
    console.info('[KOREAN SEARCH SUMMARY]', {
      hasTitleCandidate: Boolean(koreanTitleCandidate),
      evidenceCount: results.length,
      officialCandidateCount: classifiedTitles.official.length,
      commonCandidateCount: classifiedTitles.common.length,
    });
  }
  const enriched = candidates.map((candidate) => ({
    ...candidate,
    koreanInvestigationStatus: results.length > 0 ? 'SUCCESS' as const : 'INSUFFICIENT' as const,
  }));
  return { candidates: enriched, hadFailure, queries, results, titleCandidates, verifiedAliases, ...classifiedTitles };
}

function defaultProviders(gateway?: AzureFoundryGateway): ResearchProviders {
  return {
    ocr: extractJapaneseText,
    tavily: searchTavily,
    lens: searchGoogleLens,
    refineOcr: async (rawText) => {
      try {
        const cacheKey = hashResearchCacheText('ocr-refiner-v1', rawText);
        return await ocrRefinementCache.getOrLoad(cacheKey, () => refineOcrForSearch(gateway ?? createAzureFoundryGateway(), rawText));
      } catch (error) {
        if (process.env.NODE_ENV !== 'production') console.info('[FOUNDRY OCR REFINER FALLBACK]', { errorType: error instanceof Error ? error.name : 'UNKNOWN' });
        return refineOcrQueries([rawText]);
      }
    },
    judge: async (bundle: ResearchBundle) => {
      const activeGateway = gateway ?? createAzureFoundryGateway();
      const runJudgment = async (): Promise<ResearchCandidate[]> => {
      if (process.env.NODE_ENV !== 'production') {
        console.info('[FOUNDRY KOREAN INPUT]', {
          hasTitleCandidate: Boolean(bundle.koreanTitleCandidates?.[0]),
          evidenceCount: bundle.koreanResults?.length ?? 0,
        });
      }
      const outcome = await finalJudgment(activeGateway, bundle);
      if (process.env.NODE_ENV !== 'production') {
        console.info('[KOREAN FINAL DECISION]', {
          hasTitle: Boolean(outcome.data?.[0]?.koreanTitle),
          release: outcome.data?.[0]?.publicationStatus ?? null,
          status: outcome.status,
        });
      }
      if (outcome.status === 'INSUFFICIENT') return [];
      if (outcome.status !== 'SUCCESS' || !outcome.data) {
        const error = new Error(outcome.failureReason === 'RATE_LIMITED' ? 'Azure Foundry quota exceeded' : outcome.failureReason ?? 'Azure Foundry judgment failed');
        error.name = outcome.failureReason === 'RATE_LIMITED' ? 'AZURE_FOUNDRY_QUOTA_ERROR' : 'AZURE_FOUNDRY_ERROR';
        (error as Error & { verificationStatus?: VerificationStatus }).verificationStatus = outcome.verificationStatus;
        (error as Error & { failureReason?: string }).failureReason = outcome.failureReason;
        throw error;
      }
      return outcome.data;
      };

      if (gateway) return runJudgment();
      const isKoreanVerification = Boolean(bundle.koreanResults);
      const request = {
        model: process.env.AZURE_FOUNDRY_MODEL ?? '',
        systemPrompt: isKoreanVerification ? finalJudgmentSystemPrompt : canonicalResolverSystemPrompt,
        userPrompt: isKoreanVerification ? finalJudgmentPrompt(bundle) : canonicalResolverPrompt(bundle),
      };
      const cacheKey = hashResearchCacheText('foundry-v1', JSON.stringify([
        process.env.AZURE_FOUNDRY_ENDPOINT ?? '',
        request.model,
        request.systemPrompt,
        request.userPrompt,
      ]));
      return foundryResultCache.getOrLoad(cacheKey, async () => {
        return runJudgment();
      });
    },
  };
}

export async function runIdentifyPipeline(
  images: PreparedImage[],
  providersOrGateway: ResearchProviders | AzureFoundryGateway = defaultProviders(),
  deadlineAt = Date.now() + getTotalTimeoutMs(),
): Promise<IdentifyPipelineResult> {
  const providers = 'judge' in providersOrGateway ? providersOrGateway : defaultProviders(providersOrGateway);
  const diagnosticCodes = new Set<IdentifyDiagnosticCode>();
  assertDeadline(deadlineAt);
  const ocrResults: OcrExtraction[] = await Promise.all(images.map(async (image) => {
    try {
      return await providers.ocr(image);
    } catch (error) {
      logProviderFailure(error);
      return { text: '', valid: false };
    }
  }));
  assertDeadline(deadlineAt);
  const ocrTexts = uniqueBy(ocrResults.filter((result) => result.valid).map((result) => result.text), (text) => text);
  const rawOcrText = ocrResults.map((result) => result.rawText ?? result.text).filter(Boolean).join('\n');
  if (process.env.NODE_ENV !== 'production') {
    console.info('[OCR RAW]', ocrResults.map((result, imageIndex) => ({
      imageIndex,
      ...summarizeOcrText(result.rawText ?? result.text),
    })));
    console.info('[OCR RESULT]', ocrResults.map((result, imageIndex) => ({
      imageIndex,
      valid: result.valid,
      confidence: result.ocrConfidence ?? null,
      usabilityReason: getOcrUsabilityReason(result.text),
      textLength: result.text.length,
    })));
  }
  const localRefinement = refineOcrQueries(
    ocrResults.map((result) => result.rawText ?? result.text),
    ocrResults.map((result) => result.lines ?? []),
  );
  const modelRefinement = ocrTexts.length > 0 && providers.refineOcr
    ? await providers.refineOcr(rawOcrText)
    : localRefinement;
  const titleCandidates = uniqueBy([...localRefinement.titleCandidates, ...modelRefinement.titleCandidates], normalizeJapaneseTitle)
    .filter((title) => ocrResults.some((result) => normalizeJapaneseTitle(result.rawText ?? result.text).includes(normalizeJapaneseTitle(title))))
    .slice(0, 6);
  const refinement: OcrQueryRefinement = {
    ...modelRefinement,
    rawText: rawOcrText,
    titleCandidates,
    dialogueCandidates: uniqueBy([...localRefinement.dialogueCandidates, ...modelRefinement.dialogueCandidates], (text) => text).slice(0, 2),
    queryType: titleCandidates.length > 0 ? 'TITLE' : localRefinement.dialogueCandidates.length > 0 || modelRefinement.dialogueCandidates.length > 0 ? 'DIALOGUE' : 'NONE',
  };
  const searchClues = refinement.queryType === 'TITLE' ? refinement.titleCandidates : refinement.dialogueCandidates;
  if (process.env.NODE_ENV !== 'production') {
    console.info('[QUERY REFINEMENT]', {
      rawTextLength: refinement.rawText.length,
      validImageTextCount: ocrTexts.length,
      usefulText: Boolean(refinement.hasUsefulText && refinement.queryType !== 'NONE'),
      titleCandidates: refinement.titleCandidates.map((title) => ({
        text: safeDiagnosticText(title),
        ...scoreOcrTitleCandidate(title),
      })),
      dialogueCandidateCount: refinement.dialogueCandidates.length,
      noiseCount: refinement.noise.length,
      queryType: refinement.queryType,
    });
  }
  let lensMatches: LensMatch[] = [];
  let lensCandidates: RankedLensCandidate[] = [];
  let lensWasSearched = false;
  let queries = buildRefinedJapaneseQueries(refinement);
  if (process.env.NODE_ENV !== 'production') {
    console.info('[REFINED JAPANESE QUERY]', queries.map((query) => ({
      query: refinement.queryType === 'TITLE' ? safeDiagnosticText(query) : '[dialogue query redacted]',
      queryType: refinement.queryType,
      characterCount: query.length,
    })));
    console.info('[OCR SEARCH PLAN]', { queryCount: queries.length, clueCount: searchClues.length });
  }
  const ocrSearch = await searchTavilyQueries(providers, queries, searchClues, deadlineAt, searchClues, 'OCR', refinement.queryType === 'TITLE');
  if (queries.length > 0 && ocrSearch.results.length === 0) diagnosticCodes.add('TAVILY_NO_RELEVANT_RESULTS');
  let uniqueTavilyResults = ocrSearch.results;
  let tavilyConflicts: TavilyConflict[] = ocrSearch.conflicts;
  let relevantTavilyResults = uniqueTavilyResults;
  const verifiedOcrTitles = uniqueBy([
    ...verifiedOcrWorkTitles(refinement.titleCandidates, ocrSearch.results),
    ...findVerifiedOcrCorrections(refinement.titleCandidates, ocrSearch.results),
  ], normalizeJapaneseTitle);
  if (process.env.NODE_ENV !== 'production') {
    console.info('[OCR CANONICAL VALIDATION]', {
      ocrCandidateCount: refinement.titleCandidates.length,
      verifiedTitleCount: verifiedOcrTitles.length,
      corrected: verifiedOcrTitles.some((title) => !refinement.titleCandidates.some((ocrTitle) => normalizeJapaneseTitle(ocrTitle) === normalizeJapaneseTitle(title))),
      evidenceResultCount: ocrSearch.results.length,
    });
  }
  const ocrEvidenceConflicts = ocrSearch.conflicts.length > 0;

  if (verifiedOcrTitles.length !== 1 || ocrEvidenceConflicts) {
    lensWasSearched = true;
    lensMatches = await runLensFallback(
      providers,
      images,
      deadlineAt,
      refinement.titleCandidates.length === 0 ? 'NO_TITLE_CANDIDATE' : verifiedOcrTitles.length > 1 || ocrEvidenceConflicts ? 'CONFLICTING_OCR_TITLES' : 'UNVERIFIED_OCR_TITLE',
      ocrResults.map((result) => result.socialCropBounds),
    );
    lensCandidates = rankLensCandidates(lensMatches.filter((match) => isJapaneseWorkSource({ url: match.link })));
    const lensDiagnostic = (lensMatches as LensMatch[] & { diagnostic?: LensDiagnostic }).diagnostic;
    if (lensDiagnostic?.failureCode) diagnosticCodes.add(lensDiagnostic.failureCode);
    else if (lensMatches.length === 0) diagnosticCodes.add('LENS_EMPTY_RESULTS');
    else if (lensCandidates.length === 0) diagnosticCodes.add('LENS_CANDIDATE_EXTRACTION_FAILED');
    if (lensCandidates.length > 0) {
      const directLensCandidates = lensCandidates.filter((candidate) => (
        candidate.confidence !== 'LOW'
        && candidate.evidence.some((item) => item.evidenceType === 'TITLE' || item.evidenceType === 'QUOTED_TITLE' || item.evidenceType === 'HASHTAG')
      ));
      const selectedLensCandidates = (directLensCandidates.length > 0 ? directLensCandidates : lensCandidates.filter((candidate) => candidate.confidence !== 'LOW')).slice(0, 2);
      const lensQueryCandidates = selectedLensCandidates.map((candidate) => candidate.candidateTitle);
      const lensQueries = lensQueryCandidates.map((title) => `${title} 漫画`);
      queries = [...queries, ...lensQueries];
      const lensSearch = await searchTavilyQueries(
        providers,
        lensQueries,
        lensQueryCandidates,
        deadlineAt,
        lensQueryCandidates,
        'LENS',
      );
      if (process.env.NODE_ENV !== 'production') {
        console.info('[REFINED JAPANESE QUERY]', lensQueries.map((query) => safeDiagnosticText(query)));
        console.info('[LENS SEARCH PLAN]', { candidateCount: lensQueryCandidates.length, queryCount: lensQueries.length });
        console.info('[LENS SEARCH RESULTS]', { queryCount: lensQueries.length, resultCount: lensSearch.results.length, conflictCount: lensSearch.conflicts.length });
      }
      uniqueTavilyResults = uniqueBy([...uniqueTavilyResults, ...lensSearch.results], (result) => result.url).slice(0, 10);
      tavilyConflicts = uniqueBy([...tavilyConflicts, ...lensSearch.conflicts], (conflict) => `${normalizeJapaneseTitle(conflict.candidateTitle)}|${conflict.sourceDomain}|${conflict.title}`).slice(0, 8);
      relevantTavilyResults = uniqueTavilyResults;
      if (lensSearch.results.length === 0) diagnosticCodes.add('TAVILY_NO_RELEVANT_RESULTS');
    }
  }

  if (process.env.NODE_ENV !== 'production') {
    console.info('[LENS VISUAL MATCHES TOP 10]', {
      attempted: lensWasSearched,
      matches: lensMatches.slice(0, 10).map((match, index) => ({
        rank: index + 1,
        position: match.position ?? match.sourceIndex ?? index + 1,
        title: safeDiagnosticText(match.title),
        extractedJapaneseTitle: safeDiagnosticText(extractJapaneseTitle(`${match.title} ${match.snippet ?? ''}`)),
        source: getSourceDomain(match.link),
        matchScore: match.matchScore ?? null,
      })),
    });
    console.info('[LENS CANDIDATES]', lensCandidates.map((candidate) => ({
      rawTitle: safeDiagnosticText(candidate.rawTitle),
      normalizedTitle: candidate.normalizedTitle,
      source: candidate.source,
      sourceHost: getSourceDomain(candidate.url),
      position: candidate.position,
      extractedJapaneseTitle: safeDiagnosticText(candidate.extractedJapaneseTitle),
      confidence: candidate.confidence,
      clusterId: candidate.clusterId,
    })));
  }

  const researchTitles = uniqueBy([...verifiedOcrTitles, ...refinement.titleCandidates], normalizeJapaneseTitle);
  const seeds = candidateSeeds(relevantTavilyResults, lensMatches, researchTitles, lensCandidates);
  const strongLensTitles = new Set(lensCandidates
    .filter((candidate) => candidate.confidence !== 'LOW' && candidate.evidence.some((item) => item.evidenceType === 'TITLE' || item.evidenceType === 'QUOTED_TITLE' || item.evidenceType === 'HASHTAG'))
    .map((candidate) => candidate.normalizedTitle));
  const noisyLensResponse = lensMatches.length > 20 || lensCandidates.length > 20;
  const trustedNoisyTitles = new Set([
    ...verifiedOcrTitles.map(normalizeJapaneseTitle),
    ...refinement.titleCandidates.map(normalizeJapaneseTitle),
    ...strongLensTitles,
  ]);
  const candidateClusters = buildEvidenceClusters(lensCandidates, lensMatches, relevantTavilyResults, researchTitles, tavilyConflicts)
    .filter((cluster) => !noisyLensResponse || trustedNoisyTitles.has(cluster.normalizedTitle))
    .sort((left, right) => Number(strongLensTitles.has(right.normalizedTitle)) - Number(strongLensTitles.has(left.normalizedTitle))
      || right.score - left.score
      || right.independentSourceCount - left.independentSourceCount)
    .slice(0, lensCandidates.length > 20 ? 5 : 8);
  const clusteredSeeds = uniqueBy([
    ...candidateClusters.filter((cluster) => cluster.score > 0).map((cluster) => cluster.candidateTitle),
    ...seeds,
  ], (title) => title).slice(0, 10);
  if (process.env.NODE_ENV !== 'production') {
    console.info('[CANDIDATE SEEDS]', clusteredSeeds.map((title) => safeDiagnosticText(title)));
    console.info('[IDENTIFICATION PATH]', lensMatches.length > 0 ? 'LENS_TAVILY_FOUNDRY' : 'OCR_TAVILY_FOUNDRY');
    console.info('[SOCIAL PLATFORM DETECTED]', detectSocialPlatform(rawOcrText, lensMatches));
    console.info('[FOUNDRY IDENTIFICATION INPUT]', {
      candidateCount: clusteredSeeds.length,
      clusterCount: candidateClusters.length,
      candidateSeeds: clusteredSeeds.map((title) => safeDiagnosticText(title)),
      lensCandidateTitles: lensCandidates.slice(0, 8).map((candidate) => ({
        title: safeDiagnosticText(candidate.extractedJapaneseTitle),
        confidence: candidate.confidence,
        clusterId: candidate.clusterId,
      })),
      lensMatchCount: lensMatches.length,
      lensCandidateCount: lensCandidates.length,
      tavilyResultCount: relevantTavilyResults.length,
      conflictCount: tavilyConflicts.length,
    });
  }
  const analysis = buildAnalysis(ocrTexts, queries, lensMatches, lensCandidates);

  if (process.env.NODE_ENV !== 'production') {
    const diagnostic = (lensMatches as LensMatch[] & { diagnostic?: LensDiagnostic }).diagnostic;
    console.info('[LENS DIAGNOSIS]', {
      stage: diagnostic?.stage ?? 'CANDIDATE_EXTRACTION',
      uploadStatus: diagnostic?.uploadStatus ?? null,
      imageIdExists: diagnostic?.imageIdExists ?? false,
      searchStatus: diagnostic?.searchStatus ?? null,
      visualMatchCount: diagnostic?.visualMatchCount ?? lensMatches.length,
      candidateCount: clusteredSeeds.length,
      lensCandidateCount: lensCandidates.length,
      classification: diagnostic?.stage === 'UPLOAD' ? 'B' : diagnostic?.stage === 'SEARCH' || diagnostic?.stage === 'PARSE' ? 'C' : diagnostic?.visualMatchCount === 0 ? 'D' : clusteredSeeds.length === 0 ? 'E' : 'SUCCESS',
    });
  }

  if (clusteredSeeds.length === 0 || (relevantTavilyResults.length === 0 && lensCandidates.length === 0)) {
    if (process.env.NODE_ENV !== 'production') {
      console.info('[INSUFFICIENT REASON]', {
        reason: 'candidateSeeds.length === 0',
        ocrCount: ocrTexts.length,
        usefulOcr: refinement.hasUsefulText,
        lensMatchCount: lensMatches.length,
        tavilyResultCount: uniqueTavilyResults.length,
        relevantTavilyResultCount: relevantTavilyResults.length,
      });
    }
    return {
      status: 'INSUFFICIENT',
      stages: { imageAnalysis: 'INSUFFICIENT', finalJudgment: 'SKIPPED' },
      candidates: [],
      analysis,
      diagnosticCodes: [...diagnosticCodes, 'INSUFFICIENT_EVIDENCE'],
    };
  }

  const research: ResearchBundle = {
    ocrTexts,
    rawOcrText,
    ocrTitleCandidates: refinement.titleCandidates,
    verifiedOcrTitles,
    tavilyResults: uniqueTavilyResults,
    lensMatches,
    candidateSeeds: clusteredSeeds,
    candidateClusters,
  };
  assertDeadline(deadlineAt);
  let canonicalCandidates: ResearchCandidate[];
  let canonicalFailure: unknown;
  try {
    const foundryCandidates = normalizeCandidates(await providers.judge(research))
      .map((candidate) => ({ ...candidate, japaneseTitle: cleanJapaneseTitle(candidate.japaneseTitle) }));
    const supportedCandidates = refinement.titleCandidates.length === 0 ? foundryCandidates : foundryCandidates.filter((candidate) => {
      const normalizedTitle = normalizeJapaneseTitle(candidate.japaneseTitle);
      if (verifiedOcrTitles.length > 0) return verifiedOcrTitles.some((title) => normalizeJapaneseTitle(title) === normalizedTitle)
        || lensCandidates.some((lensCandidate) => lensCandidate.normalizedTitle === normalizedTitle && lensCandidate.confidence !== 'LOW'
          && verifiedOcrWorkTitles([candidate.japaneseTitle], relevantTavilyResults).length > 0);
      return relevantTavilyResults.some((result) => {
        const queryTitle = normalizeJapaneseTitle(result.searchCandidateTitle ?? '');
        return isJapaneseWorkSource(result)
          && (hasFullWorkTitle(result, candidate.japaneseTitle) || normalizeJapaneseTitle(result.content).includes(normalizedTitle))
          && (queryTitle === normalizedTitle || (queryTitle.length >= 4 && normalizedTitle.includes(queryTitle)));
      }) || lensCandidates.some((lensCandidate) => lensCandidate.confidence !== 'LOW'
        && lensCandidate.normalizedTitle === normalizedTitle
        && lensCandidate.evidence.some((item) => item.evidenceType === 'TITLE' || item.evidenceType === 'QUOTED_TITLE' || item.evidenceType === 'HASHTAG'));
    }).map((candidate) => ({ ...candidate, ...(verifiedOcrTitles.length !== 1 || ocrEvidenceConflicts ? { confidence: 'LOW' as const } : {}) }));
    const lensPreservation = refinement.titleCandidates.length > 0
      ? { candidates: supportedCandidates, preservedTitle: null }
      : preserveStrongLensCandidate(supportedCandidates, lensCandidates, relevantTavilyResults);
    canonicalCandidates = lensPreservation.candidates;
    assertDeadline(deadlineAt);
    if (process.env.NODE_ENV !== 'production') {
      console.info('[FOUNDRY IDENTIFICATION OUTPUT]', {
        candidateTitles: foundryCandidates.map((candidate) => candidate.japaneseTitle),
        preservedLensCandidate: Boolean(lensPreservation.preservedTitle),
      });
      console.info('[CANONICAL RESOLVER RESULT]', { candidateCount: canonicalCandidates.length });
      console.info('[FINAL CANONICAL JAPANESE TITLE]', canonicalCandidates[0]?.japaneseTitle ?? null);
    }
  } catch (error) {
    if (error instanceof RequestDeadlineError) throw error;
    diagnosticCodes.add(foundryDiagnosticCode(error));
    const fallbackTitles = verifiedOcrTitles.length === 1 ? verifiedOcrTitles : providers.refineOcr ? modelRefinement.titleCandidates : [];
    const fallback = selectSingleCandidate(fallbackCandidates(fallbackTitles));
    if (fallback.length === 0) {
      const lensFallback = createUnverifiedLensCandidates(lensCandidates);
      if (lensFallback.length > 0) {
        if (process.env.NODE_ENV !== 'production') {
          console.info('[CANONICAL FAILURE LENS FALLBACK]', lensFallback.map((candidate) => ({
            japaneseTitle: safeDiagnosticText(candidate.japaneseTitle),
            confidence: candidate.confidence,
          })));
        }
        return {
          status: 'PARTIAL_SUCCESS',
          stages: { imageAnalysis: 'SUCCESS', finalJudgment: 'FAILED' },
          candidates: lensFallback,
          analysis,
          verificationStatus: getVerificationStatus(error),
          failureStage: 'finalJudgment',
          failureReason: isQuotaError(error) ? 'RATE_LIMITED' : 'UPSTREAM_ERROR',
          diagnosticCodes: [...diagnosticCodes],
        };
      }
      return { status: 'FAILED', stages: { imageAnalysis: 'SUCCESS', finalJudgment: 'FAILED' }, candidates: [], analysis, verificationStatus: getVerificationStatus(error), failureStage: 'finalJudgment', failureReason: isQuotaError(error) ? 'RATE_LIMITED' : 'UPSTREAM_ERROR', diagnosticCodes: [...diagnosticCodes] };
    }
    canonicalCandidates = fallback;
    canonicalFailure = error;
    if (process.env.NODE_ENV !== 'production') console.info('[CANONICAL RESOLVER RESULT]', { fallbackCandidateCount: canonicalCandidates.length });
  }

  if (canonicalCandidates.length === 0) {
    if (process.env.NODE_ENV !== 'production') {
      console.info('[INSUFFICIENT REASON]', {
        reason: 'Foundry canonicalCandidates.length === 0',
        candidateSeedCount: seeds.length,
      });
    }
    diagnosticCodes.add('INSUFFICIENT_EVIDENCE');
    return { status: 'INSUFFICIENT', stages: { imageAnalysis: 'SUCCESS', finalJudgment: 'INSUFFICIENT' }, candidates: [], analysis, diagnosticCodes: [...diagnosticCodes] };
  }

  const korean = await enrichKoreanInformation(canonicalCandidates, providers.tavily, deadlineAt);
  analysis.searchQueries.korean = korean.queries;
  const canonicalJapaneseTitle = canonicalCandidates[0]?.japaneseTitle ?? '';
  const verifiedResearch: ResearchBundle = {
    ocrTexts: canonicalJapaneseTitle ? [canonicalJapaneseTitle] : [],
    tavilyResults: [],
    lensMatches: [],
    candidateSeeds: canonicalJapaneseTitle ? [canonicalJapaneseTitle] : [],
    koreanResults: korean.results,
    koreanSearchTranslation: normalizeKoreanSearchTranslation(canonicalCandidates[0]?.koreanSearchTranslation),
    koreanVerifiedAliases: korean.verifiedAliases,
    koreanTitleCandidates: korean.titleCandidates,
    koreanOfficialTitleCandidates: korean.official,
    koreanCommonTitleCandidates: korean.common,
  };
  if (process.env.NODE_ENV !== 'production') {
    console.info('[KOREAN INVESTIGATION INPUT]', {
      canonicalJapaneseTitle: safeDiagnosticText(canonicalJapaneseTitle),
      queryCount: korean.queries.length,
      queryLengths: korean.queries.map((query) => query.length),
    });
    console.info('[KOREAN FOUNDRY INPUT]', {
      hasTitleCandidate: Boolean(verifiedResearch.koreanTitleCandidates?.[0]),
      evidenceCount: verifiedResearch.koreanResults?.length ?? 0,
      officialTitleCandidateCount: verifiedResearch.koreanOfficialTitleCandidates?.length ?? 0,
      commonTitleCandidateCount: verifiedResearch.koreanCommonTitleCandidates?.length ?? 0,
    });
  }
  if (process.env.NODE_ENV !== 'production') {
    console.info('[KOREAN INVESTIGATION OUTPUT]', {
      titleCandidates: korean.titleCandidates.map(safeDiagnosticText),
      officialTitles: korean.official.map(safeDiagnosticText),
      commonTitles: korean.common.map(safeDiagnosticText),
      resultCount: korean.results.length,
    });
  }
  let judgedCandidates: Candidate[];
  try {
    judgedCandidates = normalizeCandidates(await providers.judge(verifiedResearch));
    assertDeadline(deadlineAt);
  } catch (error) {
    if (error instanceof RequestDeadlineError) throw error;
    diagnosticCodes.add(foundryDiagnosticCode(error));
    const partialCandidates = await enrichYes24(selectSingleCandidate(korean.candidates), korean.results, deadlineAt);
    return {
      status: 'PARTIAL_SUCCESS',
      stages: { imageAnalysis: 'SUCCESS', finalJudgment: 'FAILED' },
      candidates: partialCandidates,
      analysis,
      verificationStatus: getVerificationStatus(error),
      failureStage: 'finalJudgment',
      failureReason: isQuotaError(error) ? 'RATE_LIMITED' : 'UPSTREAM_ERROR',
      diagnosticCodes: [...diagnosticCodes],
    };
  }
  if (process.env.NODE_ENV !== 'production') {
    console.info('[KOREAN FOUNDRY OUTPUT]', judgedCandidates.map((candidate) => ({
      japaneseTitle: safeDiagnosticText(candidate.japaneseTitle),
      koreanTitle: safeDiagnosticText(candidate.koreanTitle ?? ''),
      koreanTitleStatus: candidate.koreanTitleStatus,
      confidence: candidate.confidence,
      publicationStatus: candidate.publicationStatus,
    })));
  }
  const koreanTitleMatchedCanonical = judgedCandidates.some((candidate) => (
    normalizeJapaneseTitle(candidate.japaneseTitle) === normalizeJapaneseTitle(canonicalJapaneseTitle)
  ));
  judgedCandidates = alignKoreanJudgmentToCanonicalTitle(canonicalCandidates, judgedCandidates);
  if (process.env.NODE_ENV !== 'production') {
    console.info('[KOREAN VERIFIER CANONICAL ALIGNMENT]', { titleMatched: koreanTitleMatchedCanonical });
    console.info('[KOREAN TITLE SELECTION]', judgedCandidates.map((candidate) => ({
      selectedTitle: safeDiagnosticText(candidate.koreanTitle ?? ''),
      status: candidate.koreanTitleStatus,
      publicationStatus: candidate.publicationStatus,
      reason: !koreanTitleMatchedCanonical ? 'CANONICAL_MISMATCH' : candidate.koreanTitleStatus,
      verifiedAliasCount: korean.verifiedAliases.length,
      namuCandidateCount: korean.results.filter((result) => getSourceDomain(result.url) === 'namu.wiki').length,
    })));
  }

  let reverseSearchFailed = false;
  let linkResults = korean.results;
  const translatedCandidate = judgedCandidates.find((candidate) => candidate.koreanTitle && candidate.koreanTitleStatus === 'TRANSLATED');
  const translatedTitle = translatedCandidate?.koreanTitle;
  if (translatedCandidate && translatedTitle && korean.official.length === 0 && korean.common.length === 0) {
    const reverseQuery = `"${translatedTitle}" "${extractJapaneseTitle(translatedCandidate.japaneseTitle)}"`;
    if (process.env.NODE_ENV !== 'production') console.info('[COMMON REVERSE SEARCH]', { enabled: true });
    try {
      assertDeadline(deadlineAt);
      const reverseResults = await providers.tavily(reverseQuery);
      assertDeadline(deadlineAt);
      linkResults = uniqueBy([...linkResults, ...reverseResults], (result) => result.url);
      const commonEvidence = reverseResults.filter((result) => {
        const haystack = normalizedKoreanText(`${result.title} ${result.content}`);
        return haystack.includes(normalizedKoreanText(translatedTitle));
      });
      const commonVerified = hasRepeatedCommonEvidence(translatedTitle, extractJapaneseTitle(translatedCandidate.japaneseTitle), reverseResults);
      if (process.env.NODE_ENV !== 'production') {
        console.info('[COMMON SEARCH RESULTS]', { resultCount: reverseResults.length, evidenceCount: commonEvidence.length });
        console.info('[COMMON VERIFICATION RESULT]', { verified: commonVerified, sourceCount: new Set(commonEvidence.map((result) => getSourceDomain(result.url))).size });
      }
      analysis.searchQueries.korean.push(reverseQuery);
      if (commonVerified) {
        const commonResearch: ResearchBundle = {
          ...verifiedResearch,
          koreanResults: uniqueBy([...korean.results, ...reverseResults], (result) => result.url).slice(0, 20),
          koreanTitleCandidates: [translatedTitle, ...(verifiedResearch.koreanTitleCandidates ?? [])],
          koreanCommonTitleCandidates: [translatedTitle],
        };
        if (process.env.NODE_ENV !== 'production') console.info('[KOREAN FOUNDRY INPUT]', { commonReverse: true, evidenceCount: commonResearch.koreanResults?.length ?? 0 });
        try {
          judgedCandidates = alignKoreanJudgmentToCanonicalTitle(canonicalCandidates, normalizeCandidates(await providers.judge(commonResearch)));
          assertDeadline(deadlineAt);
        } catch (error) {
          if (error instanceof RequestDeadlineError) throw error;
          diagnosticCodes.add(foundryDiagnosticCode(error));
          reverseSearchFailed = true;
        }
      }
    } catch (error) {
      if (error instanceof RequestDeadlineError) throw error;
      diagnosticCodes.add('TAVILY_SEARCH_FAILED');
      reverseSearchFailed = true;
    }
  }

  const selectedCandidates = await enrichYes24(
    selectSingleCandidate(preserveKoreanInvestigationStatus(judgedCandidates, korean.candidates)),
    linkResults,
    deadlineAt,
  );
  return {
    status: canonicalFailure || korean.hadFailure || reverseSearchFailed ? 'PARTIAL_SUCCESS' : 'SUCCESS',
    stages: { imageAnalysis: 'SUCCESS', finalJudgment: 'SUCCESS' },
    candidates: selectedCandidates,
    analysis,
    ...(diagnosticCodes.size > 0 ? { diagnosticCodes: [...diagnosticCodes] } : {}),
    ...(canonicalFailure || korean.hadFailure || reverseSearchFailed ? { failureStage: 'finalJudgment' as const, failureReason: 'UPSTREAM_ERROR' as const } : {}),
  };
}
