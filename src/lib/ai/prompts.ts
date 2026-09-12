export const imageAnalysisPrompt = `
You analyze 1 to 3 Japanese manga screenshots.
Extract search clues only. Do not identify or rank the final manga.
Return JSON only with these keys:
{
  "japaneseTexts": string[],
  "suspectedTitles": string[],
  "characterNames": string[],
  "authorClues": string[],
  "publisherClues": string[],
  "serializationClues": string[],
  "visualClues": string[],
  "imageStatuses": ["SUCCESS" | "INSUFFICIENT" | "FAILED"]
}
Do not invent text that is not visible. Use empty arrays when a clue is unavailable.
`;

export const japaneseSearchPrompt = (imageAnalysis: unknown): string => `
Find Japanese manga candidates using the verified image clues below.
Use Google Search grounding. Return at most three candidates with evidence.
Do not return a candidate without at least one evidence code.
Return JSON only:
{
  "candidates": [{
    "rank": 1 | 2 | 3,
    "japaneseTitle": string,
    "author": string | null,
    "confidence": "HIGH" | "MEDIUM" | "LOW",
    "evidence": ["DIALOGUE_MATCH" | "CHARACTER_NAME_MATCH" | "WORK_TITLE_MATCH" | "AUTHOR_MATCH" | "PUBLISHER_MATCH" | "SERIALIZATION_MATCH" | "VISUAL_CLUE_MATCH" | "SEARCH_CONSISTENCY"],
    "searchSupport": string[]
  }]
}
Verified image clues:
${JSON.stringify(imageAnalysis)}
`;

export const koreanInvestigationPrompt = (candidates: unknown): string => `
Investigate Korean title and Korean publication status for each fixed-rank Japanese manga candidate.
Use Google Search grounding. Preserve every input rank exactly and do not invent a new candidate.
Use OFFICIAL only for a verified official Korean title, COMMON for a repeated unofficial Korean title,
TRANSLATED only for an AI reference translation, and UNKNOWN when evidence is insufficient or conflicting.
Return JSON only:
{
  "candidateResults": [{
    "rank": 1 | 2 | 3,
    "koreanTitle": string | null,
    "koreanTitleStatus": "OFFICIAL" | "COMMON" | "TRANSLATED" | "UNKNOWN",
    "publicationStatus": "CONFIRMED" | "NOT_FOUND" | "UNKNOWN",
    "investigationStatus": "SUCCESS" | "INSUFFICIENT" | "FAILED" | "TIMEOUT",
    "searchSupport": string[]
  }]
}
Candidates:
${JSON.stringify(candidates)}
`;

export const finalJudgmentPrompt = (
  imageAnalysis: unknown,
  japaneseCandidates: unknown,
  koreanInvestigation: unknown,
): string => `
Make the final judgment for the fixed Japanese manga candidates.
Do not perform a new web search and do not add a new candidate.
Use only the verified inputs below. Preserve candidate ranks 1 through 3 where present.
When Korean investigation is unavailable, use koreanTitle null, title status UNKNOWN,
and publication status UNKNOWN.
Return JSON only as an object with a candidates array using the public Candidate fields:
{
  "candidates": [{
    "rank": 1 | 2 | 3,
    "japaneseTitle": string,
    "koreanTitle": string | null,
    "koreanTitleStatus": "OFFICIAL" | "COMMON" | "TRANSLATED" | "UNKNOWN",
    "publicationStatus": "CONFIRMED" | "NOT_FOUND" | "UNKNOWN",
    "confidence": "HIGH" | "MEDIUM" | "LOW",
    "evidence": [...EvidenceCode],
    "author": string | null,
    "koreanInvestigationStatus": "SUCCESS" | "PARTIAL" | "INSUFFICIENT" | "FAILED" | "TIMEOUT" | "SKIPPED"
  }]
}
Image analysis:
${JSON.stringify(imageAnalysis)}
Japanese candidates:
${JSON.stringify(japaneseCandidates)}
Korean investigation:
${JSON.stringify(koreanInvestigation)}
`;
