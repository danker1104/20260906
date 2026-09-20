import { z } from 'zod';
import type { StageStatus, VerificationStatus } from '../domain/types';
import type { AzureFoundryGateway, AzureFoundryGenerateRequest } from '../ai/azure-foundry-gateway';

export interface StageOutcome<T> {
  status: StageStatus;
  data?: T;
  failureReason?: 'TIMEOUT' | 'UPSTREAM_ERROR' | 'INVALID_MODEL_RESPONSE' | 'RATE_LIMITED';
  verificationStatus?: VerificationStatus;
}

export class StageExecutionError extends Error {
  readonly reason: 'TIMEOUT' | 'INVALID_MODEL_RESPONSE';

  constructor(message: string, reason: 'TIMEOUT' | 'INVALID_MODEL_RESPONSE') {
    super(message);
    this.name = 'StageExecutionError';
    this.reason = reason;
  }
}

export function classifyUpstreamError(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return 'UNKNOWN_ERROR';
  }

  const candidate = error as { status?: unknown; code?: unknown; name?: unknown; message?: unknown };
  const status = typeof candidate.status === 'number' ? `HTTP_${candidate.status}` : '';
  const code = typeof candidate.code === 'string' ? candidate.code.replace(/[^A-Z0-9_-]/gi, '').slice(0, 40) : '';
  const name = typeof candidate.name === 'string' ? candidate.name.replace(/[^A-Z0-9_-]/gi, '').slice(0, 40) : '';
  const message = typeof candidate.message === 'string' ? candidate.message : '';
  const safeMessage = message.match(/(?:API key|quota|rate|model|permission|invalid|unauthorized|forbidden|status|failed)[^\n]*/i)?.[0]
    ?.replace(/AIza[\w-]+/g, '[REDACTED_KEY]')
    .slice(0, 120);

  return [status, code, name, safeMessage].filter(Boolean).join(':') || 'UNKNOWN_ERROR';
}

export function isQuotaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { status?: unknown; message?: unknown; error?: { status?: unknown; message?: unknown } };
  const message = `${candidate.message ?? ''} ${candidate.error?.message ?? ''}`.toLowerCase();
  return candidate.status === 429 || candidate.error?.status === 429 || message.includes('quota') || message.includes('resource_exhausted');
}

function extractJson(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1]?.trim() ?? trimmed;
}

export async function generateJson<T>(
  gateway: AzureFoundryGateway,
  request: AzureFoundryGenerateRequest,
  schema: z.ZodType<T>,
): Promise<T> {
  const text = await gateway.generateContent(request);
  let parsed: unknown;

  try {
    parsed = JSON.parse(extractJson(text));
  } catch {
    throw new StageExecutionError('Azure Foundry 응답이 JSON 형식이 아닙니다.', 'INVALID_MODEL_RESPONSE');
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new StageExecutionError('Azure Foundry 응답이 예상한 schema와 일치하지 않습니다.', 'INVALID_MODEL_RESPONSE');
  }

  return result.data;
}

export async function withStageTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new StageExecutionError('AI 단계 시간이 초과되었습니다.', 'TIMEOUT')), timeoutMs);
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export function getStageTimeoutMs(): number {
  const configuredTimeout = Number(process.env.AZURE_FOUNDRY_STAGE_TIMEOUT_MS ?? 12_000);
  if (!Number.isFinite(configuredTimeout) || configuredTimeout <= 0) {
    return 12_000;
  }
  return Math.min(configuredTimeout, 12_000);
}
