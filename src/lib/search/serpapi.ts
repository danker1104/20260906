import { z } from 'zod';
import type { PreparedImage } from '../domain/types';
import { ExternalProviderError, fetchWithTimeout, normalizeText, readJson, requiredApiKey, uniqueBy } from './provider-utils';
import type { LensMatch } from './types';

const uploadResponseSchema = z.object({ image_id: z.string().min(1) });
const lensResponseSchema = z.object({
  visual_matches: z.array(z.object({
    title: z.string().optional(),
    source: z.string().optional(),
    link: z.string().url().optional(),
    thumbnail: z.string().url().optional(),
  }).passthrough()).optional(),
});

export async function searchGoogleLens(image: PreparedImage): Promise<LensMatch[]> {
  const apiKey = requiredApiKey('SERPAPI_API_KEY');
  let imageId: string;

  try {
    const formData = new FormData();
    formData.append('file', new Blob([new Uint8Array(image.buffer)], { type: image.mimeType }), 'manga-image');
    const uploadUrl = new URL('https://serpapi.com/image');
    uploadUrl.searchParams.set('api_key', apiKey);
    const uploadResponse = await fetchWithTimeout(uploadUrl, { method: 'POST', body: formData });
    const upload = uploadResponseSchema.safeParse(await readJson(uploadResponse));
    if (!uploadResponse.ok || !upload.success) throw new ExternalProviderError('SERPAPI_UPLOAD_ERROR');
    imageId = upload.data.image_id;
    if (process.env.NODE_ENV !== 'production') console.info('[LENS UPLOAD]', { status: uploadResponse.status, imageIdExists: Boolean(imageId) });
  } catch (error) {
    if (error instanceof ExternalProviderError) throw error;
    throw new ExternalProviderError('SERPAPI_UPLOAD_ERROR');
  }

  try {
    const lensUrl = new URL('https://serpapi.com/search.json');
    lensUrl.searchParams.set('engine', 'google_lens');
    lensUrl.searchParams.set('image_id', imageId);
    lensUrl.searchParams.set('type', 'visual_matches');
    lensUrl.searchParams.set('hl', 'ja');
    lensUrl.searchParams.set('country', 'jp');
    lensUrl.searchParams.set('api_key', apiKey);
    const response = await fetchWithTimeout(lensUrl, { method: 'GET' });
    const parsed = lensResponseSchema.safeParse(await readJson(response));
    if (!response.ok || !parsed.success) throw new ExternalProviderError('SERPAPI_LENS_ERROR');

    const matches = uniqueBy((parsed.data.visual_matches ?? []).map((match) => ({
      title: normalizeText(match.title ?? ''),
      source: normalizeText(match.source ?? ''),
      link: match.link ?? '',
      ...(match.thumbnail ? { thumbnail: match.thumbnail } : {}),
    })).filter((match) => match.title && match.link), (match) => match.link).slice(0, 10);
    if (process.env.NODE_ENV !== 'production') {
      console.info('[LENS SEARCH]', { status: response.status, visualMatchCount: matches.length });
      console.info('[LENS VISUAL MATCHES]', matches.map(({ title, source, link }) => ({ title, source, link })));
    }
    return matches;
  } catch (error) {
    if (error instanceof ExternalProviderError) throw error;
    throw new ExternalProviderError('SERPAPI_LENS_ERROR');
  }
}
