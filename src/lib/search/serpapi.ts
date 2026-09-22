import sharp from 'sharp';
import { z } from 'zod';
import type { PreparedImage } from '../domain/types';
import { configuredTimeoutMs, ExternalProviderError, fetchWithTimeout, normalizeText, readJson, requiredApiKey, uniqueBy } from './provider-utils';
import type { LensDiagnostic, LensMatch } from './types';

const uploadResponseSchema = z.object({ image_id: z.string().min(1) });
const TARGET_MAX_SIZE = 450 * 1024;
const SERPAPI_MAX_SIZE = 500 * 1024;
const LENS_SEARCH_TIMEOUT_MS = 12_000;
const LENS_SEARCH_MAX_ATTEMPTS = 2;
const lensResponseSchema = z.object({
  visual_matches: z.array(z.object({
    title: z.string().optional(),
    source: z.string().optional(),
    link: z.string().url().optional(),
    thumbnail: z.string().url().optional(),
  }).passthrough()).optional(),
});

type LensMatchesWithDiagnostic = LensMatch[] & { diagnostic?: LensDiagnostic };

interface LensUploadImage {
  buffer: Buffer;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  filename: string;
  width: number;
  height: number;
  quality: number | null;
}

function imageExtension(mimeType: PreparedImage['mimeType'] | LensUploadImage['mimeType']): string {
  return mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : 'png';
}

async function optimizeLensImage(image: PreparedImage): Promise<LensUploadImage> {
  const originalSize = image.buffer.length;
  if (originalSize <= TARGET_MAX_SIZE) {
    return {
      buffer: image.buffer,
      mimeType: image.mimeType as LensUploadImage['mimeType'],
      filename: `manga-image.${imageExtension(image.mimeType)}`,
      width: image.width,
      height: image.height,
      quality: null,
    };
  }

  const attempts = [
    { format: 'webp' as const, quality: 82, scale: 1 },
    { format: 'jpeg' as const, quality: 82, scale: 1 },
    { format: 'webp' as const, quality: 76, scale: 0.9 },
    { format: 'jpeg' as const, quality: 76, scale: 0.9 },
    { format: 'webp' as const, quality: 68, scale: 0.8 },
    { format: 'jpeg' as const, quality: 68, scale: 0.8 },
    { format: 'webp' as const, quality: 60, scale: 0.7 },
    { format: 'jpeg' as const, quality: 60, scale: 0.7 },
  ];

  for (const attempt of attempts) {
    const width = Math.max(1, Math.round(image.width * attempt.scale));
    const height = Math.max(1, Math.round(image.height * attempt.scale));
    const buffer = await sharp(image.buffer)
      .resize({ width, height, fit: 'inside', withoutEnlargement: true })
      .toFormat(attempt.format, { quality: attempt.quality })
      .toBuffer();
    if (buffer.length <= TARGET_MAX_SIZE) {
      const optimized: LensUploadImage = {
        buffer,
        mimeType: attempt.format === 'jpeg' ? 'image/jpeg' : 'image/webp',
        filename: `manga-image.${attempt.format === 'jpeg' ? 'jpg' : 'webp'}`,
        width,
        height,
        quality: attempt.quality,
      };
      if (process.env.NODE_ENV !== 'production') {
        console.info('[LENS IMAGE OPTIMIZATION]', {
          originalMimeType: image.mimeType,
          originalSize,
          optimizedMimeType: optimized.mimeType,
          optimizedSize: buffer.length,
          widthBefore: image.width,
          heightBefore: image.height,
          widthAfter: width,
          heightAfter: height,
          quality: attempt.quality,
          wasOptimized: true,
        });
      }
      return optimized;
    }
  }

  throw new Error(`Lens upload image could not be reduced below ${SERPAPI_MAX_SIZE} bytes`);
}

function safePayloadError(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const value = payload as { error?: unknown; message?: unknown; status?: unknown };
  const nested = value.error && typeof value.error === 'object' ? value.error as { message?: unknown; code?: unknown } : undefined;
  const message = nested?.message ?? value.message ?? (typeof value.error === 'string' ? value.error : undefined);
  const code = nested?.code ?? (typeof value.status === 'string' ? value.status : undefined);
  if (typeof message !== 'string' && typeof code !== 'string') return null;
  return [typeof code === 'string' ? code : '', typeof message === 'string' ? message.replace(/<[^>]*>/gu, '').slice(0, 200) : '']
    .filter(Boolean)
    .join(': ') || null;
}

function safeThrownError(error: unknown): string | null {
  if (!error || typeof error !== 'object') return error instanceof Error ? error.message.slice(0, 200) : null;
  const candidate = error as { message?: unknown; code?: unknown };
  const message = typeof candidate.message === 'string' ? candidate.message.replace(/<[^>]*>/gu, '').slice(0, 200) : '';
  const code = typeof candidate.code === 'string' ? candidate.code : '';
  return [code, message].filter(Boolean).join(': ') || null;
}

