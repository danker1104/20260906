import type { PreparedImage } from '../domain/types';
import type { OcrQueryRefinement } from './query-refinement';

export type QueryType = 'TITLE' | 'DIALOGUE' | 'NONE';

export interface OcrExtraction {
  text: string;
  valid: boolean;
  rawText?: string;
}

export interface WebSearchResult {
  title: string;
  url: string;
  content: string;
  score: number | null;
}

export interface LensMatch {
  title: string;
  source: string;
  link: string;
  thumbnail?: string;
  sourceIndex?: number;
}

export interface LensDiagnostic {
  stage: 'UPLOAD' | 'SEARCH' | 'PARSE' | 'COMPLETE';
  uploadStatus: number | null;
  imageIdExists: boolean;
  searchStatus: number | null;
  visualMatchCount: number;
  error: string | null;
  searchResult?: 'SEARCH_TIMEOUT' | 'SEARCH_ERROR' | 'EMPTY_RESULTS' | 'SUCCESS';
}

export interface EvidenceCluster {
  candidateTitle: string;
  signals: string[];
  lensEvidence: Array<Pick<LensMatch, 'title' | 'source' | 'link'>>;
  tavilyEvidence: Array<Pick<WebSearchResult, 'title' | 'url'>>;
  independentSourceCount: number;
  lensEvidenceCount: number;
  tavilyEvidenceCount: number;
  mangaSignals: string[];
  nonMangaSignals: string[];
}

export interface ResearchBundle {
  ocrTexts: string[];
  tavilyResults: WebSearchResult[];
  lensMatches: LensMatch[];
  candidateSeeds: string[];
  candidateClusters?: EvidenceCluster[];
  koreanResults?: WebSearchResult[];
  koreanTitleCandidates?: string[];
  koreanOfficialTitleCandidates?: string[];
  koreanCommonTitleCandidates?: string[];
}

export interface ResearchProviders {
  ocr(image: PreparedImage): Promise<OcrExtraction>;
  tavily(query: string): Promise<WebSearchResult[]>;
  lens(image: PreparedImage): Promise<LensMatch[]>;
  refineOcr?(rawText: string): Promise<OcrQueryRefinement>;
  judge(bundle: ResearchBundle): Promise<import('../domain/types').Candidate[]>;
}
