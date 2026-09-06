# MangaFind V1 Technical Requirements Document

## 1. 문서 목적과 확정 결정

이 문서는 `PRD.md`와 `아키텍처.md`를 실제 구현 계약으로 구체화한다.

확정 사항:

- TypeScript, Node.js, Next.js App Router, React, Tailwind CSS
- 동기식 `POST /api/identify`
- Gemini 2.5 Pro 이미지 분석과 최종 판정
- Gemini 2.5 Flash + `google_search` 일본·한국 정보 검색
- ③ 한국 검색 실패 시에도 ④ 최종 판정 실행
- 단계별 timeout 12초, 전체 timeout 60초
- 서버 자동 재시도 없음
- 전역 rate limit: Azure API Management
- Secret: Azure Key Vault + Container Apps Managed Identity
- 이미지·검색 기록 영구 저장 없음

구체적인 SDK 버전, 이미지 처리 라이브러리 버전, APIM SKU, Container Apps 리소스는 구현 전 검증 후 lockfile과 배포 설정에 고정한다.

## 2. 기술 스택과 코드 경계

| 영역 | 기준 |
|---|---|
| 언어 | TypeScript strict mode |
| 런타임 | Node.js LTS |
| 웹 | Next.js App Router, React |
| 스타일 | Tailwind CSS |
| AI | Gemini API, `gemini-2.5-pro`, `gemini-2.5-flash` |
| 검색 | Gemini `google_search` 도구 |
| 검증 | TypeScript 타입 + JSON Schema 또는 Zod |
| 테스트 | TypeScript 단위·통합·계약 테스트, Playwright E2E |
| 배포 | Docker, Azure Container Apps |
| Gateway | Azure API Management |
| Secret | Azure Key Vault, Managed Identity |

Python, 별도 OCR 런타임, 별도 검색 서버는 V1에서 사용하지 않는다. 외부 모델 응답은 `unknown`으로 받고 스키마 검증 후 내부 타입으로 변환한다. 클라이언트는 서버 전용 SDK와 Secret을 import하지 않는다.

```text
src/app/                 Next.js 페이지와 Route Handler
src/components/          React UI
src/lib/ai/              Gemini 어댑터와 프롬프트
src/lib/pipeline/        ①→②→③→④ 오케스트레이션
src/lib/validation/      이미지·환경변수·외부 응답 검증
src/lib/domain/          공유 도메인 타입과 상태 매핑
tests/                   단위·통합·계약 테스트
e2e/                     브라우저 테스트
```

## 3. API 요청 계약

`POST /api/identify`는 `multipart/form-data`의 `images` 필드를 받는다.

- 이미지 1~3개
- JPG, JPEG, PNG, WebP
- 파일당 최대 10MB
- 가로·세로 각각 최대 8192px
- 이미지당 최대 64MP
- 서버가 확장자, MIME, 매직 바이트, 디코딩 가능 여부를 모두 검증

클라이언트 검증은 UX용이며 서버 검증을 대체하지 않는다.

## 4. 공개 응답 계약

```typescript
type IdentifyStatus = 'SUCCESS' | 'PARTIAL_SUCCESS' | 'INSUFFICIENT' | 'FAILED';
type StageStatus = 'SUCCESS' | 'PARTIAL' | 'INSUFFICIENT' | 'FAILED' | 'TIMEOUT' | 'SKIPPED';
type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';
type KoreanTitleStatus = 'OFFICIAL' | 'COMMON' | 'TRANSLATED' | 'UNKNOWN';
type PublicationStatus = 'CONFIRMED' | 'NOT_FOUND' | 'UNKNOWN';

type EvidenceCode =
	| 'DIALOGUE_MATCH'
	| 'CHARACTER_NAME_MATCH'
	| 'WORK_TITLE_MATCH'
	| 'AUTHOR_MATCH'
	| 'PUBLISHER_MATCH'
	| 'SERIALIZATION_MATCH'
	| 'VISUAL_CLUE_MATCH'
	| 'SEARCH_CONSISTENCY';

interface Candidate {
	rank: 1 | 2 | 3;
	japaneseTitle: string;
	koreanTitle: string | null;
	koreanTitleStatus: KoreanTitleStatus;
	publicationStatus: PublicationStatus;
	confidence: Confidence;
	evidence: EvidenceCode[];
	author: string | null;
	koreanInvestigationStatus: StageStatus;
}

interface IdentifyResponse {
	status: IdentifyStatus;
	requestId: string;
	stages: {
		imageAnalysis: StageStatus;
		japaneseIdentification: StageStatus;
		koreanInvestigation: StageStatus;
		finalJudgment: StageStatus;
	};
	candidates: Candidate[];
}
```

규칙:

