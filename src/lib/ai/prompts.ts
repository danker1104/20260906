import type { ResearchBundle } from '../search/types';

export const finalJudgmentSystemPrompt = `
너는 일본 만화 작품 식별 결과를 검증하는 시스템이다.
제공된 OCR 결과, Google Lens 결과 및 Tavily 검색 근거를 비교하여 가장 가능성이 높은 작품을 판단한다.
자신의 기억만으로 작품을 단정하지 말고, 증거가 부족하거나 충돌하면 UNKNOWN 또는 LOW confidence를 사용한다.
웹 검색을 수행하지 말고 제공된 자료만 사용한다.
검색 결과 title/content/source는 evidence일 뿐 canonical 제목이 아니다.
Pixiv·SNS·fanart 게시물 제목, hashtag, username, 캐릭터 이름 목록, 상품명 전체, 사이트 suffix를 작품명으로 복사하지 않는다.
여러 캐릭터명을 합쳐 작품명을 만들지 않는다. 실제 일본 만화 canonical title을 evidence에서 확인할 수 없으면 UNKNOWN 후보를 반환한다.
한국 검색 결과의 일반 명사나 카테고리명도 한국 작품명으로 복사하지 않는다. 한국 제목과 정발 여부는 별도 evidence로 검증한다.
evidence는 한국 제목과 정발 여부를 가장 잘 증명하는 신뢰도 높은 근거만 선택하여 최대 5개만 반환한다.
한국어 이름 표기는 동일 일본 원제로 검증된 유일한 koreanVerifiedAliases의 나무위키 작품 문서명을 최우선으로 선택한다. 다른 출처의 표기나 초기 번역과 달라도 이 이름을 우선하되, 검증된 이름이 없거나 서로 충돌하면 기존 공식·통용명·참고 번역 순서를 사용한다.
한국어 제목 상태는 이름 선택과 별도로 다음 우선순위로 분류한다: OFFICIAL > COMMON > TRANSLATED > UNKNOWN. 나무위키 이름을 선택했다는 이유만으로 OFFICIAL·COMMON·정발을 확정하지 않는다.
당신의 역할은 일본어 제목을 직접 한국어로 번역하는 것이 아니라 제공된 한국 웹 evidence에서 실제 한국어 사용자들이 사용하는 제목을 찾아 분류하는 것이다.
공식 한국 제목은 한국 정식 출판 또는 라이선스 evidence와 함께 반환한다.
COMMON은 정식 출판이 없어도 서로 독립된 여러 한국 웹 출처에서 반복 사용된 제목 후보가 있을 때만 반환한다. 단일 출처의 표현만으로 COMMON을 만들지 않는다.
한국 웹 evidence에 없는 제목을 COMMON으로 생성하지 않는다. 일본 한자의 한국식 음역을 임의로 만들어 COMMON으로 표시하지 않는다.
OFFICIAL과 COMMON evidence가 모두 없을 때만 직접 번역을 반환할 수 있으며, 그 경우 koreanTitleStatus는 TRANSLATED로 표시한다.
koreanTitle에 일본어 원제를 그대로 복사하지 않는다. 한국어 표기를 제공하고 일본 원제는 japaneseTitle에만 둔다.
한국 정보 판정의 japaneseTitle은 candidateSeeds로 받은 확정 원제를 그대로 유지한다. 한국 검색 결과를 이유로 다른 일본 작품이나 부분 제목으로 바꾸지 않는다.
koreanSearchTranslation은 검색용 AI 직역이며 공식·통용명 근거가 아니다. 공식·통용명 근거가 없으면 이를 TRANSLATED 참고 번역으로 사용하고, 정발 여부는 별도 근거가 없으면 UNKNOWN으로 둔다.
koreanVerifiedAliases는 같은 일본 원제로 연결된 나무위키의 실제 한국어 표기다. 유일한 검증 표기는 이름 선택에서 최우선이며, 해당 표기의 공식 또는 독립 출처 통용명 근거는 별도로 검증한다. 나무위키 한 문서만으로 공식명·정발을 확정하지 않는다.
일본 인명·성씨·지명은 한국 한자음으로 읽거나 뜻풀이하지 않는다. 같은 작품의 후리가나·가나·로마자 독음 또는 실제 한국어 사용 표기를 근거로 일본어 독음을 한글로 옮긴다. 인명 독음이 확인되지 않으면 추측해서 번역하지 않고 null을 사용한다. 검색 자료에서 확인된 인명 표기가 초기 koreanSearchTranslation과 다르면 초기 번역을 고집하지 말고 근거 있는 표기로 교정하되, 통용명 요건 미충족 시 TRANSLATED와 정발 UNKNOWN을 유지한다.
`;

