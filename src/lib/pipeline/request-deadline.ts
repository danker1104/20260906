export const DEFAULT_TOTAL_TIMEOUT_MS = 60_000;
export const DEFAULT_INTER_CALL_DELAY_MS = 5_000;

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

export function getInterCallDelayMs(): number {
  const configuredDelay = Number(process.env.GEMINI_INTER_CALL_DELAY_MS ?? DEFAULT_INTER_CALL_DELAY_MS);
  if (!Number.isFinite(configuredDelay) || configuredDelay < 0) {
    return DEFAULT_INTER_CALL_DELAY_MS;
  }
  return Math.min(configuredDelay, 30_000);
}

export function waitForInterCallDelay(delayMs = getInterCallDelayMs()): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
