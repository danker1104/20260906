import type { OcrLine, QueryType } from './types';

export interface OcrQueryRefinement {
  rawText: string;
  titleCandidates: string[];
  dialogueCandidates: string[];
  noise: string[];
  queryType: QueryType;
  contextKeywords?: string[];
  confidence?: number;
  hasUsefulText?: boolean;
}

const bracketTitlePattern = /[『「【《]([^』」】》]{1,80})[』」】》]/gu;
const noisePatterns = [
  /\d{1,3}周年/gu,
  /\d{1,2}月(?:\d{1,2}日)?/gu,
  /(?:発売|記念本|原画集|インタビュー集|インタビュー|最新刊|新刊|コミックス発売)/gu,
];
const socialUiPattern = /^(?:フォロー(?:中)?|フォロワー|いいね|コメント|シェア|保存|プロフィール|おすすめ|ホーム|検索|following|follow|likes?|comments?|reposts?|replies|views?)$/iu;
const socialUiCluePattern = /フォロー|フォロワー|いいね|コメント|シェア|保存|プロフィール|view translation|see translation|following|followers|likes?|comments?|share|save|views?/iu;
const shortReactionPattern = /(?:最高|かわいい|可愛い|尊い|面白かった|大好き|好きすぎる|読んでみて|おすすめ|続きが気になる|so cute|love this|must read)/iu;

function normalizeText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function isUsefulJapanese(value: string): boolean {
  const meaningful = value.replace(/[^\p{L}\p{N}]/gu, '');
  const japaneseCharacters = [...meaningful].filter((character) => /[\u3040-\u30ff\u3400-\u9fff]/u.test(character)).length;
  return meaningful.length >= 3 && japaneseCharacters >= 2 && japaneseCharacters / meaningful.length >= 0.35;
}

export function scoreOcrTitleCandidate(value: string): { score: number; accepted: boolean; reasons: string[] } {
  const normalized = normalizeText(value);
  const meaningful = normalized.replace(/[^\p{L}\p{N}]/gu, '');
  const japaneseCharacters = [...meaningful].filter((character) => /[\u3040-\u30ff\u3400-\u9fff]/u.test(character)).length;
  const japaneseRatio = meaningful.length > 0 ? japaneseCharacters / meaningful.length : 0;
  const reasons: string[] = [];
  let score = 0;

  if (japaneseRatio >= 0.7) { score += 35; reasons.push('JAPANESE_DOMINANT'); }
  else if (japaneseRatio >= 0.45) { score += 18; reasons.push('MIXED_JAPANESE'); }
  else { score -= 15; reasons.push('LOW_JAPANESE_RATIO'); }

  if (meaningful.length >= 5 && meaningful.length <= 32) { score += 20; reasons.push('TITLE_LENGTH'); }
  else if (meaningful.length >= 3 && meaningful.length < 5) { score += 12; reasons.push('SHORT_TITLE_PRESERVED'); }
  else if (meaningful.length <= 80 && meaningful.length > 32) { score += 10; reasons.push('LONG_TITLE_PRESERVED'); }
  else if (meaningful.length > 80) { score -= 15; reasons.push('LONG_TEXT'); }

  if (/[『「【《].+[』」】》]/u.test(normalized)) { score += 15; reasons.push('TITLE_BRACKETS'); }
  if (!/[。！？!?]$/u.test(normalized)) { score += 10; reasons.push('NOT_SENTENCE_ENDED'); }
  if (/@[\p{L}\p{N}_.]{2,}/u.test(normalized)) { score -= 60; reasons.push('ACCOUNT_HANDLE'); }
  if (socialUiCluePattern.test(normalized)) { score -= 60; reasons.push('SOCIAL_UI'); }
  if (/\b(?:follow|instagram|tiktok|new chapter|chapter update|view translation|see translation|tap to|swipe up)\b/iu.test(normalized)) {
    score -= 35;
    reasons.push('ENGLISH_CAPTION_OR_UI');
  }
  if (/\d{4,}|\d{1,2}月|\d{1,2}日|\b\d{1,2}:\d{2}\b/u.test(normalized)) { score -= 25; reasons.push('DATE_OR_NUMBER'); }
  if (shortReactionPattern.test(normalized) && /[。！？!?]$/u.test(normalized)) { score -= 25; reasons.push('REACTION_SENTENCE'); }

  return {
    score,
    accepted: japaneseCharacters >= 2 && japaneseRatio >= 0.45 && score >= 35 && !/@[\p{L}\p{N}_.]{2,}/u.test(normalized) && !socialUiCluePattern.test(normalized),
    reasons,
  };
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
    .filter((chunk) => !socialUiPattern.test(chunk) && isUsefulJapanese(chunk))
    .sort((left, right) => right.length - left.length);
  return [...new Set(chunks)].slice(0, 2).map((chunk) => chunk.slice(0, 80));
}

