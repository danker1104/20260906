export const identifyStatuses = ['SUCCESS', 'PARTIAL_SUCCESS', 'INSUFFICIENT', 'FAILED'] as const;
export type IdentifyStatus = (typeof identifyStatuses)[number];

export const stageStatuses = [
  'SUCCESS',
  'PARTIAL',
  'INSUFFICIENT',
  'FAILED',
  'TIMEOUT',
  'SKIPPED',
] as const;
export type StageStatus = (typeof stageStatuses)[number];

export const confidenceLevels = ['HIGH', 'MEDIUM', 'LOW'] as const;
export type Confidence = (typeof confidenceLevels)[number];

export const koreanTitleStatuses = ['OFFICIAL', 'COMMON', 'TRANSLATED', 'UNKNOWN'] as const;
export type KoreanTitleStatus = (typeof koreanTitleStatuses)[number];

export const contentTypes = [
  'MANGA',
  'MANGA_VOLUME',
  'ARTBOOK',
  'FANBOOK',
  'INTERVIEW_BOOK',
  'ANNIVERSARY_BOOK',
  'NOVEL',
  'ANIME',
  'ARTICLE',
  'FANART',
  'SNS_POST',
  'MERCHANDISE',
  'OTHER',
  'UNKNOWN',
] as const;
export type ContentType = (typeof contentTypes)[number];

export const publicationStatuses = ['CONFIRMED', 'NOT_FOUND', 'UNKNOWN'] as const;
export type PublicationStatus = (typeof publicationStatuses)[number];

export const verificationStatuses = [
  'VERIFIED',
  'SEARCH_VERIFIED',
  'AI_UNAVAILABLE',
  'RATE_LIMITED',
  'INSUFFICIENT_EVIDENCE',
] as const;
export type VerificationStatus = (typeof verificationStatuses)[number];

export const evidenceCodes = [
  'DIALOGUE_MATCH',
  'CHARACTER_NAME_MATCH',
  'WORK_TITLE_MATCH',
  'AUTHOR_MATCH',
  'PUBLISHER_MATCH',
  'SERIALIZATION_MATCH',
  'VISUAL_CLUE_MATCH',
  'SEARCH_CONSISTENCY',
] as const;
export type EvidenceCode = (typeof evidenceCodes)[number];

export interface Candidate {
  rank: 1 | 2 | 3;
  japaneseTitle: string;
  pronunciation?: string | null;
  koreanTitle: string | null;
  koreanTitleStatus: KoreanTitleStatus;
  publicationStatus: PublicationStatus;
  confidence: Confidence;
  evidence: EvidenceCode[];
  author: string | null;
  koreanInvestigationStatus: StageStatus;
  yes24?: Yes24Enrichment;
}

export interface Yes24Enrichment {
  matched: boolean;
  itemId?: string;
  title?: string;
  coverUrl?: string;
  productUrl?: string;
  publisher?: string;
}

export interface IdentifyResponse {
  status: IdentifyStatus;
  requestId: string;
  stages: {
    imageAnalysis: StageStatus;
    finalJudgment: StageStatus;
  };
  candidates: Candidate[];
  verificationStatus?: VerificationStatus;
  analysis?: ImageAnalysis;
}

export interface ImageAnalysis {
  ocr: string[];
  dialogues: string[];
  characterNames: string[];
  possibleTitles: string[];
  authorNames: string[];
  publishers: string[];
  otherClues: string[];
  searchQueries: {
    japanese: string[];
    korean: string[];
  };
}

export type ErrorCode =
  | 'INVALID_IMAGE'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'INSUFFICIENT_CLUES'
  | 'UPSTREAM_UNAVAILABLE'
  | 'VALIDATION_FAILED'
  | 'INTERNAL_ERROR';

export interface ErrorResponse {
  error: {
    code: ErrorCode;
    message: string;
    requestId: string;
    retryAfterSeconds?: number;
  };
}

export type SupportedImageMimeType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface PreparedImage {
  buffer: Buffer;
  mimeType: SupportedImageMimeType;
  width: number;
  height: number;
  originalSize?: number;
  imageIndex?: number;
}

export interface SearchGroundingResult {
  query: string;
  summary: string;
  evidence: string[];
}
