import { z } from 'zod';
import { candidateSchema } from '../domain/schemas';
import type { Candidate, StageStatus } from '../domain/types';
import { getConfiguredModel, type AzureFoundryGateway } from '../ai/azure-foundry-gateway';
import { finalJudgmentPrompt, finalJudgmentSystemPrompt } from '../ai/prompts';
import { classifyUpstreamError, generateJson, getStageTimeoutMs, isQuotaError, StageExecutionError, withStageTimeout, type StageOutcome } from './stage-utils';
import type { ResearchBundle } from '../search/types';
import type { VerificationStatus } from '../domain/types';

const finalJudgmentSchema = z.object({ candidates: z.array(candidateSchema).max(3) });

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
