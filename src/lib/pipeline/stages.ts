import { z } from 'zod';
import { candidateSchema } from '../domain/schemas';
import { contentTypes, evidenceCodes, type Candidate, type StageStatus } from '../domain/types';
import { getConfiguredModel, type AzureFoundryGateway } from '../ai/azure-foundry-gateway';
import { canonicalResolverPrompt, canonicalResolverSystemPrompt, finalJudgmentPrompt, finalJudgmentSystemPrompt, ocrRefinerPrompt, ocrRefinerSystemPrompt } from '../ai/prompts';
import { classifyUpstreamError, generateJson, getStageTimeoutMs, isQuotaError, StageExecutionError, withStageTimeout, type StageOutcome } from './stage-utils';
import type { ResearchBundle, ResearchCandidate } from '../search/types';
import { findMatchingKoreanTitle, isJapaneseTitleText, normalizeKoreanSearchTranslation } from '../search/korean-title';
import type { OcrQueryRefinement } from '../search/query-refinement';
import { scoreOcrTitleCandidate } from '../search/query-refinement';
import { isJapaneseWorkSource } from '../search/work-title-verification';
import type { VerificationStatus } from '../domain/types';

const finalJudgmentSchema = z.object({ candidates: z.array(candidateSchema).max(3) });
const canonicalResolverCandidateSchema = z.object({
  rank: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  detectedTitle: z.string().min(1),
  contentType: z.enum(contentTypes),
  canonicalJapaneseTitle: z.string().min(1).nullable(),
  koreanSearchTranslation: z.string().max(120).nullable().optional().catch(null),
  titleVerificationStatus: z.enum(['VERIFIED', 'PARTIAL', 'UNVERIFIED']).optional(),
  relatedMangaCandidates: z.array(z.string()).max(5),
  reason: z.string().min(1),
  pronunciation: z.string().min(1).nullable().optional(),
  confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  evidence: z.array(z.enum(evidenceCodes)).min(1).max(5),
  author: z.string().min(1).nullable(),
});
const canonicalResolverSchema = z.object({ candidates: z.array(canonicalResolverCandidateSchema).max(3) });
type ResolverMetadata = {
  detectedTitle: string;
  contentType: string;
  canonicalJapaneseTitle: string | null;
  koreanSearchTranslation?: string | null;
  titleVerificationStatus?: 'VERIFIED' | 'PARTIAL' | 'UNVERIFIED';
  relatedMangaCandidates: string[];
  reason: string;
};
type JudgmentResult = { candidates: Array<Candidate & Partial<ResolverMetadata>> };
const ocrRefinerSchema = z.object({
  titleCandidates: z.array(z.object({ text: z.string().min(1), confidence: z.number().min(0).max(1) })).max(5),
  dialogueCandidates: z.array(z.object({ text: z.string().min(1), confidence: z.number().min(0).max(1) })).max(5),
  contextKeywords: z.array(z.string()).max(10),
  noise: z.array(z.string()).max(20),
  hasUsefulText: z.boolean(),
});

function safeDiagnosticText(value: string): string {
  return value
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Z]{2,}\b/giu, '[EMAIL]')
    .replace(/https?:\/\/\S+/giu, '[URL]')
    .replace(/@[\p{L}\p{N}_.-]{2,}/gu, '[ACCOUNT]')
    .slice(0, 160);
}

function normalizeKoreanVerifierResponse(value: unknown): unknown {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { candidates?: unknown }).candidates)) return value;

  const candidates = (value as { candidates: unknown[] }).candidates;
  const evidenceCounts = candidates.map((candidate) => (
    candidate && typeof candidate === 'object' && Array.isArray((candidate as { evidence?: unknown }).evidence)
      ? (candidate as { evidence: unknown[] }).evidence.length
      : null
  ));
  if (process.env.NODE_ENV !== 'production') console.info('[FOUNDRY EVIDENCE COUNT BEFORE NORMALIZE]', evidenceCounts);

  const normalized = {
    ...(value as Record<string, unknown>),
    candidates: candidates.map((candidate) => {
      if (!candidate || typeof candidate !== 'object' || !Array.isArray((candidate as { evidence?: unknown }).evidence)) return candidate;
      return {
        ...(candidate as Record<string, unknown>),
        evidence: (candidate as { evidence: unknown[] }).evidence.slice(0, 5),
      };
    }),
  };
  if (process.env.NODE_ENV !== 'production') console.info('[FOUNDRY EVIDENCE COUNT AFTER NORMALIZE]', (normalized.candidates as Array<{ evidence?: unknown[] }>).map((candidate) => candidate.evidence?.length ?? null));
  return normalized;
}

