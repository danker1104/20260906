import type { Candidate, IdentifyStatus, ImageAnalysis, PreparedImage, StageStatus, VerificationStatus } from '../domain/types';
import type { GeminiGateway } from '../ai/gemini-gateway';
import { createGeminiGateway } from '../ai/gemini-gateway';
import { finalJudgment } from './stages';
import { isQuotaError } from './stage-utils';
import { extractJapaneseText } from '../search/ocr-space';
import { searchTavily } from '../search/tavily';
import { searchGoogleLens } from '../search/serpapi';
import type { LensMatch, OcrExtraction, ResearchBundle, ResearchProviders, WebSearchResult } from '../search/types';
import { ExternalProviderError, uniqueBy } from '../search/provider-utils';

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
): Promise<WebSearchResult[]> {
  const results: WebSearchResult[] = [];
  for (const query of queries.slice(0, 2)) {
    console.info('[TAVILY QUERY]', JSON.stringify(query));
    try {
      const response = await providers.tavily(query);
      console.info('[TAVILY RESULT COUNT]', response.length);
      results.push(...response);
      if (clues.length > 0 && response.some((result) => hasRelevantResult(result, clues))) break;
    } catch (error) {
      logProviderFailure(error);
      console.info('[TAVILY RESULT COUNT]', 0);
    }
  }
  return uniqueBy(results, (result) => result.url).slice(0, 10);
}

