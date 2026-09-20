import type { PreparedImage } from '../domain/types';

export interface OcrExtraction {
  text: string;
  valid: boolean;
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
}

export interface ResearchBundle {
  ocrTexts: string[];
  tavilyResults: WebSearchResult[];
  lensMatches: LensMatch[];
  candidateSeeds: string[];
  koreanResults?: WebSearchResult[];
  koreanTitleCandidates?: string[];
}

export interface ResearchProviders {
  ocr(image: PreparedImage): Promise<OcrExtraction>;
  tavily(query: string): Promise<WebSearchResult[]>;
  lens(image: PreparedImage): Promise<LensMatch[]>;
  judge(bundle: ResearchBundle): Promise<import('../domain/types').Candidate[]>;
}
