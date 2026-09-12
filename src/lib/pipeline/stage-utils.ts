import { z } from 'zod';
import type { StageStatus } from '../domain/types';
import type { GeminiGateway } from '../ai/gemini-gateway';

export interface StageOutcome<T> {
  status: StageStatus;
  data?: T;
}

export class StageExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StageExecutionError';
  }
}

export async function generateJson<T>(
  gateway: GeminiGateway,
  request: Parameters<GeminiGateway['generateContent']>[0],
  schema: z.ZodType<T>,
): Promise<T> {
  const text = await gateway.generateContent(request);
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw new StageExecutionError('Gemini 응답이 JSON 형식이 아닙니다.');
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new StageExecutionError('Gemini 응답이 예상한 schema와 일치하지 않습니다.');
  }

  return result.data;
}

export async function withStageTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new StageExecutionError('AI 단계 시간이 초과되었습니다.')), timeoutMs);
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
  const configuredTimeout = Number(process.env.GEMINI_STAGE_TIMEOUT_MS ?? 12_000);
  if (!Number.isFinite(configuredTimeout) || configuredTimeout <= 0) {
    return 12_000;
  }
  return Math.min(configuredTimeout, 12_000);
}
