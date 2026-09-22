export type ExternalProviderCode =
  | 'OCR_SPACE_ERROR'
  | 'TAVILY_ERROR'
  | 'SERPAPI_UPLOAD_ERROR'
  | 'SERPAPI_LENS_ERROR';

export class ExternalProviderError extends Error {
  constructor(readonly code: ExternalProviderCode, message = code) {
    super(message);
    this.name = 'ExternalProviderError';
  }
}

export function requiredApiKey(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export function configuredTimeoutMs(): number {
  const value = Number(process.env.EXTERNAL_STAGE_TIMEOUT_MS ?? 10_000);
  return Number.isFinite(value) && value > 0 ? Math.min(value, 12_000) : 10_000;
}

export async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

export async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs = configuredTimeoutMs()): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal, redirect: 'error' });
  } finally {
    clearTimeout(timer);
  }
}

export function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 1_000);
}

export function uniqueBy<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalizedKey = key(value).trim().toLowerCase();
    if (!normalizedKey || seen.has(normalizedKey)) return false;
    seen.add(normalizedKey);
    return true;
  });
}