function normalizeCanonicalResolverResponse(value: unknown): unknown {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { candidates?: unknown }).candidates)) return value;
  return {
    ...(value as Record<string, unknown>),
    candidates: (value as { candidates: unknown[] }).candidates.filter((candidate) => {
      if (!candidate || typeof candidate !== 'object') return true;
      const item = candidate as Record<string, unknown>;
      return !(item.contentType === 'UNKNOWN' && item.canonicalJapaneseTitle === null
        && item.titleVerificationStatus === 'UNVERIFIED' && Array.isArray(item.evidence) && item.evidence.length === 0);
    }).map((candidate) => (
      candidate && typeof candidate === 'object' && Array.isArray((candidate as { evidence?: unknown }).evidence)
        ? { ...(candidate as Record<string, unknown>), evidence: (candidate as { evidence: unknown[] }).evidence.slice(0, 5) }
        : candidate
    )),
  };
}

function normalizeTitle(value: string): string {
  return value.replace(/\s+/gu, '').toLocaleLowerCase();
}

function normalizeJapaneseEvidence(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('ja').replace(/[\s\p{P}\p{S}]/gu, '');
}

function includesFullTitle(source: string, title: string): boolean {
  const normalizedTitle = normalizeJapaneseEvidence(title);
  return normalizedTitle.length >= 3 && normalizeJapaneseEvidence(source).includes(normalizedTitle);
}

function isRelatedTitle(left: string, right: string): boolean {
  const normalizedLeft = normalizeJapaneseEvidence(left);
  const normalizedRight = normalizeJapaneseEvidence(right);
  return normalizedLeft.length >= 4 && normalizedRight.length >= 4
    && (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft));
}

function getCanonicalTitleEvidenceSources(candidate: Candidate & ResolverMetadata, research: ResearchBundle): string[] {
  const canonicalTitle = candidate.canonicalJapaneseTitle;
  if (!canonicalTitle) return [];
  const detectedTitle = candidate.detectedTitle;
  const related = (title: string) => isRelatedTitle(title, detectedTitle) || isRelatedTitle(title, canonicalTitle);
  const sources = new Set<string>();

  research.candidateClusters?.forEach((cluster) => {
    if (![cluster.candidateTitle, ...cluster.signals].some(related)) return;
    if (cluster.lensEvidence.some((item) => isJapaneseWorkSource({ url: item.sourceUrl }) && [item.candidateTitle, item.title, item.context ?? ''].some((source) => includesFullTitle(source, canonicalTitle)))) {
      sources.add('LENS');
    }
    if (cluster.tavilyEvidence.some((item) => isJapaneseWorkSource(item) && [item.title, item.content].some((source) => includesFullTitle(source, canonicalTitle)))) {
      sources.add('TAVILY');
    }
  });

  research.tavilyResults.forEach((result) => {
    if (!isJapaneseWorkSource(result)) return;
    const queryTitle = result.searchCandidateTitle;
    const belongsToCandidate = queryTitle
      ? related(queryTitle)
      : [result.title, result.content].some((source) => includesFullTitle(source, detectedTitle));
    if (belongsToCandidate && [result.title, result.content].some((source) => includesFullTitle(source, canonicalTitle))) sources.add('TAVILY');
  });
  research.lensMatches.forEach((match) => {
    if (!isJapaneseWorkSource({ url: match.link })) return;
    if ([match.title, match.snippet ?? ''].some((source) => includesFullTitle(source, canonicalTitle))
      && (related(match.title) || includesFullTitle(match.title, detectedTitle))) sources.add('LENS');
  });
  return [...sources];
}

