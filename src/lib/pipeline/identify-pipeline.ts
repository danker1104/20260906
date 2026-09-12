import type { Candidate, IdentifyStatus, PreparedImage, StageStatus } from '../domain/types';
import type { GeminiGateway } from '../ai/gemini-gateway';
import { createGeminiGateway } from '../ai/gemini-gateway';
import { getTotalTimeoutMs } from './request-deadline';
import { analyzeImages, investigateKoreanInformation, judgeCandidates, searchJapaneseCandidates } from './stages';
import type { ImageAnalysisResultInput, JapaneseSearchResultInput, KoreanInvestigationResultInput } from '../domain/schemas';

export interface PipelineStages {
  imageAnalysis: StageStatus;
  japaneseIdentification: StageStatus;
  koreanInvestigation: StageStatus;
  finalJudgment: StageStatus;
}

export interface IdentifyPipelineResult {
  stages: PipelineStages;
  candidates: Candidate[];
  status: IdentifyStatus;
}

function skippedStages(imageAnalysis: StageStatus, japaneseIdentification: StageStatus): PipelineStages {
  return {
    imageAnalysis,
    japaneseIdentification,
    koreanInvestigation: 'SKIPPED',
    finalJudgment: 'SKIPPED',
  };
}

function isDeadlineExceeded(startedAt: number): boolean {
  return Date.now() - startedAt >= getTotalTimeoutMs();
}

export async function runIdentifyPipeline(
  images: PreparedImage[],
  gateway: GeminiGateway = createGeminiGateway(),
): Promise<IdentifyPipelineResult> {
  const startedAt = Date.now();
  const imageAnalysis = await analyzeImages(gateway, images);

  if (imageAnalysis.status !== 'SUCCESS' || !imageAnalysis.data || isDeadlineExceeded(startedAt)) {
    return {
      status: imageAnalysis.status === 'INSUFFICIENT' ? 'INSUFFICIENT' : 'FAILED',
      stages: skippedStages(imageAnalysis.status === 'SUCCESS' ? 'TIMEOUT' : imageAnalysis.status, 'SKIPPED'),
      candidates: [],
    };
  }

  const japaneseIdentification = await searchJapaneseCandidates(gateway, imageAnalysis.data);
  if (japaneseIdentification.status !== 'SUCCESS' || !japaneseIdentification.data || isDeadlineExceeded(startedAt)) {
    return {
      status: japaneseIdentification.status === 'INSUFFICIENT' ? 'INSUFFICIENT' : 'FAILED',
      stages: {
        imageAnalysis: imageAnalysis.status,
        japaneseIdentification: japaneseIdentification.status === 'SUCCESS' ? 'TIMEOUT' : japaneseIdentification.status,
        koreanInvestigation: 'SKIPPED',
        finalJudgment: 'SKIPPED',
      },
      candidates: [],
    };
  }

  const koreanInvestigation = await investigateKoreanInformation(gateway, japaneseIdentification.data);
  const finalJudgment = await judgeCandidates(
    gateway,
    imageAnalysis.data,
    japaneseIdentification.data,
    koreanInvestigation.data,
  );

  if (finalJudgment.status !== 'SUCCESS' || !finalJudgment.data || isDeadlineExceeded(startedAt)) {
    return {
      status: 'FAILED',
      stages: {
        imageAnalysis: imageAnalysis.status,
        japaneseIdentification: japaneseIdentification.status,
        koreanInvestigation: koreanInvestigation.status,
        finalJudgment: finalJudgment.status === 'SUCCESS' ? 'TIMEOUT' : finalJudgment.status,
      },
      candidates: [],
    };
  }

  return {
    status: koreanInvestigation.status === 'SUCCESS' ? 'SUCCESS' : 'PARTIAL_SUCCESS',
    stages: {
      imageAnalysis: imageAnalysis.status,
      japaneseIdentification: japaneseIdentification.status,
      koreanInvestigation: koreanInvestigation.status,
      finalJudgment: finalJudgment.status,
    },
    candidates: finalJudgment.data,
  };
}