function logLensError(stage: LensDiagnostic['stage'], httpStatus: number | null, error: unknown): void {
  if (process.env.NODE_ENV !== 'production') {
    console.info('[LENS ERROR]', { stage, httpStatus, message: safeThrownError(error) ?? safePayloadError(error) });
  }
}

function throwLensProviderError(
  code: 'SERPAPI_UPLOAD_ERROR' | 'SERPAPI_LENS_ERROR',
  diagnostic: LensDiagnostic,
): never {
  const error = new ExternalProviderError(code) as ExternalProviderError & { lensDiagnostic?: LensDiagnostic };
  error.lensDiagnostic = diagnostic;
  throw error;
}

interface LensSearchResponse {
  response: Response;
  payload: unknown;
  rawVisualMatches: unknown[];
  hasVisualMatches: boolean;
}

async function fetchLensSearch(url: URL, imageId: string, uploadStatus: number | null): Promise<LensSearchResponse> {
  for (let attempt = 1; attempt <= LENS_SEARCH_MAX_ATTEMPTS; attempt += 1) {
    const startedAt = Date.now();
    if (process.env.NODE_ENV !== 'production') console.info('[LENS SEARCH ATTEMPT]', { attempt, timeoutMs: LENS_SEARCH_TIMEOUT_MS });
    try {
      const response = await fetchWithTimeout(url, { method: 'GET' }, LENS_SEARCH_TIMEOUT_MS);
      const payload = await readJson(response);
      const hasVisualMatches = payload !== null && typeof payload === 'object' && Array.isArray((payload as { visual_matches?: unknown }).visual_matches);
      const rawVisualMatches = hasVisualMatches ? (payload as { visual_matches: unknown[] }).visual_matches : [];
      if (process.env.NODE_ENV !== 'production') {
        console.info('[LENS SEARCH RESPONSE]', {
          status: response.status,
          ok: response.ok,
          elapsedMs: Date.now() - startedAt,
          hasVisualMatches,
          visualMatchCount: rawVisualMatches.length,
          error: safePayloadError(payload),
        });
      }
      return { response, payload, rawVisualMatches, hasVisualMatches };
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      const isTimeout = error instanceof Error && (error.name === 'AbortError' || /aborted|abort/iu.test(error.message));
      if (process.env.NODE_ENV !== 'production') {
        console.info('[LENS SEARCH ERROR]', {
          attempt,
          elapsedMs,
          type: isTimeout ? 'TIMEOUT' : 'NETWORK',
          message: safeThrownError(error),
        });
      }
      if (isTimeout && attempt < LENS_SEARCH_MAX_ATTEMPTS) continue;
      throwLensProviderError('SERPAPI_LENS_ERROR', {
        stage: 'SEARCH',
        uploadStatus,
        imageIdExists: Boolean(imageId),
        searchStatus: null,
        visualMatchCount: 0,
        error: safeThrownError(error),
        searchResult: isTimeout ? 'SEARCH_TIMEOUT' : 'SEARCH_ERROR',
      });
    }
  }
  throw new Error('Lens search attempts exhausted');
}