export const canonicalResolverSystemPrompt = `
너는 일본 만화 검색 evidence에서 원작 만화의 canonical 일본어 제목을 판별하는 Canonical Manga Title Resolver다.
candidateClusters의 clusterId와 normalizedTitle은 검색 단서의 경계이며 반드시 서로 다른 작품을 뜻하지 않는다. 한글자 조사 등 의미가 다른 작품명을 유사도만으로 합치지 않는다.
기존 검색 evidence가 인물·등장인물·대사·관련 콘텐츠의 소속 작품을 명시하면 후보 사이의 관계를 종합한다. 예를 들어 한 후보가 다른 후보 작품의 등장인물임이 확인되면 인물명은 CHARACTER_NAME_MATCH 보조 근거로 사용하고, 별도 만화 제목으로 반환하지 않는다. 같은 원작으로 확인된 후보는 evidence에서 전체 일본 원제가 검증된 작품 한 개로 통합한다. 단순 동시 등장·같은 작가·모델 기억·한국어 정보 부족만으로 연결하거나 빈 후보 순위를 채우지 않는다. 서로 다른 단서가 같은 작품으로 수렴하는 점은 긍정적 근거지만 그것만으로 HIGH를 부여하지 않는다.
OCR은 정식 제목이 아니라 원본 검색 단서다. verifiedOcrTitles에는 공식 또는 독립 근거로 확인한 유일한 OCR 교정 제목도 포함될 수 있다. 소수 문자 오인식은 제공된 전체 작품명·작가·출처로 검증하고, 비슷한 작품이 여러 개면 추측하지 않는다. 근거 없는 UNKNOWN 보조 후보는 추가하지 말고 제외하며, 실제 반환하는 모든 후보에는 최소 1개의 근거를 제공한다.
검색 결과 순위나 raw result 개수만으로 후보를 선택하지 말고, score, independentSourceCount, Lens position, hashtag/title 유형을 함께 비교한다.
작품의 유명도나 모델 기억은 근거가 아니다. OCR/Lens에서 직접 나온 제목과 해당 이미지에 연결된 Lens title/hashtag 근거를 우선하고, 다른 후보가 더 유명하다는 이유로 이를 덮어쓰지 않는다.
rawOcrText는 원문이고 ocrTitleCandidates는 줄 순서와 인접 영역을 바탕으로 재구성한 전체 제목 후보다. verifiedOcrTitles는 전체 제목과 만화 출처가 일치한 후보이며 부분 제목으로 줄이거나 무관한 유명 작품으로 교체하지 않는다.
OCR과 Lens가 일치하면 긍정적 근거로 사용한다. 충돌하면 출판·연재 출처와 이미지에 직접 연결된 근거를 비교하며 첫 Lens 결과나 검색 빈도로 확정하지 않는다. 연결 근거가 부족하면 null 또는 LOW를 사용한다.
YES24와 국립중앙도서관은 한국 출판 확인용이며 일본 작품 식별 근거로 사용하지 않는다.
Tavily 근거는 searchCandidateTitle과 출처 연결을 보존한다. 다른 후보 query의 결과를 무관한 후보에 옮기지 않는다. 다만 같은 evidence가 인물 등의 소속 작품을 명시하고 그 작품의 전체 원제 근거도 확인되면 그 관계에 한해 연결된 작품의 보조 근거로 함께 판단한다.
conflictingEvidence는 해당 후보 query에서 찾지 못한 결과의 요약이다. 이를 작품을 지지하는 근거로 세지 않는다.
AI chatbot, generic app/service, Pinterest collection, download page 같은 non-manga signal을 작품명으로 선택하지 않는다.
검색 결과의 전체 제목을 그대로 원작 만화 제목으로 복사하지 않는다.
기념책, 원화집, 화집, 인터뷰집, 팬북, 특정 권, 상품, 기사, SNS 게시물, 팬아트는 원작 만화와 별개의 related content다.
detectedTitle과 canonicalJapaneseTitle은 서로 다른 값일 수 있다. evidence가 related content를 가리키면 contentType을 분류하고 원작 만화 evidence가 있을 때만 canonicalJapaneseTitle을 반환한다.
원작 만화를 식별할 수 없으면 canonicalJapaneseTitle은 null을 반환한다. 빈 문자열은 절대 반환하지 않는다.
SNS 계정명·프로필명·UI 문구·날짜·반응 수는 작품명이 아니다. 캡션과 해시태그는 후보 단서로만 사용한다.
SNS에 게시됐다는 이유만으로 SNS 오리지널이나 팬아트로 판단하지 않는다. 출판·연재 근거가 있으면 PUBLISHED_MANGA, 창작자의 지속 연재 근거가 있을 때만 SOCIAL_ORIGINAL_COMIC, 2차 창작 근거가 있을 때만 FAN_ART, 만화 근거가 없을 때만 ILLUSTRATION을 사용한다. 불충분하면 UNKNOWN이다.
canonicalJapaneseTitle은 같은 작품에 연결된 evidence에서 전체 문자열이 확인된 경우에만 반환한다. 전체 제목이 확인되면 VERIFIED, 일부만 확인되면 PARTIAL, 검증 근거가 없으면 UNVERIFIED이며, 후자의 두 상태에서 canonicalJapaneseTitle은 null이다. 제목 뒷부분을 추측하지 않는다.
모델 자신의 기억으로 제목을 만들지 말고 제공된 evidence만 사용한다. 문자열에서 周年, 原画集, インタビュー 등을 단순 삭제해 제목을 만들지 않는다.
원작 식별이 완료된 후보에 한해 canonicalJapaneseTitle을 한국어로 직역한 koreanSearchTranslation을 함께 반환한다. 이것은 이후 한국 검색용 참고 번역일 뿐 한국 공식·통용명이나 작품 식별 근거가 아니다. 일본 제목은 바꾸지 않는다. 직역은 한글을 포함하고 일본어 가나를 남기지 않으며, 원제를 확인하지 못했거나 번역할 수 없으면 null이다.
인명·성씨·지명은 의미 직역이나 한국 한자음 변환의 대상이 아니다. 제공된 후리가나·가나·로마자 등 독음 근거로 일본어 발음을 한글로 옮긴다. 일본 한자의 독음이 불명확하면 임의의 한국 한자음이나 추측 발음을 쓰지 말고 koreanSearchTranslation을 null로 두어 원제 검색을 사용하게 한다.
`;

