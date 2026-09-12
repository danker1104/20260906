import { identifyResponseSchema } from '../domain/schemas';
import type { IdentifyResponse } from '../domain/types';
import type { IdentifyPipelineResult } from './identify-pipeline';

export class ResponseMappingError extends Error {
  constructor() {
    super('최종 공개 응답 schema 검증에 실패했습니다.');
    this.name = 'ResponseMappingError';
  }
}

export function mapPipelineResponse(
  requestId: string,
  result: IdentifyPipelineResult,
): IdentifyResponse {
  const response = {
    status: result.status,
    requestId,
    stages: result.stages,
    candidates: result.candidates,
  };
  const parsed = identifyResponseSchema.safeParse(response);

  if (!parsed.success) {
    throw new ResponseMappingError();
  }

  return parsed.data;
}
