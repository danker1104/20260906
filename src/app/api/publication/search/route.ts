import { getRequestId } from '../../../../lib/observability/request-id';
import { getNationalLibraryProvider } from '../../../../lib/publication/provider-factory';
import {
  NationalLibraryApiError,
  NationalLibraryConfigError,
  NationalLibraryUpstreamError,
} from '../../../../lib/publication/provider';
import { detectQueryType, groupVolumesIntoWorks, toPublicationVolume } from '../../../../lib/publication/normalize';
import {
  diagnoseUngroupedPublicationRecord,
  normalizePublicationTitle,
  rankAndClassifyPublicationWorks,
} from '../../../../lib/publication/ranking';
import { sortVolumes } from '../../../../lib/publication/sort-filter';
import { publicationSearchResponseSchema } from '../../../../lib/domain/publication-schemas';
import type { PublicationErrorCode, PublicationErrorResponse } from '../../../../lib/domain/publication-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_QUERY_LENGTH = 200;
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 10;
const REQUEST_TIMEOUT_MS = 10_000;

function errorResponse(code: PublicationErrorCode, message: string, requestId: string): PublicationErrorResponse {
  return { error: { code, message, requestId } };
}

export async function GET(request: Request): Promise<Response> {
  const requestId = getRequestId(request);
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get('q') ?? '').trim();
  const page = Math.max(1, Number.parseInt(searchParams.get('page') ?? '1', 10) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.parseInt(searchParams.get('pageSize') ?? String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE));

  if (!query || query.length > MAX_QUERY_LENGTH) {
    return Response.json(
      errorResponse('INVALID_QUERY', '검색어를 1자 이상 200자 이하로 입력해 주세요.', requestId),
      { status: 400 },
    );
  }

  const queryType = detectQueryType(query);
  try {
    const provider = getNationalLibraryProvider();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let result;
    try {
      result = await provider.search({ query, queryType, page, pageSize }, controller.signal);
    } finally {
      clearTimeout(timer);
    }

    const volumes = result.records.map((record) => toPublicationVolume(record, provider.mode === 'mock'));
    const { works: groupedWorks, ungroupedVolumes } = groupVolumesIntoWorks(volumes, result.records);
    const rankedWorks = rankAndClassifyPublicationWorks(query, queryType, groupedWorks, result.records);
    for (const work of rankedWorks) work.volumes = sortVolumes(work.volumes, 'VOLUME_ASC');
    if (process.env.NODE_ENV !== 'production') {
      console.info('[PUBLICATION RANKING]', {
        query,
        results: rankedWorks.map((work) => ({
          title: work.volumes.map((volume) => result.records.find((record) => record.id === volume.recordId)?.title ?? volume.title),
          normalizedTitle: normalizePublicationTitle(work.title),
          titleRelevanceScore: work.titleRelevanceScore,
          mangaEvidenceScore: work.mangaEvidenceScore,
          mangaClassification: work.mangaClassification,
          classificationReasons: work.classificationReasons,
          resultGroup: work.resultGroup,
          additionalReason: work.additionalReason,
        })),
        ungroupedResults: ungroupedVolumes.map((volume) => {
          const record = result.records.find((item) => item.id === volume.recordId);
          const diagnostic = record ? diagnoseUngroupedPublicationRecord(query, queryType, record) : null;
          return {
            title: record?.title ?? volume.title,
            normalizedTitle: diagnostic?.normalizedTitle ?? normalizePublicationTitle(volume.title),
            titleRelevanceScore: diagnostic?.titleRelevanceScore ?? 0,
            mangaEvidenceScore: diagnostic?.mangaEvidenceScore ?? 0,
            mangaClassification: diagnostic?.mangaClassification ?? 'UNCERTAIN',
            classificationReasons: diagnostic?.classificationReasons ?? ['NO_CLASSIFYING_EVIDENCE'],
            resultGroup: 'ADDITIONAL',
            additionalReason: 'WORK_GROUP_UNCERTAIN',
          };
        }),
      });
    }
    const works = rankedWorks.map(({
      titleRelevanceScore: _titleScore,
      mangaEvidenceScore: _mangaScore,
      classificationReasons: _reasons,
      resultGroup: _resultGroup,
      additionalReason: _additionalReason,
      ...work
    }) => work);

    const response = publicationSearchResponseSchema.parse({
      query,
      queryType,
      mode: provider.mode,
      page: result.pageNo,
      pageSize,
      hasMore: result.hasMore,
      totalCount: result.totalCount,
      works,
      ungroupedVolumes,
    });
    return Response.json(response, { status: 200 });
  } catch (error) {
    if (error instanceof NationalLibraryConfigError) {
      return Response.json(errorResponse('CONFIG_ERROR', '국립중앙도서관 API 인증키가 설정되지 않았습니다.', requestId), { status: 503 });
    }
    if (error instanceof NationalLibraryApiError) {
      if (error.code === '010' || error.code === '011') {
        return Response.json(errorResponse('CONFIG_ERROR', '국립중앙도서관 API 인증 설정을 확인해 주세요.', requestId), { status: 503 });
      }
      if (error.code === '012' || error.code === '013') {
        return Response.json(errorResponse('API_REJECTED', '국립중앙도서관 API가 검색 요청을 거부했습니다.', requestId), { status: 502 });
      }
      return Response.json(errorResponse('UPSTREAM_UNAVAILABLE', '국립중앙도서관 서비스에 일시적인 오류가 발생했습니다.', requestId), { status: 502 });
    }
    if (error instanceof NationalLibraryUpstreamError) {
      if (error.code === 'TIMEOUT') {
        return Response.json(errorResponse('TIMEOUT', '검색 요청 시간이 초과되었습니다.', requestId), { status: 504 });
      }
      return Response.json(errorResponse('UPSTREAM_UNAVAILABLE', '국립중앙도서관 검색을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.', requestId), { status: 502 });
    }
    if (error instanceof Error && error.name === 'AbortError') {
      return Response.json(errorResponse('TIMEOUT', '검색 요청 시간이 초과되었습니다.', requestId), { status: 504 });
    }
    return Response.json(errorResponse('INTERNAL_ERROR', '검색 요청을 처리하지 못했습니다.', requestId), { status: 500 });
  }
}
