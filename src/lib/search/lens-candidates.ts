import type { LensCandidateEvidence, LensEvidenceType, LensMatch, RankedLensCandidate } from './types';

const japaneseTextPattern = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー・「」『』【】\s]{2,}/gu;
const japaneseHashtagPattern = /#([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{N}ー・_]{3,})/gu;
const trailingNoisePattern = /(?:公式(?:サイト|ページ|アカウント)?|連載(?:サイト|ページ)?|コミックス?|マンガ|漫画|電子書籍|試し読み|無料公開|最新刊|新刊|発売中|作品ページ|投稿画像|投稿|画像|イラスト|おすすめ|紹介|まとめ|一覧|特集|記事|ページ|サイト|第\d+(?:話|巻|章)|第)+$/u;
const leadingNoisePattern = /^(?:公式|無料公開|話題の新作|新作漫画|漫画作品|マンガ作品)+/u;
const servicePattern = /(?:chatbot|ai assistant|assistant|application|\bapp\b|download|pinterest|gallery|collection|アプリ|チャットボット|商品|グッズ)/iu;
const officialDomainPattern = /(?:publisher|manga|comic|comics|shueisha|kodansha|shogakukan|mangaplus|web-ace|jump|magazine)/iu;
const genericTitlePattern = /^(?:アニメ|漫画|マンガ|コミック|コミックス|作品|公式|投稿|画像|イラスト|コミックナタリー|ナタリー)$/u;
const socialPostWrapperPattern = /(?:\bon\s+(?:X|Twitter|Instagram|TikTok)\s*:|\bInstagram\b.*\b(?:followers|following)\b)/iu;
const quotedTitlePattern = /(?:^|[『「【《])([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー・\s]{3,48})[』」】》]/gu;

function cleanJapaneseCandidate(value: string): string | null {
  let title = value
    .normalize('NFKC')
    .replace(/^[#\s「」『』【】《》:：|｜]+|[#\s「」『』【】《》:：|｜]+$/gu, '')
    .replace(/[\s\p{P}\p{S}]/gu, '');

  let previous = '';
  while (title !== previous) {
    previous = title;
    title = title.replace(trailingNoisePattern, '').replace(leadingNoisePattern, '');
  }

  if (!/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(title)) return null;
  if (genericTitlePattern.test(title)) return null;
  if ([...title].length < 3) return null;
  return title;
}

export function normalizeJapaneseTitle(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('ja')
    .replace(/[\s\p{P}\p{S}]/gu, '');
}

function sourceDomain(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./u, '').toLocaleLowerCase('en');
  } catch {
    return value.toLocaleLowerCase('en');
  }
}

function decodedPath(value: string): string {
  try {
    return decodeURIComponent(new URL(value).pathname);
  } catch {
    return '';
  }
}

function addTextEvidence(
  target: LensCandidateEvidence[],
  text: string,
  match: LensMatch,
  evidenceType: LensEvidenceType,
): void {
  const position = match.position ?? (match.sourceIndex === undefined ? 0 : match.sourceIndex + 1);
  const context = text.slice(0, 240);
  const add = (rawCandidate: string, type: LensEvidenceType) => {
    const candidateTitle = cleanJapaneseCandidate(rawCandidate);
    if (!candidateTitle) return;
    const normalizedTitle = normalizeJapaneseTitle(candidateTitle);
    if (target.some((item) => item.normalizedTitle === normalizedTitle && item.sourceUrl === match.link)) return;
    target.push({
      rawTitle: match.title,
      candidateTitle,
      normalizedTitle,
      sourceUrl: match.link,
      sourceDomain: sourceDomain(match.link),
      lensPosition: position,
      evidenceType: type,
      context,
    });
  };

  for (const hashtag of text.matchAll(japaneseHashtagPattern)) add(hashtag[1] ?? '', 'HASHTAG');
  for (const quotedTitle of text.matchAll(quotedTitlePattern)) add(quotedTitle[1] ?? '', 'QUOTED_TITLE');
  for (const phrase of text.matchAll(japaneseTextPattern)) add(phrase[0], evidenceType);
}

function evidenceForMatch(match: LensMatch): LensCandidateEvidence[] {
  const evidence: LensCandidateEvidence[] = [];
  addTextEvidence(evidence, match.title, match, 'TITLE');
  if (match.snippet) addTextEvidence(evidence, match.snippet, match, 'SNIPPET');
  const path = decodedPath(match.link);
  if (path) addTextEvidence(evidence, path, match, 'URL');
  return evidence;
}

