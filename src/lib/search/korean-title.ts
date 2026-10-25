export function normalizeKoreanSearchTranslation(value: string | null | undefined): string | null {
  if (!value) return null;
  const title = value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  return title.length <= 120 && /[가-힣]/u.test(title) && !/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(title)
    ? title : null;
}

export function isJapaneseTitleText(value: string | null): boolean {
  return Boolean(value && (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value)
    || (/\p{Script=Han}/u.test(value) && !/[가-힣]/u.test(value))));
}

function normalizeKoreanTitle(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
}

export function koreanTitleSimilarity(left: string, right: string): number {
  if (!/[가-힣]/u.test(left) || !/[가-힣]/u.test(right)) return 0;
  const leftCharacters = [...normalizeKoreanTitle(left).normalize('NFD')];
  const rightCharacters = [...normalizeKoreanTitle(right).normalize('NFD')];
  if (!leftCharacters.length || !rightCharacters.length || leftCharacters.length > 1_000 || rightCharacters.length > 1_000) return 0;
  const matches = Array<number>(rightCharacters.length + 1).fill(0);
  for (let leftIndex = 1; leftIndex <= leftCharacters.length; leftIndex += 1) {
    let diagonal = 0;
    for (let rightIndex = 1; rightIndex <= rightCharacters.length; rightIndex += 1) {
      const above = matches[rightIndex];
      matches[rightIndex] = leftCharacters[leftIndex - 1] === rightCharacters[rightIndex - 1]
        ? diagonal + 1
        : Math.max(above, matches[rightIndex - 1]);
      diagonal = above;
    }
  }
  return 2 * matches[rightCharacters.length] / (leftCharacters.length + rightCharacters.length);
}

export function findMatchingKoreanTitle(reference: string, titles: string[]): string | undefined {
  const normalized = normalizeKoreanTitle(reference);
  if (!normalized) return undefined;
  const exact = titles.find((title) => normalizeKoreanTitle(title) === normalized);
  if (exact) return exact;
  const matches = [...new Map(titles.filter((title) => koreanTitleSimilarity(reference, title) >= 0.9)
    .map((title) => [normalizeKoreanTitle(title), title])).values()];
  return matches.length === 1 ? matches[0] : undefined;
}