- 후보는 최대 3개이며 `rank`는 1부터 연속 부여한다.
- `SUCCESS`에서 `koreanTitle`은 문자열이다.
- `PARTIAL_SUCCESS`에서 한국 정보가 없는 후보는 `koreanTitle: null`, 제목 상태와 정발 상태는 `UNKNOWN`이다.
- `evidence`는 1~5개의 enum 배열이다.
- 검색 원문, 출처 URL 목록, 프롬프트, API Key는 공개 응답에 포함하지 않는다.

### 4.1 오류 계약

```typescript
type ErrorCode =
	| 'INVALID_IMAGE'
	| 'RATE_LIMITED'
	| 'TIMEOUT'
	| 'INSUFFICIENT_CLUES'
	| 'UPSTREAM_UNAVAILABLE'
	| 'VALIDATION_FAILED'
	| 'INTERNAL_ERROR';

interface ErrorResponse {
	error: {
		code: ErrorCode;
		message: string;
		requestId: string;
		retryAfterSeconds?: number;
	};
}
```

이미지 형식·크기·손상 오류는 HTTP 400 `INVALID_IMAGE`로 반환한다. 오류 응답에는 외부 오류 원문, 스택 트레이스, 내부 프롬프트, Secret을 포함하지 않는다.

### 4.2 ③ 실패 후 ④ 실행 계약

③이 `PARTIAL`, `INSUFFICIENT`, `FAILED`, `TIMEOUT`이어도 ②가 후보를 반환하면 ④를 실행한다. ④는 ① JSON과 ② 후보를 사용하고, 한국 정보가 없는 후보에는 `UNKNOWN`을 채운다.

```json
{
	"status": "PARTIAL_SUCCESS",
	"requestId": "request-id",
	"stages": {
		"imageAnalysis": "SUCCESS",
		"japaneseIdentification": "SUCCESS",
		"koreanInvestigation": "TIMEOUT",
		"finalJudgment": "SUCCESS"
	},
	"candidates": [
		{
			"rank": 1,
			"japaneseTitle": "星の下の彼女",
			"koreanTitle": null,
			"koreanTitleStatus": "UNKNOWN",
			"publicationStatus": "UNKNOWN",
			"confidence": "HIGH",
			"evidence": ["DIALOGUE_MATCH"],
			"author": "山田太郎",
			"koreanInvestigationStatus": "TIMEOUT"
		}
	]
}
```

## 5. 파이프라인 구현 계약

```text
request-control
→ validateAndPrepareImages
→ analyzeImages
→ searchJapaneseCandidates
→ searchKoreanInformation
→ judgeCandidates
→ validateAndMapResponse
```

각 단계는 HTTP 객체를 직접 다루지 않고 입력·출력 타입을 사용한다. 원시 Gemini 응답은 다음 단계로 직접 전달하지 않고 Schema 검증을 통과한 내부 객체로 변환한다.

### 5.1 ① 이미지 분석: Gemini 2.5 Pro

입력은 전처리된 이미지 1~3장이다. 출력은 다음 필드를 포함한다.

```typescript
interface ImageAnalysisResult {
	japaneseTexts: string[];
	suspectedTitles: string[];
	characterNames: string[];
	authorClues: string[];
	publisherClues: string[];
	serializationClues: string[];
	visualClues: string[];
	imageStatuses: Array<'SUCCESS' | 'INSUFFICIENT' | 'FAILED'>;
}
```

이 단계는 작품을 확정하거나 최종 순위를 정하지 않는다. 단서가 없으면 `INSUFFICIENT`, 외부 오류·Schema 오류면 `FAILED`다.

### 5.2 ② 일본 후보 검색: Gemini 2.5 Flash + Google Search

①의 검증된 JSON을 입력으로 받고 `google_search` 도구를 활성화한다.

- 후보별 검색 요약과 `searchSupport`를 생성한다.
- `evidence`가 비어 있는 후보는 서버 어댑터에서 제거한다.
- 남은 후보를 rank 순으로 정렬하고 최대 3개만 전달한다.
- 후보가 0개면 `japaneseIdentification = INSUFFICIENT`다.
- 후보 rank는 ③과 ④에서 변경하지 않는다.

### 5.3 ③ 한국 정보 검색: Gemini 2.5 Flash + Google Search

②의 rank가 고정된 후보 1~3개를 한 번의 Flash + Search 호출에 전달한다.

- 후보별 공식 제목·통용명·AI 번역·정발 여부를 조사한다.
- 입력 후보의 rank와 출력 `candidateResults[].rank`는 같아야 한다.
- 후보별 결과가 모두 완료되면 `SUCCESS`, 일부만 완료되면 `PARTIAL`이다.
- 검색 결과가 없으면 `INSUFFICIENT`, 외부 오류면 `FAILED`, 시간 초과면 `TIMEOUT`이다.
- 한 후보의 실패가 다른 후보의 성공을 무효화하지 않는다.