export function rankLensCandidates(matches: LensMatch[]): RankedLensCandidate[] {
  const grouped = new Map<string, LensCandidateEvidence[]>();
  const matchScores = new Map<string, number>();

  for (const match of matches) {
    for (const evidence of evidenceForMatch(match)) {
      const group = grouped.get(evidence.normalizedTitle) ?? [];
      const duplicate = group.some((existing) => (
        existing.sourceUrl === evidence.sourceUrl && existing.evidenceType === evidence.evidenceType
      ));
      if (!duplicate) group.push(evidence);
      grouped.set(evidence.normalizedTitle, group);
      if (typeof match.matchScore === 'number' && Number.isFinite(match.matchScore)) {
        matchScores.set(evidence.normalizedTitle, Math.max(matchScores.get(evidence.normalizedTitle) ?? 0, match.matchScore));
      }
    }
  }

  return [...grouped.entries()].map(([normalizedTitle, evidence]) => {
    const primaryEvidence = evidence
      .slice()
      .sort((left, right) => {
        const priority = (type: LensEvidenceType) => type === 'HASHTAG' ? 0 : type === 'QUOTED_TITLE' ? 1 : type === 'TITLE' ? 2 : type === 'SNIPPET' ? 3 : 4;
        return priority(left.evidenceType) - priority(right.evidenceType)
          || left.lensPosition - right.lensPosition
          || right.candidateTitle.length - left.candidateTitle.length;
      })[0];
    const candidateTitle = primaryEvidence?.candidateTitle ?? '';
    const sources = new Set(evidence.map((item) => item.sourceDomain).filter(Boolean));
    const titleSources = new Set(evidence
      .filter((item) => item.evidenceType === 'TITLE' || item.evidenceType === 'QUOTED_TITLE' || item.evidenceType === 'HASHTAG')
      .map((item) => item.sourceDomain)
      .filter(Boolean));
    const hashtagSources = new Set(evidence.filter((item) => item.evidenceType === 'HASHTAG').map((item) => item.sourceDomain).filter(Boolean));
    const officialSources = new Set([...sources].filter((domain) => officialDomainPattern.test(domain)));
    const unrelatedTitle = servicePattern.test(candidateTitle);
    const firstPosition = Math.min(...evidence.map((item) => item.lensPosition).filter((position) => position > 0), 20);
    const score = sources.size * 3
      + titleSources.size * 2
      + hashtagSources.size * 3
      + officialSources.size * 2
      + Math.max(0, 5 - Math.floor(Math.max(1, firstPosition) / 3))
      + Math.round(Math.min(1, matchScores.get(normalizedTitle) ?? 0) * 2)
      - (unrelatedTitle ? 12 : 0);
    const hasHashtagEvidence = evidence.some((item) => item.evidenceType === 'HASHTAG');
    const hasQuotedTitleEvidence = evidence.some((item) => item.evidenceType === 'QUOTED_TITLE');
    const hasCleanDirectTitle = evidence.some((item) => (
      item.evidenceType === 'TITLE'
      && [...item.candidateTitle].length <= 32
      && item.rawTitle.length <= 52
      && !socialPostWrapperPattern.test(item.rawTitle)
    ));
    const confidence: RankedLensCandidate['confidence'] = hasHashtagEvidence && score >= 7
      || hasQuotedTitleEvidence && officialSources.size > 0 && score >= 7
      || hasCleanDirectTitle && titleSources.size >= 2 && score >= 9
      ? 'HIGH'
      : hasHashtagEvidence || hasQuotedTitleEvidence || hasCleanDirectTitle
        ? 'MEDIUM'
        : 'LOW';
    return {
      clusterId: `lens-${normalizedTitle}`,
      rawTitle: primaryEvidence?.rawTitle ?? candidateTitle,
      candidateTitle,
      extractedJapaneseTitle: candidateTitle,
      normalizedTitle,
      source: primaryEvidence?.sourceDomain ?? '',
      url: primaryEvidence?.sourceUrl ?? '',
      position: primaryEvidence?.lensPosition ?? 0,
      confidence,
      score,
      independentSourceCount: sources.size,
      evidence,
    };
  }).filter((candidate) => candidate.candidateTitle && candidate.score > 0)
    .sort((left, right) => right.score - left.score
      || right.independentSourceCount - left.independentSourceCount
      || left.candidateTitle.localeCompare(right.candidateTitle, 'ja'));
}

export function selectLensQueries(candidates: RankedLensCandidate[], limit = 2): string[] {
  const queries: string[] = [];
  const usedTitles = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate.candidateTitle || usedTitles.has(candidate.normalizedTitle)) continue;
    usedTitles.add(candidate.normalizedTitle);
    queries.push(`${candidate.candidateTitle} 漫画`);
    if (queries.length >= limit) break;
  }
  return queries;
}