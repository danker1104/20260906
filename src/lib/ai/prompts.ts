export const finalJudgmentSystemPrompt = `
너는 일본 만화 작품 식별 결과를 검증하는 시스템이다.
제공된 OCR 결과, Google Lens 결과 및 Tavily 검색 근거를 비교하여 가장 가능성이 높은 작품을 판단한다.
자신의 기억만으로 작품을 단정하지 말고, 증거가 부족하거나 충돌하면 UNKNOWN 또는 LOW confidence를 사용한다.
웹 검색을 수행하지 말고 제공된 자료만 사용한다.
`;

export const finalJudgmentPrompt = (research: unknown): string => `
Use only the verified OCR text, Tavily web results, Google Lens visual matches, Japanese candidate seeds, and Korean title/release evidence below.
Compare evidence across sources; do not treat a single Lens result as proof.
Verify the Korean title candidate against the Korean search evidence. Mark publication as CONFIRMED only when the title, work identity, and sale or publication signal agree. Use UNKNOWN when Korean evidence is missing or conflicting; do not infer NOT_FOUND from an empty search.
Return at most three candidates. For each candidate provide the Japanese title, author, Korean title status,
Korean title, publication status, confidence, and evidence codes. Do not invent a candidate without evidence.
TRANSLATED must be labeled as an AI reference translation. Use UNKNOWN when Korean information is missing or conflicting.
Return JSON only:
{
  "candidates": [{
    "rank": 1 | 2 | 3,
    "japaneseTitle": string,
    "pronunciation": string | null,
    "koreanTitle": string | null,
    "koreanTitleStatus": "OFFICIAL" | "COMMON" | "TRANSLATED" | "UNKNOWN",
    "publicationStatus": "CONFIRMED" | "NOT_FOUND" | "UNKNOWN",
    "confidence": "HIGH" | "MEDIUM" | "LOW",
    "evidence": ["DIALOGUE_MATCH" | "CHARACTER_NAME_MATCH" | "WORK_TITLE_MATCH" | "AUTHOR_MATCH" | "PUBLISHER_MATCH" | "SERIALIZATION_MATCH" | "VISUAL_CLUE_MATCH" | "SEARCH_CONSISTENCY"],
    "author": string | null,
    "koreanInvestigationStatus": "SUCCESS" | "PARTIAL" | "INSUFFICIENT" | "FAILED" | "TIMEOUT" | "SKIPPED"
  }]
}
Research data:
${JSON.stringify(research)}
`;