### 5.4 ④ 최종 판정: Gemini 2.5 Pro

① 이미지 분석 JSON, ② 후보 TOP 3, ③ 후보별 결과 또는 실패 상태를 입력으로 받는다.

- 원본 이미지를 다시 전달하지 않는다.
- `google_search`를 사용하지 않는다.
- ③이 실패해도 ② 후보가 있으면 실행한다.
- ② 후보와 ③ 한국 정보를 연결하고 순위를 재평가한다.
- 근거 없는 주장을 제거하고 제목·정발 상태 조합을 검증한다.
- ④ timeout·외부 오류·Schema 검증 실패는 `FAILED`이며 후보를 반환하지 않는다.

## 6. 상태 전파

| 조건 | 실행하지 않는 단계 | 최상위 상태 | 후보 |
|---|---|---|---|
| 이미지 검증 실패 | 모델 전체 | HTTP 400 `INVALID_IMAGE` | 없음 |
| ① `INSUFFICIENT` | ②·③·④ | `INSUFFICIENT` | 빈 배열 |
| ① `FAILED`·`TIMEOUT` | ②·③·④ | `FAILED` | 빈 배열 |
| ② `INSUFFICIENT` | ③·④ | `INSUFFICIENT` | 빈 배열 |
| ② `FAILED`·`TIMEOUT` | ③·④ | `FAILED` | 빈 배열 |
| ③ `SUCCESS` | 없음 | ④ 결과에 따름 | TOP 1~3 |
| ③ `PARTIAL`·`INSUFFICIENT`·`FAILED`·`TIMEOUT` | 없음 | ④ 성공 시 `PARTIAL_SUCCESS` | TOP 1~3 |
| ④ `FAILED`·`TIMEOUT`·검증 실패 | 요청 종료 | `FAILED` | 빈 배열 |

③ 실패는 ④를 `SKIPPED`로 만들지 않는다. ④는 한국 정보 없는 일본 후보 판정 모드로 실행한다.

## 7. 이미지 처리·보안

### 7.1 검증 순서

1. 파일 수 1~3개
2. 파일당 10MB 이하
3. 매직 바이트와 실제 MIME
4. 안전한 디코딩 성공
5. 가로·세로 각각 8192px 이하
6. 총 픽셀 수 64MP 이하
7. EXIF·IPTC·XMP 등 메타데이터 제거
8. Gemini 전달용 임시 버퍼 생성

모든 파일이 통과해야 ①을 호출한다. 구체적인 디코더와 재인코더는 구현 전 검증해 고정한다.

### 7.2 수명과 삭제

- 원본과 전처리 버퍼는 요청 컨텍스트에서만 유지한다.
- `try/finally` 정리 경로에서 성공·실패·timeout 모두 버퍼를 해제한다.
- V1은 영구 파일 저장을 사용하지 않는다.
- 비정상 프로세스 종료까지의 완전한 메모리 삭제는 보장 대상이 아니므로 컨테이너 메모리·재시작 모니터링을 둔다.
- 이미지 본문과 검색 원문은 로그·메트릭에 기록하지 않는다.

### 7.3 Secret

- Gemini API Key는 Azure Key Vault에 저장한다.
- Container Apps Managed Identity가 Key Vault Secret 읽기 권한을 가진다.
- Docker image, Git, 브라우저 번들, `.env.example`에는 Secret 값을 넣지 않는다.
- 로컬 `.env.local`은 Git에서 제외한다.
- Key Vault 접근 로그와 키 교체 절차를 운영 문서에 기록한다.

## 8. Rate limit과 요청 제어

Azure API Management가 외부 요청 앞에서 전역 제한을 담당한다.

- IP 기준 분당 3회
- IP 기준 1일 30회
- 기본 요청 크기 제한
- HTTP 429
- `Retry-After` 헤더
- 요청 ID 전달

Container Apps 애플리케이션은 Gateway가 전달한 요청 ID를 로그에 사용한다. 전역 제한의 기준 저장소로 인스턴스 메모리를 사용하지 않는다. APIM이 전달하는 원본 IP 헤더는 신뢰할 수 있는 Gateway가 추가한 값만 사용한다.

## 9. Timeout과 비용

| 단계 | 최대 시간 |
|---|---:|
| ① 이미지 분석 | 12초 |
| ② 일본 검색 | 12초 |
| ③ 한국 검색 | 12초 |
| ④ 최종 판정 | 12초 |
| 검증·응답·네트워크 여유 | 12초 |
| 전체 | 60초 |

각 단계 timeout은 모델 호출과 네트워크 왕복을 포함한다. 서버 자동 재시도는 없다.

