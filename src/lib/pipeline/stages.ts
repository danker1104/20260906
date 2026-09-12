import { z } from 'zod';
import {
  imageAnalysisResultSchema,
  japaneseSearchResultSchema,
  koreanInvestigationResultSchema,
  candidateSchema,
  type ImageAnalysisResultInput,
  type JapaneseSearchResultInput,
  type KoreanInvestigationResultInput,
} from '../domain/schemas';
import type { PreparedImage, Candidate, StageStatus } from '../domain/types';
import { getConfiguredModel, type GeminiGateway } from '../ai/gemini-gateway';
import {
  finalJudgmentPrompt,
  imageAnalysisPrompt,
  japaneseSearchPrompt,
  koreanInvestigationPrompt,
} from '../ai/prompts';
import { generateJson, getStageTimeoutMs, StageExecutionError, withStageTimeout, type StageOutcome } from './stage-utils';

function jsonConfig(tools?: unknown[]): Record<string, unknown> {
  return {
    responseMimeType: 'application/json',
    ...(tools ? { tools } : {}),
  };
}

function imageContents(images: PreparedImage[]): Array<Record<string, unknown>> {
  return [
    { text: imageAnalysisPrompt },
    ...images.map((image) => ({
      inlineData: {
        mimeType: image.mimeType,
        data: image.buffer.toString('base64'),
      },
    })),
  ];
}

function hasImageClues(result: ImageAnalysisResultInput): boolean {
  return [
    result.japaneseTexts,
    result.suspectedTitles,
    result.characterNames,
    result.authorClues,
    result.publisherClues,
    result.serializationClues,
    result.visualClues,
  ].some((clues) => clues.length > 0);
}

export async function analyzeImages(
  gateway: GeminiGateway,
  images: PreparedImage[],
): Promise<StageOutcome<ImageAnalysisResultInput>> {
  try {
    const result = await withStageTimeout(
      generateJson(gateway, {
        model: getConfiguredModel('pro'),
        contents: imageContents(images),
        config: jsonConfig(),
      }, imageAnalysisResultSchema),
      getStageTimeoutMs(),
    );

    if (result.imageStatuses.every((status) => status === 'FAILED')) {
      return { status: 'FAILED' };
    }

    if (!hasImageClues(result)) {
      return { status: 'INSUFFICIENT', data: result };
    }

    return { status: 'SUCCESS', data: result };
  } catch (error) {
    if (error instanceof StageExecutionError && error.message.includes('시간이 초과')) {
      return { status: 'TIMEOUT' };
    }
    return { status: 'FAILED' };
  }
}

export async function searchJapaneseCandidates(
  gateway: GeminiGateway,
  imageAnalysis: ImageAnalysisResultInput,
): Promise<StageOutcome<JapaneseSearchResultInput>> {
  try {
    const result = await withStageTimeout(
      generateJson(gateway, {
        model: getConfiguredModel('flash'),
        contents: japaneseSearchPrompt(imageAnalysis),
        config: jsonConfig([{ googleSearch: {} }]),
      }, japaneseSearchResultSchema),
      getStageTimeoutMs(),
    );

    const candidates = result.candidates
      .filter((candidate) => candidate.evidence.length > 0)
      .slice(0, 3)
      .map((candidate, index) => ({ ...candidate, rank: (index + 1) as 1 | 2 | 3 }));

    if (candidates.length === 0) {
      return { status: 'INSUFFICIENT', data: { candidates: [] } };
    }

    return { status: 'SUCCESS', data: { candidates } };
  } catch (error) {
    if (error instanceof StageExecutionError && error.message.includes('시간이 초과')) {
      return { status: 'TIMEOUT' };
    }
    return { status: 'FAILED' };
  }
}

function koreanStatus(results: KoreanInvestigationResultInput, candidateCount: number): StageStatus {
  const statuses = Array.from({ length: candidateCount }, (_, index) => {
    const rank = index + 1;
    return results.candidateResults.find((result) => result.rank === rank)?.investigationStatus ?? 'INSUFFICIENT';
  });

  if (statuses.every((status) => status === 'SUCCESS')) {
    return 'SUCCESS';
  }
  if (statuses.some((status) => status === 'SUCCESS')) {
    return 'PARTIAL';
  }
  if (statuses.some((status) => status === 'FAILED')) {
    return 'FAILED';
  }
  if (statuses.some((status) => status === 'TIMEOUT')) {
    return 'TIMEOUT';
  }
  return 'INSUFFICIENT';
}

