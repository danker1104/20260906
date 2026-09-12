import { z } from 'zod';
import {
  confidenceLevels,
  evidenceCodes,
  identifyStatuses,
  koreanTitleStatuses,
  publicationStatuses,
  stageStatuses,
} from './types';

export const candidateSchema = z.object({
  rank: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  japaneseTitle: z.string().min(1),
  koreanTitle: z.string().min(1).nullable(),
  koreanTitleStatus: z.enum(koreanTitleStatuses),
  publicationStatus: z.enum(publicationStatuses),
  confidence: z.enum(confidenceLevels),
  evidence: z.array(z.enum(evidenceCodes)).min(1).max(5),
  author: z.string().min(1).nullable(),
  koreanInvestigationStatus: z.enum(stageStatuses),
});

export const identifyResponseSchema = z.object({
  status: z.enum(identifyStatuses),
  requestId: z.string().uuid(),
  stages: z.object({
    imageAnalysis: z.enum(stageStatuses),
    japaneseIdentification: z.enum(stageStatuses),
    koreanInvestigation: z.enum(stageStatuses),
    finalJudgment: z.enum(stageStatuses),
  }),
  candidates: z.array(candidateSchema).max(3),
});

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.enum([
      'INVALID_IMAGE',
      'RATE_LIMITED',
      'TIMEOUT',
      'INSUFFICIENT_CLUES',
      'UPSTREAM_UNAVAILABLE',
      'VALIDATION_FAILED',
      'INTERNAL_ERROR',
    ]),
    message: z.string().min(1),
    requestId: z.string().uuid(),
    retryAfterSeconds: z.number().int().positive().optional(),
  }),
});

export type IdentifyResponseInput = z.infer<typeof identifyResponseSchema>;
export type ErrorResponseInput = z.infer<typeof errorResponseSchema>;

export const imageAnalysisResultSchema = z.object({
  japaneseTexts: z.array(z.string()).max(50),
  suspectedTitles: z.array(z.string()).max(20),
  characterNames: z.array(z.string()).max(50),
  authorClues: z.array(z.string()).max(20),
  publisherClues: z.array(z.string()).max(20),
  serializationClues: z.array(z.string()).max(20),
  visualClues: z.array(z.string()).max(50),
  imageStatuses: z.array(z.enum(['SUCCESS', 'INSUFFICIENT', 'FAILED'])).min(1).max(3),
});

export const japaneseCandidateSchema = z.object({
  rank: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  japaneseTitle: z.string().min(1),
  author: z.string().min(1).nullable(),
  confidence: z.enum(confidenceLevels),
  evidence: z.array(z.enum(evidenceCodes)).min(1).max(5),
  searchSupport: z.array(z.string()).max(10),
});

export const japaneseSearchResultSchema = z.object({
  candidates: z.array(japaneseCandidateSchema).max(3),
});

export const koreanInvestigationResultSchema = z.object({
  candidateResults: z.array(z.object({
    rank: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    koreanTitle: z.string().min(1).nullable(),
    koreanTitleStatus: z.enum(koreanTitleStatuses),
    publicationStatus: z.enum(publicationStatuses),
    investigationStatus: z.enum(stageStatuses),
    searchSupport: z.array(z.string()).max(10),
  })).max(3),
});

export type ImageAnalysisResultInput = z.infer<typeof imageAnalysisResultSchema>;
export type JapaneseSearchResultInput = z.infer<typeof japaneseSearchResultSchema>;
export type KoreanInvestigationResultInput = z.infer<typeof koreanInvestigationResultSchema>;
