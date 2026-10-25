import { getRequestId } from '../../../../lib/observability/request-id';
import { getPublicationMode } from '../../../../lib/publication/provider';
import { lookupYes24ForPublication } from '../../../../lib/search/yes24';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_FIELD_LENGTH = 200;

export async function GET(request: Request): Promise<Response> {
  const requestId = getRequestId(request);
  const { searchParams } = new URL(request.url);
  const title = (searchParams.get('title') ?? '').trim().slice(0, MAX_FIELD_LENGTH);
  const isbn = searchParams.get('isbn')?.trim().slice(0, MAX_FIELD_LENGTH) || null;
  const author = searchParams.get('author')?.trim().slice(0, MAX_FIELD_LENGTH) || null;

  if (!title && !isbn) {
    return Response.json(
      { error: { code: 'INVALID_QUERY', message: 'title 또는 isbn 중 하나가 필요합니다.', requestId } },
      { status: 400 },
    );
  }

  const mode = getPublicationMode();
  const yes24 = await lookupYes24ForPublication({ isbn, title: title || isbn || '', author });
  return Response.json({ mode, ...yes24 }, { status: 200 });
}
