import type { Candidate, IdentifyStatus, ImageAnalysis, PreparedImage, StageStatus, VerificationStatus } from '../domain/types';
import type { AzureFoundryGateway } from '../ai/azure-foundry-gateway';
import { createAzureFoundryGateway } from '../ai/azure-foundry-gateway';
import { finalJudgment, refineOcrForSearch } from './stages';
import { isQuotaError } from './stage-utils';
import { extractJapaneseText } from '../search/ocr-space';
import { searchTavily } from '../search/tavily';
import { searchGoogleLens } from '../search/serpapi';
import type { EvidenceCluster, LensDiagnostic, LensMatch, OcrExtraction, ResearchBundle, ResearchProviders, WebSearchResult } from '../search/types';
import { ExternalProviderError, uniqueBy } from '../search/provider-utils';
import { buildRefinedJapaneseQueries, refineOcrQueries } from '../search/query-refinement';
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
  return {
    candidateTitle: signal,
    signals: [signal],
    lensEvidence: [],
    tavilyEvidence: [],
    independentSourceCount: 0,
    lensEvidenceCount: 0,
    tavilyEvidenceCount: 0,
    mangaSignals: [],
    nonMangaSignals: [],
  };
}

function addClusterSignal(cluster: EvidenceCluster, signal: string, kind: 'LENS' | 'TAVILY', source: string): void {
  if (!cluster.signals.some((existing) => similarEvidenceSignal(existing, signal))) cluster.signals.push(signal);
  const normalizedSource = source.toLocaleLowerCase();
  if (mangaContextPattern.test(signal)) cluster.mangaSignals.push(signal);
  if (nonMangaPattern.test(`${signal} ${source}`)) cluster.nonMangaSignals.push(signal);
  if (kind === 'LENS') cluster.lensEvidenceCount += 1;
  else cluster.tavilyEvidenceCount += 1;
  if (normalizedSource && !cluster.lensEvidence.some((evidence) => evidence.source.toLocaleLowerCase() === normalizedSource)
    && !cluster.tavilyEvidence.some((evidence) => evidence.url.toLocaleLowerCase().includes(normalizedSource))) {
    cluster.independentSourceCount += 1;
  }
}

function buildEvidenceClusters(
  lensMatches: LensMatch[],
  tavilyResults: WebSearchResult[],
  titleCandidates: string[] = [],
): EvidenceCluster[] {
  const clusters: EvidenceCluster[] = [];
  const assign = (signal: string, kind: 'LENS' | 'TAVILY', source: string, evidence: LensMatch | WebSearchResult): void => {
    let cluster = clusters.find((candidate) => candidate.signals.some((existing) => similarEvidenceSignal(existing, signal)));
    if (!cluster) {
      cluster = createEvidenceCluster(signal);
      clusters.push(cluster);
    }
    addClusterSignal(cluster, signal, kind, source);
    if (kind === 'LENS') {
      const match = evidence as LensMatch;
      if (!cluster.lensEvidence.some((item) => item.link === match.link)) cluster.lensEvidence.push({ title: match.title, source: match.source, link: match.link });
    } else {
      const result = evidence as WebSearchResult;
      if (!cluster.tavilyEvidence.some((item) => item.url === result.url)) cluster.tavilyEvidence.push({ title: result.title, url: result.url });
    }
  };

  for (const match of lensMatches) {
    for (const signal of extractEvidenceSignals(match.title, match.source)) assign(signal, 'LENS', match.source || match.link, match);
  }
  for (const result of tavilyResults) {
    for (const signal of extractEvidenceSignals(result.title, result.content).slice(0, 2)) assign(signal, 'TAVILY', result.url, result);
  }
  for (const title of titleCandidates) assign(title, 'TAVILY', 'ocr', { title, url: 'ocr', content: '', score: null });

  return clusters
    .map((cluster) => ({
      ...cluster,
      candidateTitle: [...cluster.signals].sort((left, right) => right.length - left.length)[0] ?? cluster.candidateTitle,
      mangaSignals: uniqueBy(cluster.mangaSignals, normalizeEvidenceSignal),
      nonMangaSignals: uniqueBy(cluster.nonMangaSignals, normalizeEvidenceSignal),
      independentSourceCount: new Set([
        ...cluster.lensEvidence.map((evidence) => evidence.source || evidence.link),
        ...cluster.tavilyEvidence.map((evidence) => evidence.url),
      ]).size,
    }))
    .sort((left, right) => {
      const score = (cluster: EvidenceCluster) => cluster.mangaSignals.length * 4
        + Math.min(cluster.lensEvidenceCount, 3) * 2
        + Math.min(cluster.independentSourceCount, 4) * 2
        - cluster.nonMangaSignals.length * 3;
      return score(right) - score(left) || right.independentSourceCount - left.independentSourceCount;
    })
    .slice(0, 10);
}