- timeout 시 해당 단계 상태 기록
- 다음 단계 입력이 없으면 다음 단계를 `SKIPPED`
- ③만 실패하면 ④ 실행
- 외부 호출 취소가 실제 과금까지 중단하는지는 벤치마크로 확인

정상 요청의 기본 호출 수는 Pro 2회와 Flash + Search 2회다. 다음 값을 계측한다.

- 모델별 입력·출력 토큰
- Search 사용 여부와 검색 메타데이터
- 단계별 p50·p95 latency
- 결과 상태별 비율
- 요청당 평균·최대 비용

## 10. 관측

모든 이벤트에 `requestId`를 연결한다.

- `identify_started`
- `image_validation_completed`
- `stage_started`
- `stage_completed`
- `stage_failed`
- `rate_limit_rejected`
- `identify_completed`

단계 이벤트에는 `stage`, `status`, `latencyMs`, `model`, 가능한 경우 token count를 포함한다. 이미지 본문, 검색 원문, URL 전체 목록, API Key, 프롬프트 전문은 포함하지 않는다.

로그 저장소, 보존 기간, 접근 권한, 알람 임계값은 Azure Monitor/Application Insights 구성 시 확정한다.

## 11. 테스트

### 11.1 단위 테스트

- 파일 수·크기·MIME·매직 바이트·픽셀 제한
- 손상 파일과 EXIF 제거
- 상태 전파와 후보 rank 보존
- 제목 상태·정발 상태 조합
- `evidence` 1~5개 제한
- 오류 코드 매핑

### 11.2 통합 테스트

Gemini와 Search를 mock한다.

- ①→②→③→④ 모두 성공
- ③ `INSUFFICIENT` → ④ 실행 → `PARTIAL_SUCCESS`
- ③ `FAILED` → ④ 실행 → `PARTIAL_SUCCESS`
- ③ `TIMEOUT` → ④ 실행 → `PARTIAL_SUCCESS`
- ④ timeout·검증 실패 → `FAILED`
- ② 실패 → ③·④ `SKIPPED`
- 이미지 검증 실패 → HTTP 400
- APIM 429 응답 매핑

### 11.3 E2E 테스트

- 모바일 1장·3장 업로드
- 정상 결과와 부분 성공 결과
- `UNKNOWN` 한국 정보 표시
- 60초 timeout 안내
- 브라우저 번들에 Gemini Key 없음

## 12. Docker와 Azure

### 12.1 Docker

- multi-stage build
- 개발 의존성과 런타임 의존성 분리
- runtime image에 Secret·`.env` 포함 금지
- non-root 실행 검토
- health endpoint 제공

### 12.2 Container Apps

TRD 구현 시 CPU·메모리·최소/최대 replica·ingress·probe·ACR pull 권한·Managed Identity를 지정한다. 컨테이너는 stateless로 유지하고 APIM이 외부 rate limit을 담당한다.

### 12.3 API Management

- `/api/identify`만 외부 공개
- CORS 허용 Origin 제한
- rate limit과 request size 정책 적용
- 429와 `Retry-After` 응답 표준화
- 백엔드 Container Apps 접근 보호

## 13. 환경변수 계약

`.env.example`에는 값이 아닌 이름과 설명만 둔다.

```text
GEMINI_API_KEY
GEMINI_PRO_MODEL=gemini-2.5-pro
GEMINI_FLASH_MODEL=gemini-2.5-flash
IDENTIFY_STAGE_TIMEOUT_MS=12000
IDENTIFY_TOTAL_TIMEOUT_MS=60000
MAX_IMAGES=3
MAX_IMAGE_BYTES=10485760
MAX_IMAGE_PIXELS=64000000
RATE_LIMIT_PER_MINUTE=3
RATE_LIMIT_PER_DAY=30
AZURE_KEY_VAULT_URI
APPLICATIONINSIGHTS_CONNECTION_STRING
```

Secret 값은 Dockerfile, Git, `.env.example`, 브라우저 코드에 넣지 않는다.

## 14. TRD 완료 조건

- [ ] 요청·성공·부분 성공·오류 Schema가 코드로 검증됨
- [ ] ③ 실패 후 ④ 실행 통합 테스트 통과
- [ ] ④ 실패 시 원시 결과 미노출
- [ ] 이미지 버퍼 정리와 손상 파일 테스트 존재
- [ ] APIM rate limit을 staging에서 검증
- [ ] Key Vault Managed Identity 접근 검증
- [ ] 모델 응답·token·latency 계측 확인
- [ ] 30건 비용·성능 벤치마크 기록
- [ ] Docker build와 Azure staging 배포 성공
- [ ] 브라우저 번들에 Secret 없음 자동 검사
