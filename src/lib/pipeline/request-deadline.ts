export const DEFAULT_TOTAL_TIMEOUT_MS = 60_000;

export function getTotalTimeoutMs(): number {
  const configuredTimeout = Number(process.env.GEMINI_TOTAL_TIMEOUT_MS ?? DEFAULT_TOTAL_TIMEOUT_MS);

  if (!Number.isFinite(configuredTimeout) || configuredTimeout <= 0) {
    return DEFAULT_TOTAL_TIMEOUT_MS;
  }

  return Math.min(configuredTimeout, DEFAULT_TOTAL_TIMEOUT_MS);
}

export function hasDeadlineExpired(startedAt: number, timeoutMs = getTotalTimeoutMs()): boolean {
  return Date.now() - startedAt >= timeoutMs;
}
