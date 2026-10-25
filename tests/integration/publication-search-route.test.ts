import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../../src/app/api/publication/search/route';

function requestFor(params: Record<string, string>): Request {
  const url = new URL('http://localhost/api/publication/search');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return new Request(url);
}

describe('GET /api/publication/search (mock mode)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects an empty query', async () => {
    const response = await GET(requestFor({ q: '' }));
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error.code).toBe('INVALID_QUERY');
  });

  it('defaults to mock mode, prioritizes Work A as manga, and keeps the matching novel in results', async () => {
    const response = await GET(requestFor({ q: '테스트 작품 A' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.mode).toBe('mock');
    expect(body.queryType).toBe('TITLE');
    expect(body.works).toHaveLength(2);
    expect(body.works[0].mangaClassification).toBe('MANGA_LIKELY');
    expect(body.works[0].relevanceBand).toBe('HIGH');
    expect(body.works[0].volumes).toHaveLength(5);
    expect(body.works[0].volumes.map((v: { volumeNumber: number }) => v.volumeNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(body.works[0].volumes.every((v: { isMock: boolean }) => v.isMock)).toBe(true);
    expect(body.works[1].mangaClassification).toBe('NON_MANGA_LIKELY');
    expect(body.totalCount).toBe(6);
  });

  it('classifies the upcoming and deposited volumes correctly within Work A', async () => {
    const response = await GET(requestFor({ q: '테스트 작품 A' }));
    const body = await response.json();
    const statuses = body.works[0].volumes.map((v: { status: string }) => v.status);
    expect(statuses).toEqual(['DEPOSITED', 'DEPOSITED', 'REGISTERED', 'DATE_PASSED', 'UPCOMING']);
  });

  it('searches by a valid ISBN and returns the exact matching record', async () => {
    const response = await GET(requestFor({ q: '979-11-00000-01-4' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.queryType).toBe('ISBN');
    expect(body.works).toHaveLength(1);
    expect(body.works[0].volumes).toHaveLength(1);
    expect(body.works[0].volumes[0].isbn).toBe('979-11-00000-01-4');
  });

  it('paginates with a small page size and exposes hasMore', async () => {
    const first = await GET(requestFor({ q: '테스트 작품 A', page: '1', pageSize: '2' }));
    const firstBody = await first.json();
    expect(firstBody.hasMore).toBe(true);
    expect(firstBody.totalCount).toBe(6);

    const second = await GET(requestFor({ q: '테스트 작품 A', page: '3', pageSize: '2' }));
    const secondBody = await second.json();
    expect(secondBody.hasMore).toBe(false);
  });

  it('returns an empty result set for the "no results" mock token without erroring', async () => {
    const response = await GET(requestFor({ q: '검색결과없음테스트' }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.works).toHaveLength(0);
    expect(body.ungroupedVolumes).toHaveLength(0);
    expect(body.totalCount).toBe(0);
  });

  it('surfaces a simulated upstream failure as UPSTREAM_UNAVAILABLE', async () => {
    const response = await GET(requestFor({ q: '오류테스트' }));
    const body = await response.json();
    expect(response.status).toBe(502);
    expect(body.error.code).toBe('UPSTREAM_UNAVAILABLE');
  });

  it('keeps Work C separate from Work A despite the similar title', async () => {
    const response = await GET(requestFor({ q: '테스트 작품' }));
    const body = await response.json();
    const workTitles: string[] = body.works.map((w: { title: string }) => w.title);
    expect(workTitles.some((title) => title.includes('A'))).toBe(true);
    expect(workTitles.some((title) => title.includes('에이'))).toBe(true);
    expect(body.works.length).toBeGreaterThanOrEqual(2);
  });

  it('handles the no-ISBN edge case without crashing, reporting status UNKNOWN', async () => {
    const response = await GET(requestFor({ q: '엣지 ISBN 없음' }));
    const body = await response.json();
    expect(body.works).toHaveLength(1);
    expect(body.works[0].volumes[0].isbn).toBeNull();
    expect(body.works[0].volumes[0].status).toBe('UNKNOWN');
  });
});

describe('GET /api/publication/search (live mode without a key)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns CONFIG_ERROR instead of fabricating results', async () => {
    vi.stubEnv('NL_API_MODE', 'live');
    vi.stubEnv('NL_API_KEY', '');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const response = await GET(requestFor({ q: '테스트 작품 A' }));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error.code).toBe('CONFIG_ERROR');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('GET /api/publication/search (mocked Live Provider response)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('maps nested documented records and returned PAGE_NO through the existing volume logic', async () => {
    vi.stubEnv('NL_API_MODE', 'live');
    vi.stubEnv('NL_API_KEY', 'test-key-never-real');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: {
        PAGE_NO: '2',
        TOTAL_COUNT: '11',
        docs: [{
          TITLE: '가상 만화',
          VOL: '2',
          SERIES_TITLE: '가상 만화',
          AUTHOR: '가상 작가',
          EA_ISBN: '0012345678901',
          PUBLISHER: '가상 출판사',
          EDITION_STMT: '특별판',
          FORM: '종이책',
          PUBLISH_PREDATE: '20261231',
          EBOOK_YN: 'N',
          TITLE_URL: null,
          INPUT_DATE: '20260101',
          UPDATE_DATE: '20260201',
          DEPOSIT_YN: 'Y',
          RELATED_ISBN: '9781111111111',
        }],
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const response = await GET(requestFor({ q: '가상 만화', page: '2' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.mode).toBe('live');
    expect(body.page).toBe(2);
    expect(body.totalCount).toBe(11);
    expect(body.hasMore).toBe(false);
    expect(body.works[0].volumes[0]).toMatchObject({
      title: '가상 만화',
      volumeNumber: 2,
      volumeLabel: '2',
      isbn: '0012345678901',
      seriesTitle: '가상 만화',
      editionStatement: '특별판',
      status: 'DEPOSITED',
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(body)).not.toContain('test-key-never-real');
  });

  it('returns an exact-title record with missing manga metadata in the primary group and logs independent diagnostic scores', async () => {
    vi.stubEnv('NL_API_MODE', 'live');
    vi.stubEnv('NL_API_KEY', 'test-key-never-real');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      PAGE_NO: '1',
      TOTAL_COUNT: '1',
      docs: [{
        TITLE: '달의 정원',
        VOL: '1권',
        AUTHOR: '가상 작가',
        EA_ISBN: '0012345678901',
        PUBLISHER: '가상 출판사',
        SUBJECT: '',
        EA_ADD_CODE: '',
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const diagnosticSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const response = await GET(requestFor({ q: '달의 정원' }));
    const body = await response.json();
    const diagnosticCall = diagnosticSpy.mock.calls.find(([event]) => event === '[PUBLICATION RANKING]');
    const diagnostic = diagnosticCall?.[1] as { results?: Array<Record<string, unknown>> } | undefined;

    expect(response.status).toBe(200);
    expect(body.works[0]).toMatchObject({ mangaClassification: 'UNCERTAIN', relevanceBand: 'HIGH' });
    expect(body.works[0]).not.toHaveProperty('titleRelevanceScore');
    expect(body.works[0]).not.toHaveProperty('mangaEvidenceScore');
    expect(body.works[0]).not.toHaveProperty('classificationReasons');
    expect(diagnostic?.results?.[0]).toMatchObject({
      title: ['달의 정원'],
      normalizedTitle: '달의 정원',
      titleRelevanceScore: 115,
      mangaEvidenceScore: 5,
      mangaClassification: 'UNCERTAIN',
      resultGroup: 'PRIMARY',
      additionalReason: null,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('returns a configuration error for the official invalid-key code in HTTP 200 without exposing response data', async () => {
    vi.stubEnv('NL_API_MODE', 'live');
    vi.stubEnv('NL_API_KEY', 'test-key-never-real');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: { code: '011' } }), { status: 200 }));

    const response = await GET(requestFor({ q: '가상 만화 오류 케이스' }));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error.code).toBe('CONFIG_ERROR');
    expect(body.error.message).not.toContain('test-key-never-real');
    expect(body.error.message).not.toContain('011');
    expect(body.error).not.toHaveProperty('upstreamCode');
  });

  it('returns an upstream error instead of treating an unknown JSON shape as no results', async () => {
    vi.stubEnv('NL_API_MODE', 'live');
    vi.stubEnv('NL_API_KEY', 'test-key-never-real');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ message: 'unknown test response' }), { status: 200 }));

    const response = await GET(requestFor({ q: '가상 만화 미확인 구조' }));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(body).not.toHaveProperty('works');
  });
});
