import type { ErrorCode, ErrorResponse } from './types';

export class ImageValidationError extends Error {
  readonly code: ErrorCode = 'INVALID_IMAGE';

  constructor(message: string) {
    super(message);
    this.name = 'ImageValidationError';
  }
}

export function createErrorResponse(
  code: ErrorCode,
  message: string,
  requestId: string,
  retryAfterSeconds?: number,
): ErrorResponse {
  return {
    error: {
      code,
      message,
      requestId,
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    },
  };
}
