import type { QueryType } from './types';

export interface OcrQueryRefinement {
  rawText: string;
  titleCandidates: string[];
  dialogueCandidates: string[];
  noise: string[];
  queryType: QueryType;
}

const bracketTitlePattern = /[『「【《]([^』」】》]{1,80})[』」】》]/gu;
const noisePatterns = [
  /\d{1,3}周年/gu,
  /\d{1,2}月(?:\d{1,2}日)?/gu,
  /(?:発売|記念本|原画集|インタビュー集|インタビュー|最新刊|新刊|コミックス発売)/gu,
];

function normalizeText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function isUsefulJapanese(value: string): boolean {
  const meaningful = value.replace(/[^\p{L}\p{N}]/gu, '');
  return meaningful.length >= 3 && /[\u3040-\u30ff\u3400-\u9fff]/u.test(meaningful);
}

function extractNoise(value: string): string[] {
  return [...new Set(noisePatterns.flatMap((pattern) => [...value.matchAll(pattern)].map((match) => match[0])))];
}

function extractDialogueCandidates(value: string): string[] {
  const cleaned = noisePatterns.reduce((current, pattern) => current.replace(pattern, ' '), value)
    .replace(/[『」「』【】《》]/gu, ' ')
    .replace(/[&|｜]/gu, ' ');
  const chunks = cleaned
    .split(/[\r\n。！？!?、]+/u)
    .map(normalizeText)
    .filter((chunk) => isUsefulJapanese(chunk))
    .sort((left, right) => right.length - left.length);
  return [...new Set(chunks)].slice(0, 2).map((chunk) => chunk.slice(0, 80));
}

export function refineOcrQueries(rawTexts: string[]): OcrQueryRefinement {
  const rawText = rawTexts.filter(Boolean).join('\n');
  const bracketTitles = [...rawText.matchAll(bracketTitlePattern)]
    .map((match) => normalizeText(match[1] ?? ''))
    .filter(isUsefulJapanese);
  const titleCandidates = [...new Set(bracketTitles)].slice(0, 3);
  const dialogueCandidates = titleCandidates.length > 0 ? [] : extractDialogueCandidates(rawText);
  const noise = extractNoise(rawText);
  const queryType: QueryType = titleCandidates.length > 0
    ? 'TITLE'
    : dialogueCandidates.length > 0
      ? 'DIALOGUE'
      : 'NONE';

  return { rawText, titleCandidates, dialogueCandidates, noise, queryType };
}

export function buildRefinedJapaneseQueries(refinement: OcrQueryRefinement): string[] {
  const clues = refinement.queryType === 'TITLE' ? refinement.titleCandidates : refinement.dialogueCandidates;
  return clues.slice(0, 2).map((clue) => `"${clue}" 漫画`);
}
