import type { PreparedImage } from '../domain/types';
import { z } from 'zod';
import { ExternalProviderError, fetchWithTimeout, readJson, requiredApiKey } from './provider-utils';
import type { OcrExtraction, OcrLine } from './types';
import { hashImageForResearchCache, hashResearchCacheText, InMemoryTtlCache, redactCredentialText } from './memory-cache';

const ocrResponseSchema = z.object({
  IsErroredOnProcessing: z.union([z.boolean(), z.string()]).optional(),
  ErrorMessage: z.unknown().optional(),
  ErrorDetails: z.unknown().optional(),
  OCRExitCode: z.union([z.number(), z.string()]).optional(),
  ParsedResults: z.array(z.object({
    ParsedText: z.string().optional(),
    TextOverlay: z.object({
      Lines: z.array(z.object({
        LineText: z.string().optional(),
        MinTop: z.union([z.number(), z.string()]).optional(),
        MaxHeight: z.union([z.number(), z.string()]).optional(),
        Words: z.array(z.object({
          WordText: z.string().optional(),
          Left: z.union([z.number(), z.string()]).optional(),
          Top: z.union([z.number(), z.string()]).optional(),
          Height: z.union([z.number(), z.string()]).optional(),
          Width: z.union([z.number(), z.string()]).optional(),
          Confidence: z.union([z.number(), z.string()]).optional(),
        }).passthrough()).optional(),
      }).passthrough()).optional(),
    }).passthrough().optional(),
  }).passthrough()).optional(),
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
  const japaneseCharacters = [...meaningful].filter((character) => /[\u3040-\u30ff\u3400-\u9fff]/u.test(character)).length;
  if (meaningful.length < 3 || /^\d+$/u.test(meaningful) || japaneseCharacters < 2) return false;
  return japaneseCharacters / meaningful.length >= 0.35;
}

function readOcrConfidence(parsedResults: Array<{ TextOverlay?: { Lines?: Array<{ Words?: Array<{ Confidence?: number | string }> }> } }>): number | undefined {
  const confidences = parsedResults.flatMap((result) => result.TextOverlay?.Lines ?? [])
    .flatMap((line) => line.Words ?? [])
    .map((word) => {
      if (typeof word.Confidence === 'number') return word.Confidence;
      if (typeof word.Confidence === 'string' && word.Confidence.trim()) return Number(word.Confidence);
      return Number.NaN;
    })
    .filter((confidence) => Number.isFinite(confidence) && confidence >= 0 && confidence <= 100);
  if (confidences.length === 0) return undefined;
  return confidences.reduce((sum, confidence) => sum + confidence, 0) / confidences.length;
}

function coordinate(value: number | string | undefined): number | undefined {
  const parsed = typeof value === 'number' ? value : value?.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function readOcrLines(parsedResults: z.infer<typeof ocrResponseSchema>['ParsedResults']): OcrLine[] {
  return (parsedResults ?? []).flatMap((result) => (result.TextOverlay?.Lines ?? []).map((line) => {
    const words = line.Words ?? [];
    const lefts = words.map((word) => coordinate(word.Left)).filter((value): value is number => value !== undefined);
    const tops = words.map((word) => coordinate(word.Top)).filter((value): value is number => value !== undefined);
    const rights = words.flatMap((word) => {
      const left = coordinate(word.Left);
      const width = coordinate(word.Width);
      return left !== undefined && width !== undefined ? [left + width] : [];
    });
    const heights = words.map((word) => coordinate(word.Height)).filter((value): value is number => value !== undefined);
    const left = lefts.length ? Math.min(...lefts) : undefined;
    return {
      text: line.LineText ?? words.map((word) => word.WordText ?? '').join(' '),
      top: coordinate(line.MinTop) ?? (tops.length ? Math.min(...tops) : undefined),
      height: coordinate(line.MaxHeight) ?? (heights.length ? Math.max(...heights) : undefined),
      left,
      width: left !== undefined && rights.length ? Math.max(...rights) - left : undefined,
    };
  }));
}

type PositionedOcrLine = Required<OcrLine>;

function mergeOcrBounds(parts: PositionedOcrLine[], text: string): PositionedOcrLine {
  const left = Math.min(...parts.map((part) => part.left));
  const top = Math.min(...parts.map((part) => part.top));
  return {
    text, left, top,
    width: Math.max(...parts.map((part) => part.left + part.width)) - left,
    height: Math.max(...parts.map((part) => part.top + part.height)) - top,
  };
}

function restoreJapaneseLayout(result: NonNullable<z.infer<typeof ocrResponseSchema>['ParsedResults']>[number]): { rawText: string; lines: OcrLine[] } {
  const original = { rawText: result.ParsedText ?? '', lines: readOcrLines([result]) };
  const fragments: Array<PositionedOcrLine & { index: number }> = [];
  const retained: Array<{ index: number; line: OcrLine }> = [];
  for (const [index, overlay] of (result.TextOverlay?.Lines ?? []).entries()) {
    const words = (overlay.Words ?? []).map((word) => ({
      text: word.WordText ?? '', left: coordinate(word.Left), top: coordinate(word.Top),
      width: coordinate(word.Width), height: coordinate(word.Height),
    }));
    const positioned = words.filter((word): word is PositionedOcrLine => (
      Boolean(word.text.trim()) && word.left !== undefined && word.top !== undefined
      && word.width !== undefined && word.width > 0 && word.height !== undefined && word.height > 0
    ));
    const vertical = positioned.length > 0 && positioned.length === words.length
      && positioned.every((word) => [...word.text.replace(/\s/gu, '')].length === 1 || word.height >= word.width * 2);
    if (vertical) fragments.push(...positioned.map((word) => ({ ...word, index })));
    else retained.push({ index, line: original.lines[index] });
  }

  const columns: Array<{ parts: typeof fragments; bounds: PositionedOcrLine }> = [];
  for (const fragment of fragments.sort((left, right) => left.top - right.top || right.left - left.left)) {
    const column = columns.find(({ parts, bounds }) => {
      const previous = parts[parts.length - 1];
      const anchor = parts[0];
      const centerOffset = Math.abs(anchor.left + anchor.width / 2 - fragment.left - fragment.width / 2);
      const overlap = Math.min(bounds.left + bounds.width, fragment.left + fragment.width) - Math.max(bounds.left, fragment.left);
      const gap = fragment.top - previous.top - previous.height;
      return overlap >= Math.min(bounds.width, fragment.width) * 0.6
        && centerOffset <= Math.min(anchor.width, fragment.width) * 0.15
        && gap >= -Math.min(previous.height, fragment.height) * 0.25
        && gap <= Math.max(previous.height, fragment.height) * 1.5;
    });
    if (column) {
      column.parts.push(fragment);
      column.bounds = mergeOcrBounds(column.parts, column.parts.map((part) => part.text.replace(/\s/gu, '')).join(''));
    } else {
      columns.push({ parts: [fragment], bounds: { ...fragment, text: fragment.text.replace(/\s/gu, '') } });
    }
  }
  const verticalColumns = columns.filter(({ parts, bounds }) => parts.length > 1 || bounds.height >= bounds.width * 2);
  if (verticalColumns.length === 0) return original;

  const blocks: Array<typeof verticalColumns> = [];
  for (const column of verticalColumns.sort((left, right) => right.bounds.left - left.bounds.left)) {
    const block = blocks.find((members) => members.some((member) => {
      const right = member.bounds;
      const left = column.bounds;
      const overlap = Math.min(right.top + right.height, left.top + left.height) - Math.max(right.top, left.top);
      const gap = right.left - left.left - left.width;
      return overlap >= Math.min(right.height, left.height) * 0.5 && gap >= 0
        && Math.abs(right.top - left.top) <= Math.min(right.width, left.width) * 0.5
        && gap <= Math.max(right.width, left.width) * 1.5;
    }));
    if (block) block.push(column);
    else blocks.push([column]);
  }
  if (blocks.every((block) => block.length === 1 && block[0].parts.length === 1)) return original;
  for (const block of blocks) {
    retained.push({
      index: Math.min(...block.flatMap((column) => column.parts.map((part) => part.index))),
      line: mergeOcrBounds(block.map((column) => column.bounds), block.map((column) => column.bounds.text).join('')),
    });
  }
  for (const column of columns.filter((column) => !verticalColumns.includes(column))) {
    retained.push({ index: column.parts[0].index, line: column.bounds });
  }
  const lines = retained.sort((left, right) => left.index - right.index).map(({ line }) => line);
  const rawText = lines.map((line) => line.text).join('\n');
  const characters = (text: string) => [...text.replace(/\s/gu, '')].sort().join('');
  if (original.rawText && characters(original.rawText) !== characters(rawText)) return original;
  return { rawText, lines };
}

function readSocialCropBounds(
  parsedResults: Array<{ TextOverlay?: { Lines?: Array<{ LineText?: string; MinTop?: number | string; MaxHeight?: number | string; Words?: Array<{ WordText?: string; Top?: number | string; Height?: number | string }> }> } }>,
  imageHeight: number,
): { top: number; bottom: number } | undefined {
  const lines = parsedResults.flatMap((result) => result.TextOverlay?.Lines ?? []).map((line) => {
    const wordTops = (line.Words ?? []).map((word) => coordinate(word.Top)).filter((value): value is number => value !== undefined);
    const wordHeights = (line.Words ?? []).map((word) => coordinate(word.Height)).filter((value): value is number => value !== undefined);
    const top = coordinate(line.MinTop) ?? Math.min(...wordTops, Number.POSITIVE_INFINITY);
    const height = coordinate(line.MaxHeight) ?? Math.max(...wordHeights, 0);
    const text = line.LineText ?? (line.Words ?? []).map((word) => word.WordText ?? '').join(' ');
    return { top, bottom: top + height, text };
  }).filter((line) => Number.isFinite(line.top) && line.bottom > line.top);
  const headerLines = lines.filter((line) => (
    line.top < imageHeight * 0.35 && /(?:^@|instagram|tiktok|following|followers|\bfollow\b|팔로우|팔로워|프로필)/iu.test(line.text)
  ));
  const footerLines = lines.filter((line) => (
    line.top > imageHeight * 0.55 && /(?:likes?|comments?|repl(?:y|ies)|share|save|view translation|see translation|좋아요|댓글|공유|저장|번역 보기|답글)/iu.test(line.text)
  ));
  const footerMarkerCount = footerLines.reduce((total, line) => (
    total + [...line.text.matchAll(/likes?|comments?|repl(?:y|ies)|share|save|view translation|see translation|좋아요|댓글|공유|저장|번역 보기|답글/giu)].length
  ), 0);
  if (headerLines.length === 0 || footerMarkerCount < 2) return undefined;

  const margin = Math.round(imageHeight * 0.035);
  const top = Math.max(0, Math.floor(Math.max(...headerLines.map((line) => line.bottom)) - margin));
  const bottom = Math.min(imageHeight, Math.ceil(Math.min(...footerLines.map((line) => line.top)) + margin));
  return bottom - top >= imageHeight * 0.5 ? { top, bottom } : undefined;
}

function getOcrUsabilityReason(text: string): string {
  const normalized = cleanOcrText(text).replace(/[^\p{L}\p{N}]/gu, '');
  const japaneseCharacters = [...normalized].filter((character) => /[\u3040-\u30ff\u3400-\u9fff]/u.test(character)).length;
  if (normalized.length < 3) return 'TOO_SHORT';
  if (japaneseCharacters < 2) return 'INSUFFICIENT_JAPANESE';
  if (japaneseCharacters / normalized.length < 0.35) return 'MIXED_SCRIPT_NOISE';
  return 'USEFUL_JAPANESE_TEXT';
}

const ocrCache = new InMemoryTtlCache<OcrExtraction>({
  clone: (result) => ({
    ...result,
    text: redactCredentialText(result.text),
    ...(result.rawText ? { rawText: redactCredentialText(result.rawText) } : {}),
    ...(result.lines ? { lines: result.lines.map((line) => ({ ...line, text: redactCredentialText(line.text) })) } : {}),
  }),
});

async function extractJapaneseTextUncached(image: PreparedImage): Promise<OcrExtraction> {
  try {
    const supportedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
    if (image.buffer.length === 0 || !supportedMimeTypes.has(image.mimeType)) {
      throw new ExternalProviderError('OCR_SPACE_ERROR');
    }

    const extension = image.mimeType === 'image/jpeg' ? 'jpg' : image.mimeType.split('/')[1];
    const file = new File([new Uint8Array(image.buffer)], `manga-image.${extension}`, { type: image.mimeType });
    const formData = new FormData();
    formData.append('file', file);
    formData.append('language', process.env.language?.trim() || 'jpn');
    formData.append('isOverlayRequired', 'true');
    formData.append('OCREngine', process.env.OCREngine?.trim() || '3');
    const apiKey = requiredApiKey('OCR_SPACE_API_KEY');
    const response = await fetchWithTimeout('https://api.ocr.space/parse/image', {
      method: 'POST',
      headers: { apikey: apiKey },
      body: formData,
    });
    const responseData = await readJson(response);
    const parsed = ocrResponseSchema.safeParse(responseData);
    if (!response.ok || !parsed.success || parsed.data.IsErroredOnProcessing === true || parsed.data.IsErroredOnProcessing === 'true') {
      throw new ExternalProviderError('OCR_SPACE_ERROR');
    }

    const layouts = (parsed.data.ParsedResults ?? []).map(restoreJapaneseLayout);
    const rawText = layouts
      .map((layout) => layout.rawText)
      .filter(Boolean)
      .join('\n');
    const text = cleanOcrText(rawText);
    const lines = layouts.flatMap((layout) => layout.lines);
    const ocrConfidence = readOcrConfidence(parsed.data.ParsedResults ?? []);
    const socialCropBounds = readSocialCropBounds(parsed.data.ParsedResults ?? [], image.height);
    const ocrUsabilityReason = getOcrUsabilityReason(text);
    if (process.env.NODE_ENV !== 'production') {
      console.info('[OCR RESULT]', {
        textLength: text.length,
        ocrConfidence: ocrConfidence ?? null,
        ocrUsabilityReason,
        socialCropDetected: Boolean(socialCropBounds),
        usefulJapaneseText: isUsefulJapaneseText(text),
      });
    }
    return {
      text,
      rawText,
      lines,
      valid: isUsefulJapaneseText(text),
      ...(ocrConfidence === undefined ? {} : { ocrConfidence }),
      ...(socialCropBounds ? { socialCropBounds } : {}),
    };
  } catch (error) {
    if (!(error instanceof ExternalProviderError)) {
      console.error('[OCR ERROR]', { type: error instanceof Error ? error.name : 'UNKNOWN' });
    }
    if (error instanceof ExternalProviderError) throw error;
    throw new ExternalProviderError('OCR_SPACE_ERROR');
  }
}

export function extractJapaneseText(image: PreparedImage): Promise<OcrExtraction> {
  const language = process.env.language?.trim() || 'jpn';
  const engine = process.env.OCREngine?.trim() || '3';
  const key = hashResearchCacheText('ocr-v3', JSON.stringify([hashImageForResearchCache(image), language, engine]));
  return ocrCache.getOrLoad(key, () => extractJapaneseTextUncached(image));
}

export { cleanOcrText, getOcrUsabilityReason, isUsefulJapaneseText, readOcrConfidence, readSocialCropBounds };
