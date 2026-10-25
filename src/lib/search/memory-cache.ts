import { createHash } from 'node:crypto';
import type { PreparedImage } from '../domain/types';

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const MAX_TTL_MS = 60 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 128;
const credentialQueryName = /(?:api[_-]?key|access[_-]?token|token|secret|signature|credential|authorization|auth|cert[_-]?key)/iu;

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

interface InMemoryTtlCacheOptions<T> {
  ttlMs?: number;
  maxEntries?: number;
  clone?: (value: T) => T;
}

export function configuredResearchCacheTtlMs(): number {
  const configured = Number(process.env.MANGAFIND_RESEARCH_CACHE_TTL_MS ?? DEFAULT_TTL_MS);
  return Number.isFinite(configured) && configured >= 0 ? Math.min(configured, MAX_TTL_MS) : DEFAULT_TTL_MS;
}

export function hashImageForResearchCache(image: PreparedImage): string {
  return createHash('sha256')
    .update(image.mimeType)
    .update('\0')
    .update(`${image.width}x${image.height}`)
    .update('\0')
    .update(image.buffer)
    .digest('hex');
}

export function hashResearchCacheText(scope: string, value: string): string {
  return createHash('sha256').update(scope).update('\0').update(value).digest('hex');
}

export function withoutCredentialQueryParameters(value: string): string {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (credentialQueryName.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return value;
  }
}

export function redactCredentialText(value: string): string {
  const redactedAssignments = value.replace(
    /((?:api[_-]?key|access[_-]?token|token|secret|signature|credential|authorization|auth|cert[_-]?key)\s*[=:]\s*)[^\s&"'<>]+/giu,
    '$1[REDACTED]',
  );
  return redactedAssignments.replace(/https?:\/\/[^\s"'<>]+/giu, (url) => withoutCredentialQueryParameters(url));
}

export class InMemoryTtlCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly inFlight = new Map<string, Promise<T>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly clone: (value: T) => T;

  constructor(options: InMemoryTtlCacheOptions<T> = {}) {
    this.ttlMs = options.ttlMs ?? configuredResearchCacheTtlMs();
    this.maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES);
    this.clone = options.clone ?? ((value) => structuredClone(value));
  }

  async getOrLoad(key: string, load: () => Promise<T>): Promise<T> {
    this.removeExpired(Date.now());
    const cached = this.entries.get(key);
    if (cached) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return this.clone(cached.value);
    }

    const pending = this.inFlight.get(key);
    if (pending) return this.clone(await pending);

    const request = Promise.resolve().then(load);
    this.inFlight.set(key, request);
    try {
      const value = await request;
      if (this.ttlMs > 0) {
        while (this.entries.size >= this.maxEntries) {
          const oldest = this.entries.keys().next().value;
          if (oldest === undefined) break;
          this.entries.delete(oldest);
        }
        this.entries.set(key, { expiresAt: Date.now() + this.ttlMs, value: this.clone(value) });
      }
      return this.clone(value);
    } finally {
      if (this.inFlight.get(key) === request) this.inFlight.delete(key);
    }
  }

  clear(): void {
    this.entries.clear();
    this.inFlight.clear();
  }

  private removeExpired(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }
}