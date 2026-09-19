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

function isTransientGeminiError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { status?: unknown; message?: unknown };
  const status = Number(candidate.status);
  const message = String(candidate.message ?? '').toLowerCase();
  return [500, 502, 503, 504].includes(status)
    || message.includes('service unavailable')
    || message.includes('high demand')
    || message.includes('temporarily unavailable');
}

function retryDelayMs(attempt: number): number {
  const configured = Number(process.env.GEMINI_RETRY_BASE_MS ?? 1_000);
  const base = Number.isFinite(configured) && configured >= 0 ? configured : 1_000;
  return Math.min(base * (2 ** attempt), 4_000) + Math.floor(Math.random() * 250);
}

async function waitForRetry(attempt: number): Promise<void> {
  const delay = retryDelayMs(attempt);
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
}

async function generateJudgmentWithRetries(
  gateway: GeminiGateway,
  model: string,
  research: ResearchBundle,
): Promise<Candidate[]> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    console.info('[GEMINI PRIMARY]', { model, status: attempt === 0 ? 'started' : 'retrying' });
    try {
      const result = await withStageTimeout(
        generateJson(gateway, { model, contents: finalJudgmentPrompt(research), config: jsonConfig() }, finalJudgmentSchema),
        getStageTimeoutMs(),
      );
      console.info('[GEMINI PRIMARY]', { model, status: 'success' });
      return result.candidates;
    } catch (error) {
      if (!isTransientGeminiError(error) || attempt === 2) throw error;
      console.info('[GEMINI RETRY]', { attempt: attempt + 1, status: classifyUpstreamError(error) });
      await waitForRetry(attempt);
    }
  }
  throw new Error('Gemini primary model failed');
}

export async function finalJudgment(
  gateway: GeminiGateway,
  research: ResearchBundle,
): Promise<StageOutcome<Candidate[]>> {
  try {
    const primaryModel = getConfiguredModel();
    try {
      const candidates = await generateJudgmentWithRetries(gateway, primaryModel, research);
      if (candidates.length === 0) return { status: 'INSUFFICIENT', data: [], verificationStatus: 'INSUFFICIENT_EVIDENCE' };
      return { status: 'SUCCESS', data: candidates, verificationStatus: 'VERIFIED' };
    } catch (primaryError) {
      if (isQuotaError(primaryError)) return { status: 'FAILED', failureReason: 'RATE_LIMITED', verificationStatus: 'RATE_LIMITED' };
      if (!isTransientGeminiError(primaryError)) throw primaryError;
      return {
        status: 'FAILED',
        failureReason: 'UPSTREAM_ERROR',
        verificationStatus: 'AI_UNAVAILABLE',
      };
    }
  } catch (error) {
    if (error instanceof StageExecutionError) return { status: error.reason === 'TIMEOUT' ? 'TIMEOUT' : 'FAILED', failureReason: error.reason };
    console.error(JSON.stringify({ event: 'gemini_stage_error', stage: 'finalJudgment', reason: classifyUpstreamError(error) }));
    return { status: 'FAILED', failureReason: 'UPSTREAM_ERROR', verificationStatus: 'AI_UNAVAILABLE' };
  }
}
