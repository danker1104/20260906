import type { Candidate, IdentifyStatus, ImageAnalysis, PreparedImage, StageStatus, VerificationStatus } from '../domain/types';
import type { AzureFoundryGateway } from '../ai/azure-foundry-gateway';
import { createAzureFoundryGateway } from '../ai/azure-foundry-gateway';
import { finalJudgment } from './stages';
import { isQuotaError } from './stage-utils';
import { extractJapaneseText } from '../search/ocr-space';
import { searchTavily } from '../search/tavily';
import { searchGoogleLens } from '../search/serpapi';
import type { LensMatch, OcrExtraction, ResearchBundle, ResearchProviders, WebSearchResult } from '../search/types';
import { ExternalProviderError, uniqueBy } from '../search/provider-utils';
import { assertDeadline, getTotalTimeoutMs, RequestDeadlineError } from './request-deadline';

export type { ResearchProviders } from '../search/types';

function logProviderFailure(error: unknown): void {
  if (error instanceof ExternalProviderError) {
    console.error(JSON.stringify({ event: 'external_provider_error', code: error.code }));
  }
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

async function searchTavilyQueries(
  providers: ResearchProviders,
  queries: string[],
  clues: string[] = [],
  deadlineAt = Date.now() + getTotalTimeoutMs(),
): Promise<WebSearchResult[]> {
  const results: WebSearchResult[] = [];
  for (const query of queries.slice(0, 2)) {
    assertDeadline(deadlineAt);
    try {
      const response = await providers.tavily(query);
      assertDeadline(deadlineAt);
      results.push(...response);
      if (clues.length > 0 && response.some((result) => hasRelevantResult(result, clues))) break;
    } catch (error) {
      if (error instanceof RequestDeadlineError) throw error;
      logProviderFailure(error);
    }
  }
  return uniqueBy(results, (result) => result.url).slice(0, 10);
}

async function runLensFallback(
  providers: ResearchProviders,
  images: PreparedImage[],
  deadlineAt: number,
  reason: 'NO_USEFUL_OCR' | 'NO_RELEVANT_TAVILY',
): Promise<LensMatch[]> {
  if (process.env.NODE_ENV !== 'production') console.info('[LENS FALLBACK]', { reason });
  assertDeadline(deadlineAt);
  try {
    const matches = await providers.lens(selectLensImage(images));
    assertDeadline(deadlineAt);
    return matches;
  } catch (error) {
    if (error instanceof RequestDeadlineError) throw error;
    logProviderFailure(error);
    return [];
  }
}

function buildAnalysis(ocrTexts: string[], queries: string[], lensMatches: LensMatch[]): ImageAnalysis {
  const dialogues = ocrTexts.filter((text) => text.length >= 6).slice(0, 20);
  const possibleTitles = uniqueBy(lensMatches.map((match) => match.title), (title) => title).slice(0, 10);
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

function candidateSeeds(tavilyResults: WebSearchResult[], lensMatches: LensMatch[]): string[] {
  const lensCandidateClues = uniqueBy(lensMatches.map((match) => match.title
    .replace(/\s*(?:第\s*\d+\s*(?:話|巻|章)|chapter\s*\d+|episode\s*\d+).*$/iu, '')
    .replace(/\b(?:manga|comic|official|chapter|episode)\b/giu, '')
    .replace(/\s+/gu, ' ')
    .trim()).filter((title) => title.length >= 2), (title) => title).slice(0, 5);
  if (process.env.NODE_ENV !== 'production') console.info('[LENS CANDIDATES]', lensCandidateClues);
  return uniqueBy([
    ...tavilyResults.map((result) => result.title),
    ...lensCandidateClues,
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

function normalizeCandidates(candidates: Candidate[]): Candidate[] {
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

function extractJapaneseTitle(value: string): string {
  const parts = value.match(/[\u3040-\u30ff\u3400-\u9fff][\u3040-\u30ff\u3400-\u9fff\s・「」『』]{1,}/gu) ?? [];
  return parts.join(' ').replace(/[「」『』]/gu, '').replace(/\s+/gu, ' ').trim().slice(0, 80);
}

async function enrichKoreanInformation(
  candidates: Candidate[],
  tavily: ResearchProviders['tavily'],
  deadlineAt = Date.now() + getTotalTimeoutMs(),
): Promise<{ candidates: Candidate[]; hadFailure: boolean; queries: string[]; results: WebSearchResult[]; titleCandidates: string[] }> {
  const japaneseTitle = extractJapaneseTitle(candidates[0]?.japaneseTitle ?? '');
  const queries: string[] = [];
  let hadFailure = false;
  let results: WebSearchResult[] = [];
  if (process.env.NODE_ENV !== 'production') console.info('[KOREAN SEARCH START]', { japaneseTitle });

  const extractTitleCandidates = (items: WebSearchResult[]): string[] => {
    const counts = new Map<string, number>();
    const ignored = /^(공식|판매|정발|출판|출간|한국어|제목|만화|만화책|도서|전자책|eBook)$/u;
    for (const item of items) {
      for (const source of [item.title, item.content, item.url]) {
        const matches = source.match(/[가-힣][가-힣0-9·&'’' -]{1,}/gu) ?? [];
        for (const match of matches) {
          const candidate = match
            .replace(/\s+(?:\d+권?|한국어판|만화책|eBook|전자책|단행본|세트|정발|공식|판매|출간|출판)+\s*$/giu, '')
            .replace(/\s+/gu, ' ')
            .trim();
          if (candidate.length >= 2 && !ignored.test(candidate)) counts.set(candidate, (counts.get(candidate) ?? 0) + 1);
        }
      }
    }
    return [...counts.entries()].sort((left, right) => right[1] - left[1]).map(([candidate]) => candidate).slice(0, 5);
  };

  const hasStrongEvidence = (items: WebSearchResult[], titleCandidates: string[]) => items.some((item) => {
    const haystack = `${item.title} ${item.content}`;
    const source = item.url.toLowerCase();
    const hasTitle = titleCandidates.some((candidate) => haystack.includes(candidate));
    const hasSaleSignal = /정발|출판|출간|한국어판|정식|판매|구매|eBook|전자책|단행본|재고|도서/u.test(haystack);
    const hasStrongSource = /kyobobook|yes24|aladin|ridibooks|ridi\.|series\.naver|page\.kakao|publisher|출판사/u.test(source);
    const hasJapaneseSignal = (japaneseTitle.match(/[\u3040-\u30ff\u3400-\u9fff]{2,}/gu) ?? []).some((fragment) => haystack.includes(fragment));
    return hasTitle && hasSaleSignal && (hasStrongSource || hasJapaneseSignal);
  });

  const runKoreanQuery = async (query: string, number: 1 | 2) => {
    queries.push(query);
    if (process.env.NODE_ENV !== 'production') console.info(`[KOREAN QUERY ${number}]`, { query });
    assertDeadline(deadlineAt);
    try {
      const response = await tavily(query);
      assertDeadline(deadlineAt);
      results = uniqueBy([...results, ...response], (result) => result.url).slice(0, 20);
      if (process.env.NODE_ENV !== 'production') console.info(`[KOREAN QUERY ${number} RESULTS]`, { count: response.length, results: response });
    } catch (error) {
      if (error instanceof RequestDeadlineError) throw error;
      logProviderFailure(error);
      hadFailure = true;
    }
  };

  if (japaneseTitle) await runKoreanQuery(`"${japaneseTitle}" 한국`, 1);
  let titleCandidates = extractTitleCandidates(results);
  const shouldRunSecondQuery = titleCandidates.length > 0 && !hasStrongEvidence(results, titleCandidates);
  if (process.env.NODE_ENV !== 'production') console.info('[KOREAN QUERY 2 REQUIRED]', shouldRunSecondQuery);
  if (shouldRunSecondQuery) {
    await runKoreanQuery(`"${titleCandidates[0]}" 만화`, 2);
    titleCandidates = extractTitleCandidates(results);
  }

  const koreanTitleCandidate = titleCandidates[0] ?? null;
  const strongEvidence = hasStrongEvidence(results, titleCandidates);
  if (process.env.NODE_ENV !== 'production') {
    console.info('[KOREAN TITLE CANDIDATE]', { candidate: koreanTitleCandidate });
    console.info('[KOREAN EVIDENCE]', { evidenceCount: results.length, results });
  }
  const enriched = candidates.map((candidate) => ({
    ...candidate,
    koreanTitle: candidate.rank === 1 ? koreanTitleCandidate : candidate.koreanTitle,
    koreanTitleStatus: candidate.rank === 1 && koreanTitleCandidate && strongEvidence ? 'OFFICIAL' as const : candidate.koreanTitleStatus,
    publicationStatus: candidate.rank === 1 && strongEvidence ? 'CONFIRMED' as const : candidate.publicationStatus,
    koreanInvestigationStatus: koreanTitleCandidate ? 'SUCCESS' as const : 'INSUFFICIENT' as const,
  }));
  return { candidates: enriched, hadFailure, queries, results, titleCandidates };
}

function defaultProviders(gateway?: AzureFoundryGateway): ResearchProviders {
  return {
    ocr: extractJapaneseText,
    tavily: searchTavily,
    lens: searchGoogleLens,
    judge: async (bundle: ResearchBundle) => {
      if (process.env.NODE_ENV !== 'production') {
        console.info('[FOUNDRY KOREAN INPUT]', {
          titleCandidate: bundle.koreanTitleCandidates?.[0] ?? null,
          evidenceCount: bundle.koreanResults?.length ?? 0,
        });
      }
      const outcome = await finalJudgment(gateway ?? createAzureFoundryGateway(), bundle);
      if (process.env.NODE_ENV !== 'production') {
        console.info('[KOREAN FINAL DECISION]', {
          title: outcome.data?.[0]?.koreanTitle ?? null,
          release: outcome.data?.[0]?.publicationStatus ?? null,
          status: outcome.status,
        });
      }
      if (outcome.status !== 'SUCCESS' || !outcome.data) {
        const error = new Error(outcome.failureReason === 'RATE_LIMITED' ? 'Azure Foundry quota exceeded' : outcome.failureReason ?? 'Azure Foundry judgment failed');
        error.name = outcome.failureReason === 'RATE_LIMITED' ? 'AZURE_FOUNDRY_QUOTA_ERROR' : 'AZURE_FOUNDRY_ERROR';
        (error as Error & { verificationStatus?: VerificationStatus }).verificationStatus = outcome.verificationStatus;
        throw error;
      }
      return outcome.data;
    },
  };
}

export async function runIdentifyPipeline(
  images: PreparedImage[],
  providersOrGateway: ResearchProviders | AzureFoundryGateway = defaultProviders(),
  deadlineAt = Date.now() + getTotalTimeoutMs(),
): Promise<IdentifyPipelineResult> {
  const providers = 'judge' in providersOrGateway ? providersOrGateway : defaultProviders(providersOrGateway);
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
  let lensMatches: LensMatch[] = [];
  let queries = toJapaneseQueries(ocrTexts, []);
  let uniqueTavilyResults = await searchTavilyQueries(providers, queries, ocrTexts, deadlineAt);
  let relevantTavilyResults = ocrTexts.length > 0
    ? uniqueTavilyResults.filter((result) => hasRelevantResult(result, ocrTexts))
    : uniqueTavilyResults;

  if (ocrTexts.length === 0 || relevantTavilyResults.length === 0) {
    lensMatches = await runLensFallback(
      providers,
      images,
      deadlineAt,
      ocrTexts.length === 0 ? 'NO_USEFUL_OCR' : 'NO_RELEVANT_TAVILY',
    );
    if (lensMatches.length > 0) {
      const lensQueries = toJapaneseQueries([], lensMatches);
      queries = [...queries, ...lensQueries];
      const lensTavilyResults = await searchTavilyQueries(providers, lensQueries, lensMatches.map((match) => match.title), deadlineAt);
      uniqueTavilyResults = uniqueBy([...uniqueTavilyResults, ...lensTavilyResults], (result) => result.url).slice(0, 10);
      relevantTavilyResults = ocrTexts.length > 0
        ? uniqueTavilyResults.filter((result) => hasRelevantResult(result, [...ocrTexts, ...lensMatches.map((match) => match.title)]))
        : uniqueTavilyResults;
    }
  }

  const seeds = candidateSeeds(relevantTavilyResults, lensMatches);
  if (process.env.NODE_ENV !== 'production') {
    console.info('[IDENTIFICATION PATH]', lensMatches.length > 0 ? 'LENS_TAVILY_FOUNDRY' : 'OCR_TAVILY_FOUNDRY');
  }
  const analysis = buildAnalysis(ocrTexts, queries, lensMatches);

  if (seeds.length === 0) {
    return {
      status: 'INSUFFICIENT',
      stages: { imageAnalysis: 'INSUFFICIENT', finalJudgment: 'SKIPPED' },
      candidates: [],
      analysis,
    };
  }

  const korean = await enrichKoreanInformation(fallbackCandidates(seeds), providers.tavily, deadlineAt);
  analysis.searchQueries.korean = korean.queries;
  const research: ResearchBundle = {
    ocrTexts,
    tavilyResults: uniqueTavilyResults,
    lensMatches,
    candidateSeeds: seeds,
    koreanResults: korean.results,
    koreanTitleCandidates: korean.titleCandidates,
  };
  assertDeadline(deadlineAt);
  let judgedCandidates: Candidate[];
  try {
    judgedCandidates = normalizeCandidates(await providers.judge(research));
    assertDeadline(deadlineAt);
  } catch (error) {
    if (error instanceof RequestDeadlineError) throw error;
    const fallback = selectSingleCandidate(korean.candidates);
    if (fallback.length === 0) {
      return { status: 'FAILED', stages: { imageAnalysis: 'SUCCESS', finalJudgment: 'FAILED' }, candidates: [], analysis, verificationStatus: getVerificationStatus(error), failureStage: 'finalJudgment', failureReason: isQuotaError(error) ? 'RATE_LIMITED' : 'UPSTREAM_ERROR' };
    }
    return { status: 'PARTIAL_SUCCESS', stages: { imageAnalysis: 'SUCCESS', finalJudgment: 'FAILED' }, candidates: fallback, analysis, verificationStatus: getVerificationStatus(error), failureStage: 'finalJudgment', failureReason: isQuotaError(error) ? 'RATE_LIMITED' : 'UPSTREAM_ERROR' };
  }

  if (judgedCandidates.length === 0) {
    return { status: 'INSUFFICIENT', stages: { imageAnalysis: 'SUCCESS', finalJudgment: 'INSUFFICIENT' }, candidates: [], analysis };
  }

  return {
    status: korean.hadFailure ? 'PARTIAL_SUCCESS' : 'SUCCESS',
    stages: { imageAnalysis: 'SUCCESS', finalJudgment: 'SUCCESS' },
    candidates: selectSingleCandidate(judgedCandidates, korean.candidates),
    analysis,
    ...(korean.hadFailure ? { failureStage: 'finalJudgment' as const, failureReason: 'UPSTREAM_ERROR' as const } : {}),
  };
}
