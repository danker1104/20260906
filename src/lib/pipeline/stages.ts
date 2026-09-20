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
    generateJson(gateway, { model, systemPrompt: finalJudgmentSystemPrompt, userPrompt: finalJudgmentPrompt(research) }, finalJudgmentSchema),
    getStageTimeoutMs(),
  );
  return result.candidates;
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