function mergeFinalCandidates(
  finalCandidates: Candidate[],
  japaneseCandidates: JapaneseSearchResultInput,
  koreanInvestigation: KoreanInvestigationResultInput | undefined,
  koreanStageStatus: StageStatus,
): Candidate[] {
  return japaneseCandidates.candidates.map((japaneseCandidate) => {
    const finalCandidate = finalCandidates.find((candidate) => candidate.rank === japaneseCandidate.rank);
    if (!finalCandidate) {
      throw new StageExecutionError('최종 판정 결과에 일본 후보 rank가 누락되었습니다.');
    }

    const koreanResult = koreanInvestigation?.candidateResults.find(
      (result) => result.rank === japaneseCandidate.rank,
    );
    const candidateKoreanStatus = koreanResult?.investigationStatus ?? koreanStageStatus;
    const hasUsableKoreanResult = candidateKoreanStatus === 'SUCCESS' && koreanResult;

    return {
      ...finalCandidate,
      rank: japaneseCandidate.rank,
      japaneseTitle: japaneseCandidate.japaneseTitle,
      author: japaneseCandidate.author,
      koreanTitle: hasUsableKoreanResult ? koreanResult.koreanTitle : null,
      koreanTitleStatus: hasUsableKoreanResult ? koreanResult.koreanTitleStatus : 'UNKNOWN',
      publicationStatus: hasUsableKoreanResult ? koreanResult.publicationStatus : 'UNKNOWN',
      koreanInvestigationStatus: candidateKoreanStatus,
    };
  });
}

export async function investigateKoreanInformation(
  gateway: GeminiGateway,
  japaneseCandidates: JapaneseSearchResultInput,
): Promise<StageOutcome<KoreanInvestigationResultInput>> {
  try {
    const result = await withStageTimeout(
      generateJson(gateway, {
        model: getConfiguredModel('flash'),
        contents: koreanInvestigationPrompt(japaneseCandidates.candidates),
        config: jsonConfig([{ googleSearch: {} }]),
      }, koreanInvestigationResultSchema),
      getStageTimeoutMs(),
    );

    return {
      status: koreanStatus(result, japaneseCandidates.candidates.length),
      data: result,
    };
  } catch (error) {
    if (error instanceof StageExecutionError && error.message.includes('시간이 초과')) {
      return { status: 'TIMEOUT' };
    }
    return { status: 'FAILED' };
  }
}

const finalJudgmentSchema = z.object({ candidates: z.array(candidateSchema).max(3) });

export async function judgeCandidates(
  gateway: GeminiGateway,
  imageAnalysis: ImageAnalysisResultInput,
  japaneseCandidates: JapaneseSearchResultInput,
  koreanInvestigation: KoreanInvestigationResultInput | undefined,
): Promise<StageOutcome<Candidate[]>> {
  try {
    const result = await withStageTimeout(
      generateJson(gateway, {
        model: getConfiguredModel('pro'),
        contents: finalJudgmentPrompt(imageAnalysis, japaneseCandidates.candidates, koreanInvestigation ?? { candidateResults: [] }),
        config: jsonConfig(),
      }, finalJudgmentSchema),
      getStageTimeoutMs(),
    );

    if (result.candidates.length === 0) {
      return { status: 'FAILED' };
    }

    return {
      status: 'SUCCESS',
      data: mergeFinalCandidates(result.candidates, japaneseCandidates, koreanInvestigation, koreanInvestigation ? koreanStatus(koreanInvestigation, japaneseCandidates.candidates.length) : 'FAILED'),
    };
  } catch (error) {
    if (error instanceof StageExecutionError && error.message.includes('시간이 초과')) {
      return { status: 'TIMEOUT' };
    }
    return { status: 'FAILED' };
  }
}