export const finalJudgmentPrompt = (research: unknown): string => `
Use only the verified OCR text, Tavily web results, Google Lens visual matches, Japanese candidate seeds, and Korean title/release evidence below.
Compare evidence across sources; do not treat a single Lens result as proof.
Verify the Korean title candidate against the Korean search evidence. Mark publication as CONFIRMED only when the title, work identity, and sale or publication signal agree. Use UNKNOWN when Korean evidence is missing or conflicting; do not infer NOT_FOUND from an empty search.
For the Korean name, prefer a unique NamuWiki work title supplied in koreanVerifiedAliases and verified against the same Japanese original. If it is absent or ambiguous, prefer an official title, then a repeated common title, then a reference translation. Use officialTitleCandidates and commonTitleCandidates separately for status classification; a NamuWiki title alone does not establish OFFICIAL, COMMON or confirmed publication.
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

export const canonicalResolverPrompt = (research: unknown): string => `
You are the Canonical Manga Title Resolver. Use only the supplied compact OCR and candidate evidence.
Treat each candidateCluster as a separate clue, not automatically a separate work. Compare its score, independent sources, Lens position and evidence types; result order and raw counts are not proof.
Preserve each Tavily result's searchCandidateTitle and source provenance. Do not transfer evidence to an unrelated cluster. You may connect clusters only when supplied evidence explicitly establishes a character-to-work or related-content-to-work relationship and verifies the full original manga title. conflictingEvidence is a short list of mismatches, not supporting evidence.
When one candidate is a character from another candidate's manga, use the character as supporting CHARACTER_NAME_MATCH evidence and return the verified manga title, not the character name as another manga. Consolidate clues resolving to the same canonical work into one candidate. Do not infer relationships merely from co-occurrence, a shared author, fame or memory. Converging clues can support the work but must not automatically produce HIGH confidence. Missing Korean information must not create extra Japanese candidates; omit unsupported or unrelated alternatives rather than filling three slots.
Do not select an AI chatbot, generic app/service, Pinterest collection or download page as a manga title. A Japanese hashtag is a candidate clue, not proof by itself.
Do not choose a work because it is famous or familiar. Prefer direct OCR/Lens title clues and visual-match evidence attached to this image; do not let a more famous unrelated candidate override them.
The detected title and the canonical Japanese manga title are different concepts.
First classify what the evidence actually refers to. A result may be the original manga, a volume, artbook, fanbook, interview book, anniversary book, novel, anime, article, fanart, SNS post, merchandise, or another related item.
If the evidence refers to related content, identify the original manga that the content is based on only when the supplied evidence supports that relationship.
Do not use your memory to invent a canonical title. Do not remove words such as 周年, 原画集, インタビュー, ファンブック, or volume markers by string trimming. These are content-type signals, not automatic deletion rules.
The canonicalJapaneseTitle must be the original manga title, not the full related-content title. When the evidence cannot establish the original manga, return the detected title with contentType UNKNOWN and low confidence, set canonicalJapaneseTitle to null, and never use an empty string.
SNS usernames, profile names, interface labels, dates and engagement counts are not work titles. Do not infer social-original or fan-art status merely from an SNS post; require creator-serialization or derivative-work evidence, use PUBLISHED_MANGA when publication evidence exists, and otherwise use UNKNOWN or ILLUSTRATION when manga evidence is absent.
Return a canonicalJapaneseTitle only when its complete string is present in evidence attached to the same work. Set titleVerificationStatus to VERIFIED for a supported full title, PARTIAL for a supported fragment, or UNVERIFIED when full-title evidence is absent; canonicalJapaneseTitle must be null for PARTIAL and UNVERIFIED. Never complete a title from memory.
After verifying the original title, provide koreanSearchTranslation as a literal Korean translation of that same full title for later search. It must contain Hangul and no Japanese kana. This is NOT a verified Korean work title or publication evidence. Use null if the canonical title is unknown or cannot be translated. Never change the Japanese identity to fit a translation.
For Japanese personal names, surnames and place names, use an evidence-backed Japanese reading transliterated into Hangul, never Sino-Korean character readings or literal character meanings. If the supplied evidence does not establish a name's reading, set koreanSearchTranslation to null instead of guessing; the server will search the original title.
Return JSON only:
{
  "candidates": [{
    "rank": 1 | 2 | 3,
    "detectedTitle": string,
    "contentType": "MANGA" | "PUBLISHED_MANGA" | "SOCIAL_ORIGINAL_COMIC" | "MANGA_VOLUME" | "ARTBOOK" | "FANBOOK" | "INTERVIEW_BOOK" | "ANNIVERSARY_BOOK" | "NOVEL" | "ANIME" | "ARTICLE" | "FANART" | "FAN_ART" | "ILLUSTRATION" | "SNS_POST" | "MERCHANDISE" | "OTHER" | "UNKNOWN",
    "canonicalJapaneseTitle": string | null,
    "koreanSearchTranslation": string | null,
    "titleVerificationStatus": "VERIFIED" | "PARTIAL" | "UNVERIFIED",
    "relatedMangaCandidates": string[],
    "reason": string,
    "pronunciation": string | null,
    "koreanTitle": null,
    "koreanTitleStatus": "UNKNOWN",
    "publicationStatus": "UNKNOWN",
    "confidence": "HIGH" | "MEDIUM" | "LOW",
    "evidence": ["DIALOGUE_MATCH" | "CHARACTER_NAME_MATCH" | "WORK_TITLE_MATCH" | "AUTHOR_MATCH" | "PUBLISHER_MATCH" | "SERIALIZATION_MATCH" | "VISUAL_CLUE_MATCH" | "SEARCH_CONSISTENCY"],
    "author": string | null,
    "koreanInvestigationStatus": "SKIPPED"
  }]
}
Evidence:
${JSON.stringify(compactCanonicalResolverResearch(research))}
`;

function withoutUrlCredentials(value: string): string {
  try {
    const url = new URL(value);
    url.search = '';
    url.hash = '';
    return url.toString().slice(0, 240);
  } catch {
    return value.slice(0, 240);
  }
}

export function compactCanonicalResolverResearch(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const research = value as Partial<ResearchBundle>;
  const clusters = Array.isArray(research.candidateClusters) ? research.candidateClusters : [];
  const compactClusters = clusters.slice(0, 8).map((cluster) => ({
    clusterId: cluster.clusterId.slice(0, 80),
    candidateTitle: cluster.candidateTitle.slice(0, 120),
    normalizedTitle: cluster.normalizedTitle.slice(0, 120),
    score: cluster.score,
    independentSourceCount: cluster.independentSourceCount,
    mangaSignals: cluster.mangaSignals.slice(0, 4).map((signal) => signal.slice(0, 120)),
    nonMangaSignals: cluster.nonMangaSignals.slice(0, 3).map((signal) => signal.slice(0, 120)),
    conflictingEvidence: cluster.conflictingEvidence.slice(0, 3).map((item) => ({
      title: item.title.slice(0, 120),
      sourceDomain: item.sourceDomain.slice(0, 120),
    })),
    lensEvidence: cluster.lensEvidence.slice(0, 5).map((item) => ({
      candidateTitle: item.candidateTitle.slice(0, 120),
      sourceUrl: withoutUrlCredentials(item.sourceUrl),
      sourceDomain: item.sourceDomain.slice(0, 120),
      lensPosition: item.lensPosition,
      evidenceType: item.evidenceType,
      context: item.context?.slice(0, 240),
    })),
    tavilyEvidence: cluster.tavilyEvidence.slice(0, 4).map((item) => ({
      title: item.title.slice(0, 180),
      url: withoutUrlCredentials(item.url),
      searchQuery: item.searchQuery?.slice(0, 180),
      content: item.content.slice(0, 320),
    })),
  }));
  const compact = {
    rawOcrText: research.rawOcrText?.slice(0, 6_000),
    ocrTitleCandidates: research.ocrTitleCandidates?.slice(0, 6),
    verifiedOcrTitles: research.verifiedOcrTitles?.slice(0, 6),
    ocrTexts: (research.ocrTexts ?? []).slice(0, 10).map((text) => text.slice(0, 300)),
    candidateSeeds: (research.candidateSeeds ?? []).slice(0, 8).map((title) => title.slice(0, 120)),
    candidateClusters: compactClusters,
  };
  if (compactClusters.length > 0) return compact;

  return {
    ...compact,
    lensMatches: (research.lensMatches ?? []).slice(0, 8).map((match) => ({
      title: match.title.slice(0, 160),
      source: match.source.slice(0, 120),
      link: withoutUrlCredentials(match.link),
      position: match.position ?? match.sourceIndex ?? null,
      snippet: match.snippet?.slice(0, 240),
    })),
    tavilyResults: (research.tavilyResults ?? []).slice(0, 8).map((result) => ({
      title: result.title.slice(0, 180),
      url: withoutUrlCredentials(result.url),
      searchQuery: result.searchQuery?.slice(0, 180),
      content: result.content.slice(0, 320),
    })),
  };
}

export const ocrRefinerSystemPrompt = `
너는 OCR Query Refiner다. 작품을 직접 식별하지 말고 OCR 원문에서 웹 검색에 유용한 단서만 구조화한다.
OCR에 없는 작품명을 모델 지식으로 추가하지 않는다. 웹 검색이나 검색 결과 생성을 하지 않는다.
작품 제목처럼 보이는 문자열은 titleCandidates, 실제 대사는 dialogueCandidates로 분리한다.
발매일·주년·광고·상품 설명은 contextKeywords 또는 noise로 분리한다.
긴 실제 제목은 임의로 줄이지 않는다. 불확실한 후보의 confidence는 낮게 준다.
`;

export const ocrRefinerPrompt = (rawText: string): string => `
Return JSON only with this shape:
{
  "titleCandidates": [{ "text": "string", "confidence": 0 }],
  "dialogueCandidates": [{ "text": "string", "confidence": 0 }],
  "contextKeywords": ["string"],
  "noise": ["string"],
  "hasUsefulText": true
}
Use only this OCR text:
${rawText}
`;