function adjacentLines(previous?: OcrLine, next?: OcrLine): boolean {
  if (!previous || !next) return true;
  if (previous.top !== undefined && next.top !== undefined && previous.height && next.height) {
    const gap = next.top - previous.top - previous.height;
    if (gap < -Math.min(previous.height, next.height) * 0.5 || gap > Math.max(previous.height, next.height) * 1.5) return false;
    if (Math.max(previous.height, next.height) > Math.min(previous.height, next.height) * 2) return false;
  }
  if (previous.left !== undefined && next.left !== undefined && previous.width && next.width) {
    return Math.min(previous.left + previous.width, next.left + next.width) > Math.max(previous.left, next.left);
  }
  return true;
}

function extractLineTitles(rawText: string, layout: OcrLine[] = []): string[] {
  const lines = rawText.split(/\r?\n/u).map((line) => normalizeText(line).replace(/\s+(?:漫画|マンガ|コミック)$/u, ''));
  let layoutIndex = 0;
  const positions = lines.map((text) => {
    const index = layout.findIndex((line, index) => index >= layoutIndex && normalizeText(line.text) === text);
    if (index < 0) return undefined;
    layoutIndex = index + 1;
    return layout[index];
  });
  const isTitleLine = (line: string) => line.length <= 80
    && (scoreOcrTitleCandidate(line).accepted || /^[\u3040-\u30ff\u3400-\u9fff]$/u.test(line))
    && !/[。！？!?、,『「【《]/u.test(line)
    && !/^(?:そんな|俺が|誰にも)/u.test(line)
    && !/^(?:漫画|マンガ|コミック)$/u.test(line)
    && !/팔로우|번역 보기|좋아요|댓글/u.test(line);
  const candidates: string[] = [];
  for (let start = 0; start < lines.length && candidates.length < 24; start += 1) {
    if (!isTitleLine(lines[start])) continue;
    let combined = lines[start];
    const combinations = [combined];
    for (let end = start + 1; end < Math.min(lines.length, start + 6); end += 1) {
      if (!isTitleLine(lines[end]) || !adjacentLines(positions[end - 1], positions[end]) || combined.length + lines[end].length > 80) break;
      combined += lines[end];
      combinations.push(combined);
    }
    candidates.push(...combinations.reverse().filter((candidate) => scoreOcrTitleCandidate(candidate).accepted));
  }
  return [...new Set(candidates)].slice(0, 6);
}

export function refineOcrQueries(rawTexts: string[], layouts: OcrLine[][] = []): OcrQueryRefinement {
  const rawText = rawTexts.filter(Boolean).join('\n');
  const bracketTitles = [...rawText.matchAll(bracketTitlePattern)]
    .map((match) => normalizeText(match[1] ?? ''))
    .filter((title) => isUsefulJapanese(title) && scoreOcrTitleCandidate(title).accepted);
  const hashtagTitles = [...rawText.matchAll(/#([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー・]{3,80})/gu)]
    .map((match) => match[1]).filter((title) => scoreOcrTitleCandidate(title).accepted);
  const titleCandidates = [...new Set([...bracketTitles, ...hashtagTitles, ...rawTexts.flatMap((text, index) => extractLineTitles(text, layouts[index]))])].slice(0, 6);
  const dialogueCandidates = extractDialogueCandidates(rawText);
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