function hasVerifiedCanonicalTitle(candidate: Candidate & ResolverMetadata, research: ResearchBundle): boolean {
  return candidate.titleVerificationStatus !== 'PARTIAL'
    && candidate.titleVerificationStatus !== 'UNVERIFIED'
    && getCanonicalTitleEvidenceSources(candidate, research).length > 0;
}

function applyKoreanTitleEvidence(candidates: Candidate[], research: ResearchBundle): Candidate[] {
  const officialTitles = research.koreanOfficialTitleCandidates ?? [];
  const commonTitles = research.koreanCommonTitleCandidates ?? [];
  const translation = normalizeKoreanSearchTranslation(research.koreanSearchTranslation);
  const verifiedAliases = [...new Map((research.koreanVerifiedAliases ?? [])
    .filter((title) => normalizeKoreanSearchTranslation(title) !== null)
    .map((title) => [normalizeTitle(title), title])).values()];
  return candidates.map((candidate) => {
    if (verifiedAliases.length === 1) {
      const title = verifiedAliases[0];
      const official = officialTitles.some((item) => normalizeTitle(item) === normalizeTitle(title));
      const common = commonTitles.some((item) => normalizeTitle(item) === normalizeTitle(title));
      return {
        ...candidate,
        koreanTitle: title,
        koreanTitleStatus: official ? 'OFFICIAL' as const : common ? 'COMMON' as const : 'TRANSLATED' as const,
        publicationStatus: official ? candidate.publicationStatus : 'UNKNOWN' as const,
      };
    }
    if (isJapaneseTitleText(candidate.koreanTitle) || (!candidate.koreanTitle && translation)) {
      return { ...candidate, koreanTitle: translation, koreanTitleStatus: translation ? 'TRANSLATED' as const : 'UNKNOWN' as const, publicationStatus: 'UNKNOWN' as const };
    }
    const officialTitle = findMatchingKoreanTitle(candidate.koreanTitle ?? '', officialTitles);
    const commonTitle = findMatchingKoreanTitle(candidate.koreanTitle ?? '', commonTitles);
    if (officialTitle) return { ...candidate, koreanTitle: officialTitle, koreanTitleStatus: 'OFFICIAL' as const };
    if (commonTitle) return { ...candidate, koreanTitle: commonTitle, koreanTitleStatus: 'COMMON' as const, publicationStatus: candidate.publicationStatus === 'CONFIRMED' ? 'UNKNOWN' as const : candidate.publicationStatus };
    if (translation) {
      const observedTitle = candidate.koreanTitle && (research.koreanTitleCandidates ?? []).some((title) => normalizeTitle(title) === normalizeTitle(candidate.koreanTitle ?? ''))
        && (research.koreanResults ?? []).some((result) => includesFullTitle(`${result.title} ${result.content}`, candidate.japaneseTitle)
          && normalizeTitle(`${result.title} ${result.content}`).includes(normalizeTitle(candidate.koreanTitle ?? '')));
      return { ...candidate, koreanTitle: observedTitle ? candidate.koreanTitle : translation, koreanTitleStatus: 'TRANSLATED' as const, publicationStatus: 'UNKNOWN' as const };
    }
    if (candidate.koreanTitleStatus === 'OFFICIAL' || candidate.koreanTitleStatus === 'COMMON') {
      return { ...candidate, koreanTitleStatus: candidate.koreanTitle ? 'TRANSLATED' as const : 'UNKNOWN' as const, publicationStatus: officialTitles.length === 0 ? 'UNKNOWN' as const : candidate.publicationStatus };
    }
    return officialTitles.length === 0 && candidate.publicationStatus === 'CONFIRMED'
      ? { ...candidate, publicationStatus: 'UNKNOWN' as const }
      : candidate;
  });
}

