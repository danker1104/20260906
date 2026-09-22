import { z } from 'zod';
import { candidateSchema } from '../domain/schemas';
import { contentTypes, evidenceCodes, type Candidate, type StageStatus } from '../domain/types';
import { getConfiguredModel, type AzureFoundryGateway } from '../ai/azure-foundry-gateway';
import { canonicalResolverPrompt, canonicalResolverSystemPrompt, finalJudgmentPrompt, finalJudgmentSystemPrompt, ocrRefinerPrompt, ocrRefinerSystemPrompt } from '../ai/prompts';
import { classifyUpstreamError, generateJson, getStageTimeoutMs, isQuotaError, StageExecutionError, withStageTimeout, type StageOutcome } from './stage-utils';
import type { ResearchBundle } from '../search/types';
import type { OcrQueryRefinement } from '../search/query-refinement';
import type { VerificationStatus } from '../domain/types';

const finalJudgmentSchema = z.object({ candidates: z.array(candidateSchema).max(3) });
const canonicalResolverCandidateSchema = z.object({
  rank: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  detectedTitle: z.string().min(1),
  contentType: z.enum(contentTypes),
  canonicalJapaneseTitle: z.string().min(1).nullable(),
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
    candidates: (value as { candidates: unknown[] }).candidates.map((candidate) => (
      candidate && typeof candidate === 'object' && Array.isArray((candidate as { evidence?: unknown }).evidence)
        ? { ...(candidate as Record<string, unknown>), evidence: (candidate as { evidence: unknown[] }).evidence.slice(0, 5) }
        : candidate
    )),
  };
}

function normalizeTitle(value: string): string {
  return value.replace(/\s+/gu, '').toLocaleLowerCase();
}

function applyKoreanTitleEvidence(candidates: Candidate[], research: ResearchBundle): Candidate[] {
  const officialTitles = research.koreanOfficialTitleCandidates ?? [];
  const commonTitles = research.koreanCommonTitleCandidates ?? [];
  return candidates.map((candidate) => {
    const officialTitle = officialTitles.find((title) => normalizeTitle(title) === normalizeTitle(candidate.koreanTitle ?? ''));
    const commonTitle = commonTitles.find((title) => normalizeTitle(title) === normalizeTitle(candidate.koreanTitle ?? ''));
    if (officialTitle) return { ...candidate, koreanTitle: officialTitle, koreanTitleStatus: 'OFFICIAL' as const };
    if (commonTitle) return { ...candidate, koreanTitle: commonTitle, koreanTitleStatus: 'COMMON' as const, publicationStatus: officialTitles.length === 0 && candidate.publicationStatus === 'CONFIRMED' ? 'UNKNOWN' as const : candidate.publicationStatus };
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
  const titleCandidates = result.titleCandidates.filter((candidate) => candidate.confidence >= 0.65).map((candidate) => candidate.text);
  const dialogueCandidates = result.dialogueCandidates.filter((candidate) => candidate.confidence >= 0.5).map((candidate) => candidate.text);
  const queryType = titleCandidates.length > 0 ? 'TITLE' : dialogueCandidates.length > 0 ? 'DIALOGUE' : 'NONE';
  return { rawText, titleCandidates, dialogueCandidates, contextKeywords: result.contextKeywords, noise: result.noise, hasUsefulText: result.hasUsefulText, queryType };
}

async function generateJudgment(
  gateway: AzureFoundryGateway,
  model: string,
  research: ResearchBundle,
): Promise<Candidate[]> {
  const isKoreanVerification = Boolean(research.koreanResults);
  const schema = isKoreanVerification ? finalJudgmentSchema : canonicalResolverSchema;
  if (process.env.NODE_ENV !== 'production') {
    console.info('[FOUNDRY IDENTIFICATION INPUT]', {
      model,
      candidateSeeds: research.candidateSeeds,
      lensMatches: research.lensMatches.map(({ title, source, link }) => ({ title, source, link })),
      tavilyResultCount: research.tavilyResults.length,
      tavilyEvidence: research.tavilyResults.map(({ title, url }) => ({ title, url })),
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
  if (process.env.NODE_ENV !== 'production') console.info('[FOUNDRY IDENTIFICATION OUTPUT]', result.candidates);
  const candidates = isKoreanVerification
    ? applyKoreanTitleEvidence(result.candidates as Candidate[], research)
    : result.candidates.reduce<Candidate[]>((resolved, candidate) => {
      const resolverCandidate = candidate as Candidate & ResolverMetadata;
      if (!resolverCandidate.canonicalJapaneseTitle) return resolved;
      resolved.push({
        rank: candidate.rank,
        japaneseTitle: resolverCandidate.canonicalJapaneseTitle,
        pronunciation: candidate.pronunciation ?? null,
        koreanTitle: null,
        koreanTitleStatus: 'UNKNOWN' as const,
        publicationStatus: 'UNKNOWN' as const,
        confidence: candidate.confidence,
        evidence: candidate.evidence,
        author: candidate.author,
        koreanInvestigationStatus: 'SKIPPED' as const,
      });
      return resolved;
    }, []);
  if (!isKoreanVerification && process.env.NODE_ENV !== 'production') {
    console.info('[DETECTED TITLE]', result.candidates[0]?.detectedTitle ?? null);
    console.info('[DETECTED CONTENT TYPE]', result.candidates[0]?.contentType ?? 'UNKNOWN');
    console.info('[RELATED MANGA CANDIDATES]', result.candidates[0]?.relatedMangaCandidates ?? []);
    console.info('[CANONICAL RESOLVER EVIDENCE]', result.candidates[0]?.evidence ?? []);
    console.info('[CANONICAL JAPANESE TITLE]', candidates[0]?.japaneseTitle ?? null);
  }
  if (research.koreanResults && process.env.NODE_ENV !== 'production') {
    console.info('[FOUNDRY KOREAN RESULT]', result.candidates[0] ?? null);
    console.info('[KOREAN TITLE STATUS]', candidates[0]?.koreanTitleStatus ?? 'UNKNOWN');
    console.info('[FINAL KOREAN TITLE STATUS]', candidates[0]?.koreanTitleStatus ?? 'UNKNOWN');
    console.info('[FINAL KOREAN TITLE]', candidates[0]?.koreanTitle ?? null);
    console.info('[KOREAN FINAL RESULT]', candidates[0] ?? null);
  }
  return candidates;
}

export async function finalJudgment(
  gateway: AzureFoundryGateway,
  research: ResearchBundle,
): Promise<StageOutcome<Candidate[]>> {
  try {
    const candidates = await generateJudgment(gateway, getConfiguredModel(), research);
    if (candidates.length === 0) return { status: 'INSUFFICIENT', data: [], verificationStatus: 'INSUFFICIENT_EVIDENCE' };
    return { status: 'SUCCESS', data: candidates, verificationStatus: 'VERIFIED' };
  } catch (error) {
    if (error instanceof StageExecutionError) return { status: error.reason === 'TIMEOUT' ? 'TIMEOUT' : 'FAILED', failureReason: error.reason };
    console.error(JSON.stringify({ event: 'azure_foundry_stage_error', stage: 'finalJudgment', reason: classifyUpstreamError(error) }));
    return { status: 'FAILED', failureReason: 'UPSTREAM_ERROR', verificationStatus: 'AI_UNAVAILABLE' };
  }
}