async function runLensFallback(
  providers: ResearchProviders,
  images: PreparedImage[],
): Promise<LensMatch[]> {
  console.info('[LENS FALLBACK]', true);
  try {
    const matches = await providers.lens(selectLensImage(images));
    return matches;
  } catch (error) {
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
  return uniqueBy([
    ...tavilyResults.map((result) => result.title),
    ...lensMatches.map((match) => match.title),
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

function extractJapaneseTitle(value: string): string {
  const parts = value.match(/[\u3040-\u30ff\u3400-\u9fff][\u3040-\u30ff\u3400-\u9fff\s・「」『』]{1,}/gu) ?? [];
  return parts.join(' ').replace(/[「」『』]/gu, '').replace(/\s+/gu, ' ').trim().slice(0, 80);
}

function extractRomanizedClues(values: string[]): string[] {
  return uniqueBy(values.flatMap((value) => value.match(/[A-Za-z][A-Za-z\s'-]{2,}/g) ?? []), (value) => value)
    .filter((value) => !/^(manga|comic|comics|shonen|magazine|official)$/iu.test(value.trim()))
    .slice(0, 2);
}

async function enrichKoreanInformation(
  candidates: Candidate[],
  tavily: ResearchProviders['tavily'],
  ocrTexts: string[] = [],
): Promise<{ candidates: Candidate[]; hadFailure: boolean; queries: string[] }> {
  let hadFailure = false;
  const japaneseTitles = uniqueBy(candidates.map((candidate) => extractJapaneseTitle(candidate.japaneseTitle)).filter(Boolean), (value) => value);
  const candidateTitles = japaneseTitles.slice(0, 3).map((title) => `"${title}"`).join(' OR ');
  const romanizedClues = extractRomanizedClues([...ocrTexts, ...candidates.map((candidate) => candidate.japaneseTitle)]);
  const queries = [
    `${candidateTitles} 한국 정발 한국어 제목`,
    ...(romanizedClues.length > 0 ? [`${romanizedClues.join(' ')} manga Korean title`] : [`${candidateTitles} 한국어 제목 만화`]),
  ];
  let results: WebSearchResult[] = [];
  for (const query of queries.slice(0, 2)) {
    console.info('[TAVILY QUERY]', JSON.stringify(query));
    try {
      const response = await tavily(query);
      console.info('[TAVILY RESULT COUNT]', response.length);
      results = uniqueBy([...results, ...response], (result) => result.url).slice(0, 10);
      if (results.length > 0) break;
    } catch (error) {
      logProviderFailure(error);
      hadFailure = true;
      console.info('[TAVILY RESULT COUNT]', 0);
    }
  }
  const koreanEvidence = results.map((result) => `${result.title} ${result.content}`).join(' ');
  const hasOfficialSignal = /정발|출판|출간|한국어판|정식/u.test(koreanEvidence);
  const hasKoreanText = /[가-힣]{2,}/u.test(koreanEvidence);
  const enriched = candidates.map((candidate) => ({
    ...candidate,
    koreanTitleStatus: hasOfficialSignal ? 'OFFICIAL' as const : hasKoreanText ? 'COMMON' as const : candidate.koreanTitleStatus,
    publicationStatus: hasOfficialSignal ? 'CONFIRMED' as const : candidate.publicationStatus,
    koreanInvestigationStatus: results.length > 0 ? 'SUCCESS' as const : 'INSUFFICIENT' as const,
  }));
  return { candidates: enriched, hadFailure, queries };
}

function defaultProviders(gateway?: GeminiGateway): ResearchProviders {
  return {
    ocr: extractJapaneseText,
    tavily: searchTavily,
    lens: searchGoogleLens,
    judge: async (bundle: ResearchBundle) => {
      const outcome = await finalJudgment(gateway ?? createGeminiGateway(), bundle);
      if (outcome.status !== 'SUCCESS' || !outcome.data) {
        const error = new Error(outcome.failureReason === 'RATE_LIMITED' ? 'Gemini quota exceeded' : outcome.failureReason ?? 'Gemini judgment failed');
        error.name = outcome.failureReason === 'RATE_LIMITED' ? 'GEMINI_QUOTA_ERROR' : 'GEMINI_ERROR';
        (error as Error & { verificationStatus?: VerificationStatus }).verificationStatus = outcome.verificationStatus;
        throw error;
      }
      return outcome.data;
    },
  };
}

export async function runIdentifyPipeline(
  images: PreparedImage[],
  providersOrGateway: ResearchProviders | GeminiGateway = defaultProviders(),
): Promise<IdentifyPipelineResult> {
  const providers = 'judge' in providersOrGateway ? providersOrGateway : defaultProviders(providersOrGateway);
  const ocrResults: OcrExtraction[] = await Promise.all(images.map(async (image) => {
    try {
      return await providers.ocr(image);
    } catch (error) {
      logProviderFailure(error);
      return { text: '', valid: false };
    }
  }));
  const ocrTexts = uniqueBy(ocrResults.filter((result) => result.valid).map((result) => result.text), (text) => text);
  let lensMatches: LensMatch[] = [];
  let queries = toJapaneseQueries(ocrTexts, []);
  let uniqueTavilyResults = await searchTavilyQueries(providers, queries, ocrTexts);
  let relevantTavilyResults = ocrTexts.length > 0
    ? uniqueTavilyResults.filter((result) => hasRelevantResult(result, ocrTexts))
    : uniqueTavilyResults;

  if (ocrTexts.length === 0 || relevantTavilyResults.length === 0) {
    lensMatches = await runLensFallback(providers, images);
    if (lensMatches.length > 0) {
      const lensQueries = toJapaneseQueries([], lensMatches);
      queries = [...queries, ...lensQueries];
      const lensTavilyResults = await searchTavilyQueries(providers, lensQueries, lensMatches.map((match) => match.title));
      uniqueTavilyResults = uniqueBy([...uniqueTavilyResults, ...lensTavilyResults], (result) => result.url).slice(0, 10);
      relevantTavilyResults = ocrTexts.length > 0
        ? uniqueTavilyResults.filter((result) => hasRelevantResult(result, [...ocrTexts, ...lensMatches.map((match) => match.title)]))
        : uniqueTavilyResults;
    }
  } else {
    console.info('[LENS FALLBACK]', false);
  }

  const seeds = candidateSeeds(relevantTavilyResults, lensMatches);
  console.info('[CANDIDATES]', JSON.stringify(seeds));
  const analysis = buildAnalysis(ocrTexts, queries, lensMatches);

  if (seeds.length === 0) {
    return {
      status: 'INSUFFICIENT',
      stages: { imageAnalysis: 'INSUFFICIENT', finalJudgment: 'SKIPPED' },
      candidates: [],
      analysis,
    };
  }

  const research: ResearchBundle = { ocrTexts, tavilyResults: uniqueTavilyResults, lensMatches, candidateSeeds: seeds };
  let judgedCandidates: Candidate[];
  try {
    judgedCandidates = normalizeCandidates(await providers.judge(research));
  } catch (error) {
    const fallbackKorean = await enrichKoreanInformation(fallbackCandidates(seeds), providers.tavily, ocrTexts);
    const fallback = fallbackKorean.candidates;
    if (fallback.length === 0) {
      return { status: 'FAILED', stages: { imageAnalysis: 'SUCCESS', finalJudgment: 'FAILED' }, candidates: [], analysis, verificationStatus: getVerificationStatus(error), failureStage: 'finalJudgment', failureReason: isQuotaError(error) ? 'RATE_LIMITED' : 'UPSTREAM_ERROR' };
    }
    return { status: 'PARTIAL_SUCCESS', stages: { imageAnalysis: 'SUCCESS', finalJudgment: 'FAILED' }, candidates: fallback, analysis, verificationStatus: getVerificationStatus(error), failureStage: 'finalJudgment', failureReason: isQuotaError(error) ? 'RATE_LIMITED' : 'UPSTREAM_ERROR' };
  }

  if (judgedCandidates.length === 0) {
    return { status: 'INSUFFICIENT', stages: { imageAnalysis: 'SUCCESS', finalJudgment: 'INSUFFICIENT' }, candidates: [], analysis };
  }

  const korean = await enrichKoreanInformation(judgedCandidates, providers.tavily, ocrTexts);
  analysis.searchQueries.korean = korean.queries;
  return {
    status: korean.hadFailure ? 'PARTIAL_SUCCESS' : 'SUCCESS',
    stages: { imageAnalysis: 'SUCCESS', finalJudgment: 'SUCCESS' },
    candidates: korean.candidates,
    analysis,
    ...(korean.hadFailure ? { failureStage: 'finalJudgment' as const, failureReason: 'UPSTREAM_ERROR' as const } : {}),
  };
}