export async function searchGoogleLens(image: PreparedImage): Promise<LensMatch[]> {
  const apiKey = requiredApiKey('SERPAPI_API_KEY');
  let imageId: string;
  let uploadStatus: number | null = null;

  try {
    const lensImage = await optimizeLensImage(image);
    if (process.env.NODE_ENV !== 'production' && image.buffer.length <= TARGET_MAX_SIZE) {
      console.info('[LENS IMAGE OPTIMIZATION]', {
        originalMimeType: image.mimeType,
        originalSize: image.buffer.length,
        optimizedMimeType: lensImage.mimeType,
        optimizedSize: lensImage.buffer.length,
        widthBefore: image.width,
        heightBefore: image.height,
        widthAfter: lensImage.width,
        heightAfter: lensImage.height,
        quality: lensImage.quality,
        wasOptimized: false,
      });
    }
    const formData = new FormData();
    const filename = lensImage.filename;
    const imageBlob = new Blob([new Uint8Array(lensImage.buffer)], { type: lensImage.mimeType });
    formData.append('image', imageBlob, filename);
    const uploadUrl = new URL('https://serpapi.com/image');
    uploadUrl.searchParams.set('api_key', apiKey);
    const lensUploadTimeoutMs = configuredTimeoutMs();
    if (process.env.NODE_ENV !== 'production') {
      const imageField = formData.get('image');
      console.info('[LENS UPLOAD REQUEST]', {
        imageIndex: image.imageIndex ?? null,
        mimeType: lensImage.mimeType,
        serverReceivedSize: image.originalSize ?? null,
        lensOptimizationInputSize: image.buffer.length,
        uploadedSize: lensImage.buffer.length,
        timeoutMs: lensUploadTimeoutMs,
      });
      console.info('[LENS FORM DATA]', {
        hasImageField: imageField instanceof Blob,
        filename,
        mimeType: imageBlob.type,
        size: imageBlob.size,
      });
    }
    const uploadResponse = await fetchWithTimeout(uploadUrl, { method: 'POST', body: formData }, lensUploadTimeoutMs);
    uploadStatus = uploadResponse.status;
    const uploadPayload = await readJson(uploadResponse);
    const upload = uploadResponseSchema.safeParse(uploadPayload);
    if (process.env.NODE_ENV !== 'production') {
      console.info('[LENS UPLOAD RESPONSE]', {
        status: uploadResponse.status,
        ok: uploadResponse.ok,
        imageIdExists: upload.success && Boolean(upload.data.image_id),
        error: safePayloadError(uploadPayload),
      });
    }
    if (!uploadResponse.ok || !upload.success || !upload.data.image_id) {
      logLensError('UPLOAD', uploadResponse.status, uploadPayload);
      throwLensProviderError('SERPAPI_UPLOAD_ERROR', {
        stage: 'UPLOAD',
        uploadStatus: uploadResponse.status,
        imageIdExists: false,
        searchStatus: null,
        visualMatchCount: 0,
        error: safePayloadError(uploadPayload),
      });
    }
    imageId = upload.data.image_id;
  } catch (error) {
    if (!(error instanceof ExternalProviderError)) logLensError('UPLOAD', uploadStatus, error);
    if (error instanceof ExternalProviderError) throw error;
    throwLensProviderError('SERPAPI_UPLOAD_ERROR', {
      stage: 'UPLOAD',
      uploadStatus,
      imageIdExists: false,
      searchStatus: null,
      visualMatchCount: 0,
      error: safeThrownError(error),
    });
  }

  let searchStatus: number | null = null;
  try {
    const lensUrl = new URL('https://serpapi.com/search.json');
    lensUrl.searchParams.set('engine', 'google_lens');
    lensUrl.searchParams.set('image_id', imageId);
    lensUrl.searchParams.set('type', 'visual_matches');
    lensUrl.searchParams.set('hl', 'ja');
    lensUrl.searchParams.set('country', 'jp');
    lensUrl.searchParams.set('api_key', apiKey);
    const searchResult = await fetchLensSearch(lensUrl, imageId, uploadStatus);
    const response = searchResult.response;
    searchStatus = response.status;
    const payload = searchResult.payload;
    const hasVisualMatches = searchResult.hasVisualMatches;
    const rawVisualMatches = searchResult.rawVisualMatches;
    const parsed = lensResponseSchema.safeParse(payload);
    if (process.env.NODE_ENV !== 'production') {
    }
    if (!response.ok || !parsed.success) {
      logLensError(parsed.success ? 'SEARCH' : 'PARSE', response.status, payload);
      throwLensProviderError('SERPAPI_LENS_ERROR', {
        stage: parsed.success ? 'SEARCH' : 'PARSE',
        uploadStatus,
        imageIdExists: true,
        searchStatus: response.status,
        visualMatchCount: rawVisualMatches.length,
        error: safePayloadError(payload),
        searchResult: parsed.success && rawVisualMatches.length === 0 ? 'EMPTY_RESULTS' : 'SEARCH_ERROR',
      });
    }

    const matches = uniqueBy((parsed.data.visual_matches ?? []).map((match, sourceIndex) => ({
      title: normalizeText(match.title ?? ''),
      source: normalizeText(match.source ?? ''),
      link: match.link ?? '',
      sourceIndex,
      ...(match.thumbnail ? { thumbnail: match.thumbnail } : {}),
    })).filter((match) => match.title && match.link), (match) => match.link).slice(0, 10);
    if (process.env.NODE_ENV !== 'production') {
      console.info('[LENS SEARCH]', { status: response.status, visualMatchCount: rawVisualMatches.length });
      console.info('[LENS VISUAL MATCHES]');
      (parsed.data.visual_matches ?? []).slice(0, 10).forEach((match, index) => {
        console.info(`${index + 1}.`, {
          title: match.title ?? '',
          source: match.source ?? '',
          link: match.link ?? '',
        });
      });
    }
    const result = matches as LensMatchesWithDiagnostic;
    result.diagnostic = { stage: 'COMPLETE', uploadStatus, imageIdExists: true, searchStatus, visualMatchCount: rawVisualMatches.length, error: null, searchResult: rawVisualMatches.length === 0 ? 'EMPTY_RESULTS' : 'SUCCESS' };
    return result;
  } catch (error) {
    if (!(error instanceof ExternalProviderError)) logLensError('SEARCH', searchStatus, error);
    if (error instanceof ExternalProviderError) throw error;
    throwLensProviderError('SERPAPI_LENS_ERROR', {
      stage: 'SEARCH',
      uploadStatus,
      imageIdExists: true,
      searchStatus,
      visualMatchCount: 0,
      error: safeThrownError(error),
    });
  }
}
