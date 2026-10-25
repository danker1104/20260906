import type { NlRawRecord } from './provider';

// Deliberately invalid ISBN-13 prefixes (979-11-00000-xx-x) so these never collide with
// a real book. Every title is also prefixed with "[Mock]" and the UI shows a dev-data banner.
const TODAY_PLUS = (days: number): string => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const TODAY_MINUS = (days: number): string => TODAY_PLUS(-days);

/** Work A: covers DEPOSITED, REGISTERED, DATE_PASSED, and UPCOMING in one series. */
const workA: NlRawRecord[] = [
  { id: 'mock-a-1', title: '[Mock] 테스트 작품 A 1권', isbn: '979-11-00000-01-4', author: '김가상', publisher: '가상출판사', pubPredateYn: 'N', expectedPublicationDate: TODAY_MINUS(400), depositStatus: 'Y', coverUrl: '/icon.svg', subject: '만화' },
  { id: 'mock-a-2', title: '[Mock] 테스트 작품 A 2권', isbn: '979-11-00000-02-1', author: '김가상', publisher: '가상출판사', pubPredateYn: 'N', expectedPublicationDate: TODAY_MINUS(300), depositStatus: 'Y', coverUrl: '/icon.svg', subject: '만화' },
  { id: 'mock-a-3', title: '[Mock] 테스트 작품 A 3권', isbn: '979-11-00000-03-8', author: '김가상', publisher: '가상출판사', pubPredateYn: 'N', expectedPublicationDate: null, depositStatus: 'N', coverUrl: null, subject: '만화' },
  { id: 'mock-a-4', title: '[Mock] 테스트 작품 A 4권', isbn: '979-11-00000-04-5', author: '김가상', publisher: '가상출판사', pubPredateYn: 'Y', expectedPublicationDate: TODAY_MINUS(30), depositStatus: 'N', coverUrl: null, subject: '만화' },
  { id: 'mock-a-5', title: '[Mock] 테스트 작품 A 5권', isbn: '979-11-00000-05-2', author: '김가상', publisher: '가상출판사', pubPredateYn: 'Y', expectedPublicationDate: TODAY_PLUS(60), depositStatus: 'N', coverUrl: null, subject: '만화' },
];

const sameTitleNovel: NlRawRecord = {
  id: 'mock-a-novel',
  title: '[Mock] 테스트 작품 A 소설판 1권',
  isbn: '979-11-00000-06-9',
  author: '김소설',
  publisher: '다른 가상 출판사',
  pubPredateYn: 'N',
  expectedPublicationDate: null,
  depositStatus: 'N',
  coverUrl: null,
  subject: '소설',
};

/** Work B: edition variants of the same volume (regular vs. special printing). */
const workB: NlRawRecord[] = [
  { id: 'mock-b-1-regular', title: '[Mock] 테스트 작품 B 1권', isbn: '979-11-00000-11-3', author: '이가상', publisher: '가상출판사', pubPredateYn: 'N', expectedPublicationDate: TODAY_MINUS(200), depositStatus: 'Y', coverUrl: '/icon.svg', subject: '만화' },
  { id: 'mock-b-1-special', title: '[Mock] 테스트 작품 B 1권 특별판', isbn: '979-11-00000-12-0', author: '이가상', publisher: '가상출판사', pubPredateYn: 'N', expectedPublicationDate: TODAY_MINUS(190), depositStatus: 'Y', coverUrl: '/icon.svg', subject: '만화' },
  { id: 'mock-b-2', title: '[Mock] 테스트 작품 B 2권', isbn: '979-11-00000-13-7', author: '이가상', publisher: '가상출판사', pubPredateYn: 'N', expectedPublicationDate: TODAY_MINUS(100), depositStatus: 'Y', coverUrl: '/icon.svg', subject: '만화' },
];

/** Work C: name looks similar to Work A but a different author/publisher — must stay a separate work. */
const workC: NlRawRecord[] = [
  { id: 'mock-c-1', title: '[Mock] 테스트 작품 에이 1권', isbn: '979-11-00000-21-2', author: '박다른작가', publisher: '다른출판사', pubPredateYn: 'N', expectedPublicationDate: TODAY_MINUS(50), depositStatus: 'Y', coverUrl: '/icon.svg', subject: '만화' },
];

/** Edge cases: no ISBN, ambiguous volume numbering, missing date, missing cover. */
const edgeCases: NlRawRecord[] = [
  { id: 'mock-edge-no-isbn', title: '[Mock] 테스트 작품 엣지 ISBN 없음', isbn: null, author: '최가상', publisher: '가상출판사', pubPredateYn: 'N', expectedPublicationDate: TODAY_MINUS(10), depositStatus: 'N', coverUrl: null },
  { id: 'mock-edge-unclear-volume', title: '[Mock] 테스트 작품 엣지 완결 세트', isbn: '979-11-00000-31-1', author: '최가상', publisher: '가상출판사', pubPredateYn: 'N', expectedPublicationDate: null, depositStatus: 'Y', coverUrl: null },
  { id: 'mock-edge-no-date', title: '[Mock] 테스트 작품 엣지 날짜 누락 1권', isbn: '979-11-00000-32-8', author: '정가상', publisher: '가상출판사', pubPredateYn: 'N', expectedPublicationDate: null, depositStatus: 'N', coverUrl: null },
];

export const MOCK_NL_RECORDS: NlRawRecord[] = [...workA, sameTitleNovel, ...workB, ...workC, ...edgeCases];

/** Query tokens that deliberately exercise non-happy-path behaviour in mock mode. */
export const MOCK_ERROR_QUERY_TOKEN = '오류테스트';
export const MOCK_EMPTY_QUERY_TOKEN = '검색결과없음테스트';
