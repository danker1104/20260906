import { z } from 'zod';

const requestIdSchema = z.uuid();

export function getRequestId(request: Request): string {
  const forwardedRequestId = request.headers.get('x-request-id');

  if (forwardedRequestId && requestIdSchema.safeParse(forwardedRequestId).success) {
    return forwardedRequestId;
  }

  return crypto.randomUUID();
}
