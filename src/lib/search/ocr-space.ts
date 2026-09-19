import type { PreparedImage } from '../domain/types';
import { z } from 'zod';
import { ExternalProviderError, fetchWithTimeout, readJson, requiredApiKey } from './provider-utils';
import type { OcrExtraction } from './types';

const ocrResponseSchema = z.object({
  IsErroredOnProcessing: z.union([z.boolean(), z.string()]).optional(),
  ErrorMessage: z.unknown().optional(),
  ErrorDetails: z.unknown().optional(),
  OCRExitCode: z.union([z.number(), z.string()]).optional(),
  ParsedResults: z.array(z.object({ ParsedText: z.string().optional() }).passthrough()).optional(),
}).passthrough();

function cleanOcrText(text: string): string {
  const lines = text
    .split(/[\r\n]+/u)
    .map((line) => line.replace(/[^\p{L}\p{N}\s]/gu, ' '))
    .map((line) => line.replace(/\s+/gu, ' ').trim())
    .filter(Boolean);
  return [...new Set(lines)].join(' ').slice(0, 1_000);
}

function isUsefulJapaneseText(text: string): boolean {
  const normalized = cleanOcrText(text);
  const meaningful = normalized.replace(/[^\p{L}\p{N}]/gu, '');
  if (meaningful.length < 2 || /^\d+$/u.test(meaningful)) return false;
  return /[\u3040-\u30ff\u3400-\u9fff]/u.test(meaningful);
}

export async function extractJapaneseText(image: PreparedImage): Promise<OcrExtraction> {
  try {
    const supportedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
    if (image.buffer.length === 0 || !supportedMimeTypes.has(image.mimeType)) {
      throw new ExternalProviderError('OCR_SPACE_ERROR');
    }

    const extension = image.mimeType === 'image/jpeg' ? 'jpg' : image.mimeType.split('/')[1];
    const file = new File([new Uint8Array(image.buffer)], `manga-image.${extension}`, { type: image.mimeType });
    console.info('[OCR REQUEST]');
    console.info('status:', 'sending');
    console.info('filename:', file.name);
    console.info('type:', file.type);
    console.info('size:', file.size);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('language', process.env.language?.trim() || 'jpn');
    formData.append('isOverlayRequired', 'false');
    formData.append('OCREngine', process.env.OCREngine?.trim() || '3');
    const apiKey = requiredApiKey('OCR_SPACE_API_KEY');
    const response = await fetchWithTimeout('https://api.ocr.space/parse/image', {
      method: 'POST',
      headers: { apikey: apiKey },
      body: formData,
    });
    const responseData = await readJson(response);
    const responseRecord = responseData && typeof responseData === 'object'
      ? responseData as Record<string, unknown>
      : {};
    console.info('[OCR RESPONSE]');
    console.info('status:', response.status);
    console.info('IsErroredOnProcessing:', responseRecord.IsErroredOnProcessing);
    console.info('ErrorMessage:', responseRecord.ErrorMessage);
    console.info('ErrorDetails:', responseRecord.ErrorDetails);
    console.info('OCRExitCode:', responseRecord.OCRExitCode);
    console.info('ParsedResults:', responseRecord.ParsedResults);
    console.info('[OCR RESPONSE JSON]', JSON.stringify(responseData));

    const parsed = ocrResponseSchema.safeParse(responseData);
    if (!response.ok || !parsed.success || parsed.data.IsErroredOnProcessing === true || parsed.data.IsErroredOnProcessing === 'true') {
      throw new ExternalProviderError('OCR_SPACE_ERROR');
    }

    const rawText = (parsed.data.ParsedResults ?? [])
      .map((result) => result.ParsedText ?? '')
      .filter(Boolean)
      .join('\n');
    const text = cleanOcrText(rawText);
    console.info('[OCR RAW]', JSON.stringify(rawText));
    console.info('[OCR CLEANED]', JSON.stringify(text));
    return { text, valid: isUsefulJapaneseText(text) };
  } catch (error) {
    if (!(error instanceof ExternalProviderError)) {
      console.error('[OCR ERROR]', error instanceof Error ? error.message : String(error));
    }
    if (error instanceof ExternalProviderError) throw error;
    throw new ExternalProviderError('OCR_SPACE_ERROR');
  }
}

export { cleanOcrText, isUsefulJapaneseText };
