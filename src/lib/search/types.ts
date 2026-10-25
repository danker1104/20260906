import type { Candidate, PreparedImage } from '../domain/types';
import type { OcrQueryRefinement } from './query-refinement';

export type QueryType = 'TITLE' | 'DIALOGUE' | 'NONE';

export interface OcrLine {
  text: string;
  top?: number;
  left?: number;
  width?: number;
  height?: number;
}

export interface OcrExtraction {
  text: string;
  valid: boolean;
  rawText?: string;
  lines?: OcrLine[];
  ocrConfidence?: number;
  socialCropBounds?: { top: number; bottom: number };
}

export interface WebSearchResult {
  title: string;
  url: string;
  content: string;
  score: number | null;
  searchQuery?: string;
  searchCandidateTitle?: string;
  searchCandidateSource?: 'OCR' | 'LENS';
}

export interface LensMatch {
  title: string;
  source: string;
  link: string;
  thumbnail?: string;
  sourceIndex?: number;
  position?: number;
  snippet?: string;
  matchScore?: number;
}

export type LensEvidenceType = 'HASHTAG' | 'QUOTED_TITLE' | 'TITLE' | 'SNIPPET' | 'URL';

export interface LensCandidateEvidence {
  rawTitle: string;
  candidateTitle: string;
  normalizedTitle: string;
  sourceUrl: string;
  sourceDomain: string;
  lensPosition: number;
  evidenceType: LensEvidenceType;
  context?: string;
}

export interface RankedLensCandidate {
  clusterId: string;
  rawTitle: string;
  candidateTitle: string;
  extractedJapaneseTitle: string;
  normalizedTitle: string;
  source: string;
  url: string;
  position: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  score: number;
  independentSourceCount: number;
  evidence: LensCandidateEvidence[];
}

export interface LensDiagnostic {
  stage: 'UPLOAD' | 'SEARCH' | 'PARSE' | 'COMPLETE';
  uploadStatus: number | null;
  imageIdExists: boolean;
  searchStatus: number | null;
  visualMatchCount: number;
  error: string | null;
  searchResult?: 'SEARCH_TIMEOUT' | 'SEARCH_ERROR' | 'EMPTY_RESULTS' | 'SUCCESS';
  failureCode?: 'LENS_UPLOAD_FAILED' | 'LENS_SEARCH_TIMEOUT' | 'LENS_SEARCH_FAILED' | 'LENS_EMPTY_RESULTS' | 'LENS_CANDIDATE_EXTRACTION_FAILED';
}

export type IdentifyDiagnosticCode =
  | 'LENS_UPLOAD_FAILED'
  | 'LENS_SEARCH_TIMEOUT'
  | 'LENS_SEARCH_FAILED'
  | 'LENS_EMPTY_RESULTS'
  | 'LENS_CANDIDATE_EXTRACTION_FAILED'
  | 'TAVILY_NO_RELEVANT_RESULTS'
  | 'TAVILY_SEARCH_FAILED'
  | 'FOUNDRY_RATE_LIMITED'
  | 'FOUNDRY_INVALID_RESPONSE'
  | 'FOUNDRY_UNAVAILABLE'
  | 'INSUFFICIENT_EVIDENCE';

export interface EvidenceCluster {
  clusterId: string;
  candidateTitle: string;
  normalizedTitle: string;
  score: number;
  signals: string[];
  lensEvidence: Array<LensCandidateEvidence & Pick<LensMatch, 'title' | 'source'>>;
  tavilyEvidence: Array<Pick<WebSearchResult, 'title' | 'url' | 'content' | 'searchQuery'>>;
  independentSourceCount: number;
  lensEvidenceCount: number;
  tavilyEvidenceCount: number;
  mangaSignals: string[];
  nonMangaSignals: string[];
  conflictingEvidence: Array<{ title: string; sourceDomain: string }>;
}

export interface TavilyConflict {
  candidateTitle: string;
  title: string;
  sourceDomain: string;
}

export interface ResearchBundle {
  ocrTexts: string[];
  rawOcrText?: string;
  ocrTitleCandidates?: string[];
  verifiedOcrTitles?: string[];
  tavilyResults: WebSearchResult[];
  lensMatches: LensMatch[];
  candidateSeeds: string[];
  candidateClusters?: EvidenceCluster[];
  koreanResults?: WebSearchResult[];
  koreanSearchTranslation?: string | null;
  koreanVerifiedAliases?: string[];
  koreanTitleCandidates?: string[];
  koreanOfficialTitleCandidates?: string[];
  koreanCommonTitleCandidates?: string[];
}

export interface ResearchProviders {
  ocr(image: PreparedImage): Promise<OcrExtraction>;
  tavily(query: string): Promise<WebSearchResult[]>;
  lens(image: PreparedImage): Promise<LensMatch[]>;
  refineOcr?(rawText: string): Promise<OcrQueryRefinement>;
  judge(bundle: ResearchBundle): Promise<ResearchCandidate[]>;
}

export interface ResearchCandidate extends Candidate {
  koreanSearchTranslation?: string | null;
}
