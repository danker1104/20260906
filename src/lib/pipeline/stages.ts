import { z } from 'zod';
import { candidateSchema } from '../domain/schemas';
import type { Candidate, StageStatus } from '../domain/types';
import { getConfiguredModel, type AzureFoundryGateway } from '../ai/azure-foundry-gateway';
import { finalJudgmentPrompt, finalJudgmentSystemPrompt, ocrRefinerPrompt, ocrRefinerSystemPrompt } from '../ai/prompts';
import { classifyUpstreamError, generateJson, getStageTimeoutMs, isQuotaError, StageExecutionError, withStageTimeout, type StageOutcome } from './stage-utils';
import type { ResearchBundle } from '../search/types';
import type { OcrQueryRefinement } from '../search/query-refinement';
import type { VerificationStatus } from '../domain/types';

const finalJudgmentSchema = z.object({ candidates: z.array(candidateSchema).max(3) });
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
  const result = await withStageTimeout(
    generateJson(
      gateway,
      { model, systemPrompt: finalJudgmentSystemPrompt, userPrompt: finalJudgmentPrompt(research) },
      finalJudgmentSchema,
      research.koreanResults ? 'FOUNDRY KOREAN' : undefined,
      research.koreanResults ? normalizeKoreanVerifierResponse : undefined,
    ),
    getStageTimeoutMs(),
  );
  const candidates = research.koreanResults ? applyKoreanTitleEvidence(result.candidates, research) : result.candidates;
  if (research.koreanResults && process.env.NODE_ENV !== 'production') {
    console.info('[FOUNDRY KOREAN RESULT]', result.candidates[0] ?? null);
    console.info('[KOREAN TITLE STATUS]', candidates[0]?.koreanTitleStatus ?? 'UNKNOWN');
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