export async function refineOcrForSearch(gateway: AzureFoundryGateway, rawText: string): Promise<OcrQueryRefinement> {
  const result = await withStageTimeout(
    generateJson(gateway, {
      model: getConfiguredModel(),
      systemPrompt: ocrRefinerSystemPrompt,
      userPrompt: ocrRefinerPrompt(rawText),
    }, ocrRefinerSchema),
    getStageTimeoutMs(),
  );
  const titleCandidates = result.titleCandidates
    .filter((candidate) => candidate.confidence >= 0.65 && scoreOcrTitleCandidate(candidate.text).accepted)
    .map((candidate) => candidate.text);
  const dialogueCandidates = result.dialogueCandidates.filter((candidate) => candidate.confidence >= 0.5).map((candidate) => candidate.text);
  const queryType = titleCandidates.length > 0 ? 'TITLE' : dialogueCandidates.length > 0 ? 'DIALOGUE' : 'NONE';
  return { rawText, titleCandidates, dialogueCandidates, contextKeywords: result.contextKeywords, noise: result.noise, hasUsefulText: result.hasUsefulText, queryType };
}

async function generateJudgment(
  gateway: AzureFoundryGateway,
  model: string,
  research: ResearchBundle,
): Promise<ResearchCandidate[]> {
  const isKoreanVerification = Boolean(research.koreanResults);
  const schema = isKoreanVerification ? finalJudgmentSchema : canonicalResolverSchema;
  if (process.env.NODE_ENV !== 'production') {
    console.info('[FOUNDRY IDENTIFICATION INPUT]', {
      model,
      candidateSeedCount: research.candidateSeeds.length,
      lensMatchCount: research.lensMatches.length,
      tavilyResultCount: research.tavilyResults.length,
      evidenceClusterCount: research.candidateClusters?.length ?? 0,
    });
  }
  const result = await withStageTimeout(
    generateJson<JudgmentResult>(
      gateway,
      { model, systemPrompt: isKoreanVerification ? finalJudgmentSystemPrompt : canonicalResolverSystemPrompt, userPrompt: isKoreanVerification ? finalJudgmentPrompt(research) : canonicalResolverPrompt(research) },
      schema as z.ZodType<JudgmentResult>,
      isKoreanVerification ? 'FOUNDRY KOREAN' : 'CANONICAL',
      isKoreanVerification ? normalizeKoreanVerifierResponse : normalizeCanonicalResolverResponse,
    ),
    getStageTimeoutMs(),
  );
  if (!isKoreanVerification && process.env.NODE_ENV !== 'production') {
    console.info('[CANONICAL TITLE VALIDATION]', result.candidates.map((candidate) => {
      const resolverCandidate = candidate as Candidate & ResolverMetadata;
      const titleEvidenceSources = getCanonicalTitleEvidenceSources(resolverCandidate, research);
      const titleVerificationStatus = resolverCandidate.titleVerificationStatus
        ?? (titleEvidenceSources.length > 0 ? 'VERIFIED' : 'UNVERIFIED');
      return {
        contentType: resolverCandidate.contentType,
        titleVerificationStatus,
        titleEvidenceSources,
        partialTitleDetected: titleVerificationStatus === 'PARTIAL',
        finalSelectionReason: titleVerificationStatus === 'PARTIAL'
          ? 'PARTIAL_TITLE'
          : titleVerificationStatus === 'UNVERIFIED'
            ? 'NO_FULL_TITLE_EVIDENCE'
            : 'FULL_TITLE_EVIDENCE',
      };
    }));
  }
  if (process.env.NODE_ENV !== 'production') console.info('[FOUNDRY IDENTIFICATION OUTPUT]', { candidateCount: result.candidates.length });
  if (process.env.NODE_ENV !== 'production') {
    console.info('[FOUNDRY STRUCTURED OUTPUT]', result.candidates.map((candidate) => {
      if (isKoreanVerification) {
        const koreanCandidate = candidate as Candidate;
        return {
          japaneseTitle: safeDiagnosticText(koreanCandidate.japaneseTitle),
          koreanTitle: safeDiagnosticText(koreanCandidate.koreanTitle ?? ''),
          koreanTitleStatus: koreanCandidate.koreanTitleStatus,
          publicationStatus: koreanCandidate.publicationStatus,
          confidence: koreanCandidate.confidence,
        };
      }
      const resolverCandidate = candidate as Candidate & ResolverMetadata;
      return {
        detectedTitle: safeDiagnosticText(resolverCandidate.detectedTitle),
        canonicalJapaneseTitle: safeDiagnosticText(resolverCandidate.canonicalJapaneseTitle ?? ''),
        contentType: resolverCandidate.contentType,
        titleVerificationStatus: resolverCandidate.titleVerificationStatus ?? 'UNSPECIFIED',
        confidence: resolverCandidate.confidence,
      };
    }));
  }
  const candidates = isKoreanVerification
    ? applyKoreanTitleEvidence(result.candidates as Candidate[], research)
    : result.candidates.reduce<ResearchCandidate[]>((resolved, candidate) => {
      const resolverCandidate = candidate as Candidate & ResolverMetadata;
      const canonicalJapaneseTitle = resolverCandidate.canonicalJapaneseTitle;
      if (!canonicalJapaneseTitle || !hasVerifiedCanonicalTitle(resolverCandidate, research)) return resolved;
      const next: ResearchCandidate = {
        rank: candidate.rank,
        japaneseTitle: canonicalJapaneseTitle,
        koreanSearchTranslation: normalizeKoreanSearchTranslation(resolverCandidate.koreanSearchTranslation),
        pronunciation: candidate.pronunciation ?? null,
        koreanTitle: null,
        koreanTitleStatus: 'UNKNOWN' as const,
        publicationStatus: 'UNKNOWN' as const,
        confidence: candidate.confidence,
        evidence: candidate.evidence,
        author: candidate.author,
        koreanInvestigationStatus: 'SKIPPED' as const,
      };
      const existingIndex = resolved.findIndex((item) => normalizeJapaneseEvidence(item.japaneseTitle) === normalizeJapaneseEvidence(canonicalJapaneseTitle));
      if (existingIndex < 0) {
        resolved.push(next);
      } else {
        const existing = resolved[existingIndex];
        const levels = ['LOW', 'MEDIUM', 'HIGH'];
        const primary = levels.indexOf(next.confidence) > levels.indexOf(existing.confidence) ? next : existing;
        const secondary = primary === next ? existing : next;
        resolved[existingIndex] = {
          ...primary,
          rank: existing.rank,
          evidence: [...new Set([...primary.evidence, ...secondary.evidence])].slice(0, 5),
        };
      }
      return resolved;
    }, []);
  if (!isKoreanVerification && process.env.NODE_ENV !== 'production') {
    console.info('[DETECTED CONTENT TYPE]', result.candidates[0]?.contentType ?? 'UNKNOWN');
    console.info('[CANONICAL TITLE RESOLVED]', { hasTitle: Boolean(candidates[0]?.japaneseTitle), evidenceCount: result.candidates[0]?.evidence.length ?? 0 });
  }
  if (research.koreanResults && process.env.NODE_ENV !== 'production') {
    console.info('[KOREAN FINAL RESULT]', {
      status: candidates[0]?.koreanTitleStatus ?? 'UNKNOWN',
      publicationStatus: candidates[0]?.publicationStatus ?? 'UNKNOWN',
      hasTitle: Boolean(candidates[0]?.koreanTitle),
    });
  }
  return candidates;
}

