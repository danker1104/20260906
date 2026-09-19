# MangaFind V1 Benchmark

실제 Gemini API quota를 보호하기 위해 자동화된 테스트는 mock gateway만 사용합니다. 실제 API benchmark는 비용 승인과 테스트 샘플 준비 후 수동으로 실행합니다.

## 30건 구성

- 이미지 1장: 10건
- 이미지 2장: 10건
- 이미지 3장: 10건
- 정상 성공, 단서 부족, 한국 정보 부분 실패, 핵심 실패를 각 그룹에 포함

## 기록 항목

- 전체 latency와 p50/p95
- 이미지 검증 latency
- 각 모델 단계 latency
- 모델별 입력·출력 토큰
- Google Search 사용 여부
- 최종 상태 비율
- 요청당 평균·최대 비용
- Top 1 정확도와 Top 3 포함률

## 실행 원칙

- 무료 Gemini Key로 반복 호출하지 않는다.
- 동일 이미지를 자동 재시도하지 않는다.
- 단계 timeout은 12초, 전체 timeout은 60초를 넘기지 않는다.
- 원본 이미지, 검색 원문, API Key는 로그와 결과 파일에 저장하지 않는다.
