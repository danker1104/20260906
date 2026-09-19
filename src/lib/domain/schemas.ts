import { z } from 'zod';
import {
  confidenceLevels,
  evidenceCodes,
  identifyStatuses,
  koreanTitleStatuses,
  publicationStatuses,
  stageStatuses,
  verificationStatuses,
} from './types';

export const candidateSchema = z.object({
  rank: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  japaneseTitle: z.string().min(1),
  pronunciation: z.string().min(1).nullable().optional(),
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
    finalJudgment: z.enum(stageStatuses),
  }),
  candidates: z.array(candidateSchema).max(3),
  verificationStatus: z.enum(verificationStatuses).optional(),
  analysis: z.object({
    ocr: z.array(z.string()),
    dialogues: z.array(z.string()),
    characterNames: z.array(z.string()),
    possibleTitles: z.array(z.string()),
    authorNames: z.array(z.string()),
    publishers: z.array(z.string()),
    otherClues: z.array(z.string()),
    searchQueries: z.object({ japanese: z.array(z.string()), korean: z.array(z.string()) }),
  }).optional(),
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
  ocr: z.array(z.string()).max(50),
  dialogues: z.array(z.string()).max(50),
  characterNames: z.array(z.string()).max(50),
  possibleTitles: z.array(z.string()).max(20),
  authorNames: z.array(z.string()).max(20),
  publishers: z.array(z.string()).max(20),
  otherClues: z.array(z.string()).max(50),
  imageStatuses: z.array(z.enum(['SUCCESS', 'INSUFFICIENT', 'FAILED'])).min(1).max(3),
  searchQueries: z.object({
    japanese: z.array(z.string().min(1)).max(10),
    korean: z.array(z.string().min(1)).max(10),
  }),
});

export type ImageAnalysisResultInput = z.infer<typeof imageAnalysisResultSchema>;
