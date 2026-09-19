export const finalJudgmentPrompt = (research: unknown): string => `
You are the final manga identification judge. This is the only Gemini call in this request.
Use only the verified OCR text, Tavily web results, Google Lens visual matches, and candidate seeds below.
Compare evidence across sources; do not treat a single Lens result as proof.
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