export async function finalJudgment(
  gateway: AzureFoundryGateway,
  research: ResearchBundle,
): Promise<StageOutcome<ResearchCandidate[]>> {
  try {
    const candidates = await generateJudgment(gateway, getConfiguredModel(), research);
    if (candidates.length === 0) return { status: 'INSUFFICIENT', data: [], verificationStatus: 'INSUFFICIENT_EVIDENCE' };
    return { status: 'SUCCESS', data: candidates, verificationStatus: 'VERIFIED' };
  } catch (error) {
    if (error instanceof StageExecutionError) {
      if (process.env.NODE_ENV !== 'production' && error.reason === 'INVALID_MODEL_RESPONSE') {
        console.error(JSON.stringify({
          event: 'azure_foundry_schema_validation_failed',
          stage: research.koreanResults ? 'korean_verification' : 'canonical_identification',
          issuePaths: error.issuePaths,
        }));
      }
      return { status: error.reason === 'TIMEOUT' ? 'TIMEOUT' : 'FAILED', failureReason: error.reason };
    }
    console.error(JSON.stringify({ event: 'azure_foundry_stage_error', stage: 'finalJudgment', reason: classifyUpstreamError(error) }));
    return { status: 'FAILED', failureReason: 'UPSTREAM_ERROR', verificationStatus: 'AI_UNAVAILABLE' };
  }
}
