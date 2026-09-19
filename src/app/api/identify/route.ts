import { createErrorResponse, ImageValidationError } from '../../../lib/domain/errors';
import { GeminiConfigurationError } from '../../../lib/ai/gemini-gateway';
import { getRequestId } from '../../../lib/observability/request-id';
import { getTotalTimeoutMs, hasDeadlineExpired } from '../../../lib/pipeline/request-deadline';
import { runIdentifyPipeline } from '../../../lib/pipeline/identify-pipeline';
import { mapPipelineResponse, ResponseMappingError } from '../../../lib/pipeline/response-mapper';
import { logIdentifyEvent } from '../../../lib/observability/event-logger';
import {
  releasePreparedImages,
  validateAndPrepareImages,
} from '../../../lib/validation/image-validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_REQUEST_BYTES = 32 * 1024 * 1024;

function isImageFile(value: FormDataEntryValue): value is File {
  return typeof value !== 'string' && typeof value.arrayBuffer === 'function' && typeof value.type === 'string';
}

export async function POST(request: Request): Promise<Response> {
  const requestId = getRequestId(request);
  const startedAt = Date.now();
  let preparedImages: Awaited<ReturnType<typeof validateAndPrepareImages>> = [];
  logIdentifyEvent({ event: 'identify_started', requestId });

  try {
    const contentLength = Number(request.headers.get('content-length') ?? 0);
    if (contentLength > MAX_REQUEST_BYTES) {
      return Response.json(
        createErrorResponse('INVALID_IMAGE', '요청 크기가 허용 범위를 초과했습니다.', requestId),
        { status: 400 },
      );
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return Response.json(
        createErrorResponse('INVALID_IMAGE', 'multipart/form-data 요청이 필요합니다.', requestId),
        { status: 400 },
      );
    }
    const imageValues = formData.getAll('images');
    const imageFiles = imageValues.filter(isImageFile);

    if (imageFiles.length !== imageValues.length || imageFiles.length < 1) {
      return Response.json(
        createErrorResponse('INVALID_IMAGE', 'images 필드에 이미지 파일을 1장 이상 보내 주세요.', requestId),
        { status: 400 },
      );
    }

    if (hasDeadlineExpired(startedAt)) {
      return Response.json(
        createErrorResponse('TIMEOUT', '요청 처리 시간이 초과되었습니다.', requestId),
        { status: 504 },
      );
    }

    preparedImages = await validateAndPrepareImages(imageFiles);
    logIdentifyEvent({ event: 'image_validation_completed', requestId, imageCount: preparedImages.length, latencyMs: Date.now() - startedAt });

    if (hasDeadlineExpired(startedAt, getTotalTimeoutMs())) {
      return Response.json(
        createErrorResponse('TIMEOUT', '요청 처리 시간이 초과되었습니다.', requestId),
        { status: 504 },
      );
    }

    const pipelineResult = await runIdentifyPipeline(preparedImages);
    const response = mapPipelineResponse(requestId, pipelineResult);
    if (pipelineResult.failureStage) {
      logIdentifyEvent({
        event: 'stage_failed',
        requestId,
        stage: pipelineResult.failureStage,
        status: pipelineResult.stages[pipelineResult.failureStage],
        outcome: pipelineResult.failureReason,
      });
    }
    if (pipelineResult.failureReason === 'RATE_LIMITED') {
      return Response.json(
        createErrorResponse('RATE_LIMITED', '현재 AI 요청 한도에 도달했습니다. 잠시 후 다시 시도해주세요.', requestId),
        { status: 429 },
      );
    }
    logIdentifyEvent({ event: 'identify_completed', requestId, outcome: response.status, latencyMs: Date.now() - startedAt });
    return Response.json(response, { status: 200 });
  } catch (error) {
    if (error instanceof ImageValidationError) {
      logIdentifyEvent({ event: 'identify_completed', requestId, outcome: 'INVALID_IMAGE', latencyMs: Date.now() - startedAt });
      return Response.json(createErrorResponse(error.code, error.message, requestId), { status: 400 });
    }

    if (error instanceof GeminiConfigurationError) {
      logIdentifyEvent({ event: 'identify_completed', requestId, outcome: 'UPSTREAM_UNAVAILABLE', latencyMs: Date.now() - startedAt });
      return Response.json(
        createErrorResponse('UPSTREAM_UNAVAILABLE', 'AI 서비스 설정을 사용할 수 없습니다.', requestId),
        { status: 503 },
      );
    }

    if (error instanceof ResponseMappingError) {
      logIdentifyEvent({ event: 'identify_completed', requestId, outcome: 'VALIDATION_FAILED', latencyMs: Date.now() - startedAt });
      return Response.json(
        createErrorResponse('VALIDATION_FAILED', '결과를 검증하지 못했습니다.', requestId),
        { status: 502 },
      );
    }

    logIdentifyEvent({ event: 'identify_completed', requestId, outcome: 'INTERNAL_ERROR', latencyMs: Date.now() - startedAt });
    return Response.json(
      createErrorResponse('INTERNAL_ERROR', '요청을 처리하지 못했습니다.', requestId),
      { status: 500 },
    );
  } finally {
    releasePreparedImages(preparedImages);
  }
}
