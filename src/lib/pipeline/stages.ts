import { z } from 'zod';
import { candidateSchema } from '../domain/schemas';
import type { Candidate, StageStatus } from '../domain/types';
import { getConfiguredModel, type GeminiGateway } from '../ai/gemini-gateway';
import { finalJudgmentPrompt } from '../ai/prompts';
import { classifyUpstreamError, generateJson, getStageTimeoutMs, isQuotaError, StageExecutionError, withStageTimeout, type StageOutcome } from './stage-utils';
import type { ResearchBundle } from '../search/types';
import type { VerificationStatus } from '../domain/types';

function jsonConfig(): Record<string, unknown> {
  return {
    responseMimeType: 'application/json',
  };
}

const finalJudgmentSchema = z.object({ candidates: z.array(candidateSchema).max(3) });

async function generateJudgment(
  gateway: GeminiGateway,
  model: string,
  research: ResearchBundle,
): Promise<Candidate[]> {
  const result = await withStageTimeout(
    generateJson(gateway, { model, contents: finalJudgmentPrompt(research), config: jsonConfig() }, finalJudgmentSchema),
    getStageTimeoutMs(),
  );
  return result.candidates;
}

export async function finalJudgment(
  gateway: GeminiGateway,
  research: ResearchBundle,
): Promise<StageOutcome<Candidate[]>> {
  try {
    const candidates = await generateJudgment(gateway, getConfiguredModel(), research);
    if (candidates.length === 0) return { status: 'INSUFFICIENT', data: [], verificationStatus: 'INSUFFICIENT_EVIDENCE' };
    return { status: 'SUCCESS', data: candidates, verificationStatus: 'VERIFIED' };
  } catch (error) {
    if (error instanceof StageExecutionError) return { status: error.reason === 'TIMEOUT' ? 'TIMEOUT' : 'FAILED', failureReason: error.reason };
    console.error(JSON.stringify({ event: 'gemini_stage_error', stage: 'finalJudgment', reason: classifyUpstreamError(error) }));
    return { status: 'FAILED', failureReason: 'UPSTREAM_ERROR', verificationStatus: 'AI_UNAVAILABLE' };
  }
}