function buildClusterQueries(clusters: EvidenceCluster[]): string[] {
  return uniqueBy(
    clusters.filter((cluster) => cluster.candidateTitle.length >= 2).slice(0, 2).map((cluster) => `${cluster.candidateTitle} 漫画`),
    (query) => query,
  );
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
  const selectedImage = selectLensImage(images);
  const selectedIndex = images.indexOf(selectedImage);
  if (process.env.NODE_ENV !== 'production') {
    console.info('[LENS FALLBACK]', { status: 'STARTED', reason });
    console.info('[LENS SELECTED IMAGE]', {
      index: selectedIndex,
      mimeType: selectedImage.mimeType,
      size: selectedImage.buffer.length,
    });
  }
  assertDeadline(deadlineAt);
  try {
    const matches = await providers.lens(selectedImage);
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
    };
    const emptyMatches = [] as LensMatch[] & { diagnostic?: LensDiagnostic };
    emptyMatches.diagnostic = diagnostic;
    return emptyMatches;
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

function candidateSeeds(tavilyResults: WebSearchResult[], lensMatches: LensMatch[], titleCandidates: string[] = []): string[] {
  const lensCandidateDetails = uniqueBy(lensMatches.map((match) => ({
    title: match.title
      .replace(/\s*(?:第\s*\d+\s*(?:話|巻|章)|chapter\s*\d+|episode\s*\d+).*$/iu, '')
      .replace(/\b(?:manga|comic|official|chapter|episode)\b/giu, '')
      .replace(/\s+/gu, ' ')
      .trim(),
    sourceIndex: match.sourceIndex ?? null,
  })).filter(({ title }) => title.length >= 2), ({ title }) => title).slice(0, 5);
  const lensCandidateClues = lensCandidateDetails.map(({ title }) => title);
  if (process.env.NODE_ENV !== 'production') {
    console.info('[LENS CANDIDATE EXTRACTION]', {
      inputVisualMatchCount: lensMatches.length,
      outputCandidateCount: lensCandidateClues.length,
    });
    lensCandidateDetails.forEach((candidate) => console.info({ candidateTitle: candidate.title, sourceVisualMatchIndex: candidate.sourceIndex, reason: 'normalized non-empty Lens title' }));
    console.info('[LENS CANDIDATES]', lensCandidateClues);
  }
  return uniqueBy([
    ...titleCandidates,
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

function preserveKoreanInvestigationStatus(candidates: Candidate[], investigatedCandidates: Candidate[]): Candidate[] {
  return candidates.map((candidate) => {
    const investigated = investigatedCandidates.find((item) => (
      cleanJapaneseTitle(item.japaneseTitle) === cleanJapaneseTitle(candidate.japaneseTitle)
    ));
    return investigated ? { ...candidate, koreanInvestigationStatus: investigated.koreanInvestigationStatus } : candidate;
  });
}

function extractJapaneseTitle(value: string): string {
  const parts = value.match(/[\u3040-\u30ff\u3400-\u9fff][\u3040-\u30ff\u3400-\u9fff\s・「」『』]{1,}/gu) ?? [];
  return parts.join(' ').replace(/[「」『』]/gu, '').replace(/\s+/gu, ' ').trim().slice(0, 80);
}

function normalizedKoreanText(value: string): string {
  return value.replace(/\s+/gu, '').toLocaleLowerCase();
}

function getSourceDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./u, ''); } catch { return url; }
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
  candidates: Candidate[],
  tavily: ResearchProviders['tavily'],
  deadlineAt = Date.now() + getTotalTimeoutMs(),
): Promise<{ candidates: Candidate[]; hadFailure: boolean; queries: string[]; results: WebSearchResult[]; titleCandidates: string[]; official: string[]; common: string[] }> {
  const japaneseTitle = extractJapaneseTitle(candidates[0]?.japaneseTitle ?? '');
  const queries: string[] = [];
  let hadFailure = false;
  let results: WebSearchResult[] = [];
  if (process.env.NODE_ENV !== 'production') {
    console.info('[CANONICAL JAPANESE TITLE]', japaneseTitle);
    console.info('[KOREAN INVESTIGATION START]', { japaneseTitle });
  }

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

  const titleEvidence = (items: WebSearchResult[]) => {
    const evidence = new Map<string, { count: number; domains: Set<string>; official: boolean }>();
    for (const item of items) {
      let domain = item.url;
      try { domain = new URL(item.url).hostname.replace(/^www\./u, ''); } catch { /* keep the URL as a stable source key */ }
      const haystack = `${item.title} ${item.content}`;
      const official = /정발|정식(?:출판|발매)|정식 한국어판|한국어판|한국판|국내 출판|번역 출간/u.test(haystack)
        || /kyobobook|yes24|aladin|ridibooks|ridi\.|series\.naver|page\.kakao|publisher|출판사/u.test(item.url.toLowerCase());
      const matches = haystack.match(/[가-힣][가-힣0-9·&'’' -]{1,}/gu) ?? [];
      for (const match of matches) {
        const candidate = match.replace(/\s+(?:\d+권?|한국어판|만화책|eBook|전자책|단행본|세트|정발|공식|판매|출간|출판)+\s*$/giu, '').replace(/\s+/gu, ' ').trim();
        if (candidate.length < 3 || /^(공식|판매|정발|출판|출간|한국어|제목|만화|만화책|도서|전자책|eBook)$/u.test(candidate)) continue;
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
    if (process.env.NODE_ENV !== 'production') console.info('[KOREAN SEARCH QUERY]', { number, query });
    assertDeadline(deadlineAt);
    try {
      const response = await tavily(query);
      assertDeadline(deadlineAt);
      results = uniqueBy([...results, ...response], (result) => result.url).slice(0, 20);
      if (process.env.NODE_ENV !== 'production') console.info('[KOREAN TAVILY RAW RESULTS]', { count: response.length, results: response });
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
  const classifiedTitles = titleEvidence(results);
  if (process.env.NODE_ENV !== 'production') {
    console.info('[KOREAN TITLE CANDIDATE]', { candidate: koreanTitleCandidate });
    console.info('[KOREAN EVIDENCE]', { evidenceCount: results.length, results });
    console.info('[KOREAN SEARCH RAW RESULTS]', results);
    console.info('[OFFICIAL TITLE CANDIDATES]', classifiedTitles.official);
    console.info('[COMMON TITLE CANDIDATES]', classifiedTitles.common);
    console.info('[COMMON TITLE EVIDENCE]', { candidates: classifiedTitles.common, sourceCount: results.length });
  }
  const enriched = candidates.map((candidate) => ({
    ...candidate,
    koreanInvestigationStatus: results.length > 0 ? 'SUCCESS' as const : 'INSUFFICIENT' as const,
  }));
  return { candidates: enriched, hadFailure, queries, results, titleCandidates, ...classifiedTitles };
}

function defaultProviders(gateway?: AzureFoundryGateway): ResearchProviders {
  return {
    ocr: extractJapaneseText,
    tavily: searchTavily,
    lens: searchGoogleLens,
    refineOcr: async (rawText) => {
      try {
        return await refineOcrForSearch(gateway ?? createAzureFoundryGateway(), rawText);
      } catch (error) {
        if (process.env.NODE_ENV !== 'production') console.info('[FOUNDRY OCR REFINER FALLBACK]', { reason: String(error) });
        return refineOcrQueries([rawText]);
      }
    },
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
      if (outcome.status === 'INSUFFICIENT') return [];
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
  const rawOcrText = ocrResults.map((result) => result.rawText ?? result.text).filter(Boolean).join('\n');
  const refinement = providers.refineOcr
    ? await providers.refineOcr(rawOcrText)
    : refineOcrQueries([rawOcrText]);
  const searchClues = refinement.queryType === 'TITLE' ? refinement.titleCandidates : refinement.dialogueCandidates;
  if (process.env.NODE_ENV !== 'production') {
    console.info('[OCR RAW]', refinement.rawText);
    console.info('[OCR RESULT]', ocrTexts);
    console.info('[OCR DECISION]', refinement.hasUsefulText && refinement.queryType !== 'NONE' ? 'USEFUL' : 'INSUFFICIENT');
    console.info('[QUERY REFINEMENT]', {
      titleCandidates: refinement.titleCandidates,
      dialogueCandidates: refinement.dialogueCandidates,
      noise: refinement.noise,
      queryType: refinement.queryType,
    });
  }
  let lensMatches: LensMatch[] = [];
  let queries = buildRefinedJapaneseQueries(refinement);
  if (process.env.NODE_ENV !== 'production') console.info('[REFINED JAPANESE QUERY]', queries);
  let uniqueTavilyResults = await searchTavilyQueries(providers, queries, searchClues, deadlineAt);
  let relevantTavilyResults = searchClues.length > 0
    ? uniqueTavilyResults.filter((result) => hasRelevantResult(result, searchClues))
    : uniqueTavilyResults;

  if (ocrTexts.length === 0 || relevantTavilyResults.length === 0) {
    lensMatches = await runLensFallback(
      providers,
      images,
      deadlineAt,
      ocrTexts.length === 0 ? 'NO_USEFUL_OCR' : 'NO_RELEVANT_TAVILY',
    );
    if (lensMatches.length > 0) {
      const lensClusters = buildEvidenceClusters(lensMatches, [], refinement.titleCandidates);
      const lensQueries = buildClusterQueries(lensClusters);
      queries = [...queries, ...lensQueries];
      const lensTavilyResults = await searchTavilyQueries(providers, lensQueries, lensMatches.map((match) => match.title), deadlineAt);
      if (process.env.NODE_ENV !== 'production') {
        console.info('[TAVILY QUERIES FROM LENS]', lensQueries);
        console.info('[TAVILY RESULTS]', { queryCount: lensQueries.length, resultCount: lensTavilyResults.length });
      }
      uniqueTavilyResults = uniqueBy([...uniqueTavilyResults, ...lensTavilyResults], (result) => result.url).slice(0, 10);
      relevantTavilyResults = searchClues.length > 0
        ? uniqueTavilyResults.filter((result) => hasRelevantResult(result, [...searchClues, ...lensMatches.map((match) => match.title)]))
        : uniqueTavilyResults;
    }
  }

  const seeds = candidateSeeds(relevantTavilyResults, lensMatches, refinement.titleCandidates);
  const candidateClusters = buildEvidenceClusters(lensMatches, uniqueTavilyResults, refinement.titleCandidates);
  const clusteredSeeds = uniqueBy([
    ...candidateClusters.filter((cluster) => cluster.mangaSignals.length > 0).map((cluster) => cluster.candidateTitle),
    ...seeds,
  ], (title) => title).slice(0, 10);
  if (process.env.NODE_ENV !== 'production') {
    console.info('[IDENTIFICATION PATH]', lensMatches.length > 0 ? 'LENS_TAVILY_FOUNDRY' : 'OCR_TAVILY_FOUNDRY');
    console.info('[FOUNDRY IDENTIFICATION INPUT]', {
      candidateSeeds: clusteredSeeds,
      candidateClusters,
      lensMatches: lensMatches.map(({ title, source, link }) => ({ title, source, link })),
      tavilyResultCount: uniqueTavilyResults.length,
      tavilyCandidates: uniqueTavilyResults.map(({ title, url }) => ({ title, url })),
    });
  }
  const analysis = buildAnalysis(ocrTexts, queries, lensMatches);

  if (process.env.NODE_ENV !== 'production') {
    const diagnostic = (lensMatches as LensMatch[] & { diagnostic?: LensDiagnostic }).diagnostic;
    console.info('[LENS DIAGNOSIS]', {
      stage: diagnostic?.stage ?? 'CANDIDATE_EXTRACTION',
      uploadStatus: diagnostic?.uploadStatus ?? null,
      imageIdExists: diagnostic?.imageIdExists ?? false,
      searchStatus: diagnostic?.searchStatus ?? null,
      visualMatchCount: diagnostic?.visualMatchCount ?? lensMatches.length,
      candidateCount: clusteredSeeds.length,
      classification: diagnostic?.stage === 'UPLOAD' ? 'B' : diagnostic?.stage === 'SEARCH' || diagnostic?.stage === 'PARSE' ? 'C' : diagnostic?.visualMatchCount === 0 ? 'D' : clusteredSeeds.length === 0 ? 'E' : 'SUCCESS',
    });
  }

  if (clusteredSeeds.length === 0) {
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
    };
  }

  const research: ResearchBundle = {
    ocrTexts,
    tavilyResults: uniqueTavilyResults,
    lensMatches,
    candidateSeeds: clusteredSeeds,
    candidateClusters,
  };
  assertDeadline(deadlineAt);
  let canonicalCandidates: Candidate[];
  let canonicalFailure: unknown;
  try {
    canonicalCandidates = normalizeCandidates(await providers.judge(research));
    assertDeadline(deadlineAt);
    if (process.env.NODE_ENV !== 'production') console.info('[CANONICAL JAPANESE TITLE]', canonicalCandidates[0]?.japaneseTitle ?? null);
  } catch (error) {
    if (error instanceof RequestDeadlineError) throw error;
    const fallback = selectSingleCandidate(fallbackCandidates(refinement.titleCandidates));
    if (fallback.length === 0) {
      return { status: 'FAILED', stages: { imageAnalysis: 'SUCCESS', finalJudgment: 'FAILED' }, candidates: [], analysis, verificationStatus: getVerificationStatus(error), failureStage: 'finalJudgment', failureReason: isQuotaError(error) ? 'RATE_LIMITED' : 'UPSTREAM_ERROR' };
    }
    canonicalCandidates = fallback;
    canonicalFailure = error;
    if (process.env.NODE_ENV !== 'production') console.info('[CANONICAL JAPANESE TITLE]', canonicalCandidates[0]?.japaneseTitle ?? null);
  }

  if (canonicalCandidates.length === 0) {
    if (process.env.NODE_ENV !== 'production') {
      console.info('[INSUFFICIENT REASON]', {
        reason: 'Foundry canonicalCandidates.length === 0',
        candidateSeedCount: seeds.length,
      });
    }
    return { status: 'INSUFFICIENT', stages: { imageAnalysis: 'SUCCESS', finalJudgment: 'INSUFFICIENT' }, candidates: [], analysis };
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
    koreanTitleCandidates: korean.titleCandidates,
    koreanOfficialTitleCandidates: korean.official,
    koreanCommonTitleCandidates: korean.common,
  };
  if (process.env.NODE_ENV !== 'production') {
    console.info('[KOREAN SEARCH INPUT]', canonicalJapaneseTitle);
    console.info('[KOREAN FOUNDRY INPUT]', {
      titleCandidate: verifiedResearch.koreanTitleCandidates?.[0] ?? null,
      evidenceCount: verifiedResearch.koreanResults?.length ?? 0,
      evidence: verifiedResearch.koreanResults ?? [],
      officialTitleCandidates: verifiedResearch.koreanOfficialTitleCandidates ?? [],
      commonTitleCandidates: verifiedResearch.koreanCommonTitleCandidates ?? [],
    });
  }
  let judgedCandidates: Candidate[];
  try {
    judgedCandidates = normalizeCandidates(await providers.judge(verifiedResearch));
    assertDeadline(deadlineAt);
  } catch (error) {
    if (error instanceof RequestDeadlineError) throw error;
    return {
      status: 'PARTIAL_SUCCESS',
      stages: { imageAnalysis: 'SUCCESS', finalJudgment: 'FAILED' },
      candidates: selectSingleCandidate(korean.candidates),
      analysis,
      verificationStatus: getVerificationStatus(error),
      failureStage: 'finalJudgment',
      failureReason: isQuotaError(error) ? 'RATE_LIMITED' : 'UPSTREAM_ERROR',
    };
  }

  let reverseSearchFailed = false;
  const translatedCandidate = judgedCandidates.find((candidate) => candidate.koreanTitle && candidate.koreanTitleStatus === 'TRANSLATED');
  const translatedTitle = translatedCandidate?.koreanTitle;
  if (translatedCandidate && translatedTitle && korean.official.length === 0 && korean.common.length === 0) {
    const reverseQuery = `"${translatedTitle}" "${extractJapaneseTitle(translatedCandidate.japaneseTitle)}"`;
    if (process.env.NODE_ENV !== 'production') console.info('[TRANSLATED TITLE CANDIDATE]', translatedTitle);
    if (process.env.NODE_ENV !== 'production') console.info('[COMMON REVERSE SEARCH QUERY]', reverseQuery);
    try {
      assertDeadline(deadlineAt);
      const reverseResults = await providers.tavily(reverseQuery);
      assertDeadline(deadlineAt);
      const commonEvidence = reverseResults.filter((result) => {
        const haystack = normalizedKoreanText(`${result.title} ${result.content}`);
        return haystack.includes(normalizedKoreanText(translatedTitle));
      });
      const commonVerified = hasRepeatedCommonEvidence(translatedTitle, extractJapaneseTitle(translatedCandidate.japaneseTitle), reverseResults);
      if (process.env.NODE_ENV !== 'production') {
        console.info('[COMMON SEARCH RESULTS]', reverseResults);
        console.info('[COMMON EVIDENCE COUNT]', commonEvidence.length);
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
        if (process.env.NODE_ENV !== 'production') console.info('[KOREAN FOUNDRY INPUT]', { commonReverse: true, evidenceCount: commonResearch.koreanResults?.length ?? 0, evidence: commonResearch.koreanResults });
        try {
          judgedCandidates = normalizeCandidates(await providers.judge(commonResearch));
          assertDeadline(deadlineAt);
        } catch (error) {
          if (error instanceof RequestDeadlineError) throw error;
          reverseSearchFailed = true;
        }
      }
    } catch (error) {
      if (error instanceof RequestDeadlineError) throw error;
      reverseSearchFailed = true;
    }
  }

  return {
    status: canonicalFailure || korean.hadFailure || reverseSearchFailed ? 'PARTIAL_SUCCESS' : 'SUCCESS',
    stages: { imageAnalysis: 'SUCCESS', finalJudgment: 'SUCCESS' },
    candidates: selectSingleCandidate(preserveKoreanInvestigationStatus(judgedCandidates, korean.candidates)),
    analysis,
    ...(canonicalFailure || korean.hadFailure || reverseSearchFailed ? { failureStage: 'finalJudgment' as const, failureReason: 'UPSTREAM_ERROR' as const } : {}),
  };
}
