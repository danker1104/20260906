# MangaFind V1 Technical Requirements Document

## 1. 문서 목적과 확정 결정

이 문서는 `PRD.md`와 `아키텍처.md`를 실제 구현 계약으로 구체화한다.

확정 사항:

- TypeScript, Node.js, Next.js App Router, React, Tailwind CSS
- 동기식 `POST /api/identify`
- Gemini 이미지 분석·Google Search grounding 1회와 최종 판정 1회
- 정상 요청당 Gemini 호출 2회 제한
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
| AI | Gemini API, `gemini-3.8-flash` for image analysis |
| 검색 | Gemini `google_search` 도구 |
| 검증 | TypeScript 타입 + JSON Schema 또는 Zod |
| 테스트 | TypeScript 단위·통합·계약 테스트, Playwright E2E |
| 배포 | Docker, Azure Container Apps |
| Gateway | Azure API Management |
| Secret | Azure Key Vault, Managed Identity |

Python, 별도 OCR 런타임, 별도 검색 서버는 V1에서 사용하지 않는다. 외부 모델 응답은 `unknown`으로 받고 스키마 검증 후 내부 타입으로 변환한다. 클라이언트는 서버 전용 SDK와 Secret을 import하지 않는다.

```text
MangaFind/
├─ azure.yaml                         AZD 서비스 정의
├─ Dockerfile                          프로덕션 컨테이너 이미지
├─ package.json                        의존성 및 실행 스크립트
├─ next.config.*                       Next.js 설정
├─ src/
│  ├─ app/                             페이지와 Route Handler
│  │  ├─ page.tsx                      Website/PWA 검색 홈
│  │  ├─ layout.tsx                    공통 HTML·메타데이터·Provider
│  │  ├─ globals.css                   전역 스타일·디자인 토큰
│  │  └─ api/
│  │     ├─ health/route.ts            Container Apps health probe
│  │     └─ identify/route.ts           POST /api/identify 진입점
│  ├─ components/                      공유 React UI 컴포넌트
│  │  ├─ upload/                       업로드·미리보기·입력 오류 UI
│  │  ├─ analysis/                     파이프라인 진행 상태 UI
│  │  └─ results/                      후보·상태·결과 UI
│  └─ lib/
│     ├─ domain/                       공유 타입 및 상태 매핑
│     ├─ pipeline/                     ①→② 오케스트레이션
│     ├─ ai/                           Gemini 어댑터 및 프롬프트
│     ├─ validation/                   이미지·환경변수·응답 검증
│     └─ observability/                requestId·로그·메트릭
├─ tests/                              단위·통합·계약 테스트
├─ e2e/                                브라우저 사용자 흐름 테스트
├─ infra/                              Azure 리소스 및 권한 정의
└─ .azure/                             AZD 배포 계획·환경 상태
```

이 트리는 논리 구조와 초기 스캐폴딩의 기준이다. `src/app`, `src/components`, `src/lib`는 코드 책임 경계이며 각각 독립 AZD 서비스나 컨테이너가 아니다. Website와 PWA는 하나의 Next.js 앱에서 제공한다.

### 2.1 애플리케이션 루트와 AZD 서비스 경계

MangaFind V1은 Website와 PWA를 별도 애플리케이션이나 별도 AZD 서비스로 나누지 않는다. 하나의 Next.js 애플리케이션이 브라우저 화면, PWA 화면, `/api/health`, `/api/identify`를 함께 제공한다.

프로젝트 루트와 AZD 서비스 루트는 같게 유지한다.

다음 경계를 고정한다.

- `azure.yaml`의 애플리케이션 서비스 이름은 하나만 사용한다.
- Docker build context와 `Dockerfile` 경로는 프로젝트 루트를 기준으로 한다.
- `src/app`, `src/lib` 또는 `src/components`를 독립 AZD 서비스나 독립 컨테이너로 등록하지 않는다.
- Website와 PWA의 표시 차이는 같은 Next.js 앱의 라우팅·렌더링 계층에서 처리한다.
- `infra/`는 애플리케이션 소스와 분리된 배포 정의이며, 런타임에 번들하거나 이미지에 복사하지 않는다.

이 경계를 지켜야 이후 `azd up`에서 서비스 이름, Docker context, 이미지 경로가 바뀌지 않는다.

## 3. API 요청 계약

`POST /api/identify`는 `multipart/form-data`의 `images` 필드를 받는다.

- 이미지 1~3개
- JPG, JPEG, PNG, WebP
- 파일당 최대 10MB
- 가로·세로 각각 최대 8192px
- 이미지당 최대 64MP
- 서버가 확장자, MIME, 매직 바이트, 디코딩 가능 여부를 모두 검증

클라이언트 검증은 UX용이며 서버 검증을 대체하지 않는다.

### 3.1 스캐폴딩 단계의 엔드포인트

기능 구현 전 최초 배포에서는 프로세스와 컨테이너 라우팅만 검증할 수 있도록 다음 임시 동작을 허용한다.

- `GET /api/health`: 외부 Gemini, Key Vault, 검색 서비스에 의존하지 않고 애플리케이션 프로세스가 요청을 처리할 수 있으면 HTTP 200을 반환한다.
- `POST /api/identify`: AI 파이프라인 구현 전에는 HTTP 501과 임시 미구현 응답을 반환할 수 있다.

스캐폴딩용 501 동작은 V1 공개 API 계약이 아니며, 식별 기능 구현 시 성공·부분 성공·오류 계약으로 교체한다. health endpoint에서 Gemini 연결이나 Secret 존재 여부를 검사하지 않는다. 외부 의존성 상태 확인은 별도 운영 진단과 메트릭으로 처리한다.

Container Apps probe는 `/api/health`를 사용하고, API Management 외부 API에는 `/api/identify`만 공개한다. Container Apps backend는 가능하면 외부 직접 접근을 차단하고 API Management를 통해서만 접근하도록 구성한다.

## 4. 공개 응답 계약

```typescript
type IdentifyStatus = 'SUCCESS' | 'INSUFFICIENT' | 'FAILED';
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
		finalJudgment: StageStatus;
	};
	candidates: Candidate[];
}
```

규칙:

- 후보는 최대 3개이며 `rank`는 1부터 연속 부여한다.
- `SUCCESS`에서 `koreanTitle`은 문자열이다.
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

### 4.2 2회 호출 실패 계약

①은 이미지 OCR·단서 추출과 Google Search grounding을 함께 수행한다. ②는 ①의 검증된 결과를 받아 일본 후보 TOP 3, 한국 제목, 정발 여부, 근거를 한 번에 반환한다. ①이 `INSUFFICIENT`, `FAILED`, `TIMEOUT`이면 ②는 `SKIPPED`다. ②가 실패하거나 schema 검증에 실패하면 `FAILED`와 빈 후보 배열을 반환한다.

```json
{
	"status": "SUCCESS",
	"requestId": "request-id",
	"stages": {
		"imageAnalysis": "SUCCESS",
		"finalJudgment": "SUCCESS"
	},
	"candidates": [
		{
			"rank": 1,
			"japaneseTitle": "星の下の彼女",
			"koreanTitle": "별 아래의 그녀",
			"koreanTitleStatus": "COMMON",
			"publicationStatus": "NOT_FOUND",
			"confidence": "HIGH",
			"evidence": ["DIALOGUE_MATCH"],
			"author": "山田太郎",
			"koreanInvestigationStatus": "SUCCESS"
		}
	]
}
```

## 5. 파이프라인 구현 계약

```text
request-control
→ validateAndPrepareImages
→ analyzeImagesAndSearch
→ finalJudgment
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

### 5.2 ② 최종 판정: Gemini

①의 검증된 OCR·단서·검색 결과 JSON을 입력으로 받는다.

- 일본 작품 후보 TOP 3을 선정한다.
- 후보별 한국 제목·정발 여부·근거·판정 수준을 반환한다.
- 근거 없는 후보는 반환하지 않는다.

## 6. 상태 전파

| 조건 | 실행하지 않는 단계 | 최상위 상태 | 후보 |
|---|---|---|---|
| 이미지 검증 실패 | 모델 전체 | HTTP 400 `INVALID_IMAGE` | 없음 |
| ① `INSUFFICIENT` | ② | `INSUFFICIENT` | 빈 배열 |
| ① `FAILED`·`TIMEOUT` | ② | `FAILED` | 빈 배열 |
| ② `SUCCESS` | 없음 | `SUCCESS` | TOP 1~3 |
| ② `FAILED`·`TIMEOUT`·검증 실패 | 요청 종료 | `FAILED` | 빈 배열 |

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
| ① 이미지 분석·검색 grounding | 12초 |
| ② 최종 후보·한국 정보 판정 | 12초 |
| 검증·응답·네트워크 여유 | 12초 |
| 전체 | 60초 |

각 단계 timeout은 모델 호출과 네트워크 왕복을 포함한다. 서버 자동 재시도는 없다.

- timeout 시 해당 단계 상태 기록
- 다음 단계 입력이 없으면 다음 단계를 `SKIPPED`
- ① 실패 시 ②는 `SKIPPED`
- 외부 호출 취소가 실제 과금까지 중단하는지는 벤치마크로 확인

### 9.1 계층별 timeout 정합성

60초는 애플리케이션의 전체 처리 예산이며, 외부 Gateway나 플랫폼이 이보다 먼저 연결을 끊어서는 안 된다.

- 각 모델 단계는 12초를 넘기지 않는다.
- 애플리케이션 전체 deadline은 60초로 관리한다.
- API Management backend timeout과 Container Apps 요청 경로는 애플리케이션의 60초 예산보다 짧지 않게 설정한다.
- Gateway가 추가하는 인증·정책·네트워크 지연을 고려해 플랫폼 timeout에는 여유를 둔다. 정확한 상한과 지원 범위는 Azure 배포 전 validation에서 확인한다.
- 브라우저 timeout은 서버가 반환할 수 있는 `TIMEOUT` 또는 구조화된 오류를 수신할 수 있도록 서버·Gateway 계약과 함께 정한다.

환경변수의 기본값은 애플리케이션 deadline을 표현하며, APIM·Container Apps 설정의 복사본으로만 사용하지 않는다.

정상 요청의 기본 호출 수는 Gemini 2회다. 다음 값을 계측한다.

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

- ①→② 모두 성공
- ① `INSUFFICIENT` → ② `SKIPPED` → `INSUFFICIENT`
- ① `FAILED`·`TIMEOUT` → ② `SKIPPED` → `FAILED`
- ② timeout·검증 실패 → `FAILED`
- 2회 호출 상한 확인
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
- 프로젝트 루트를 build context로 사용
- `Dockerfile`은 프로젝트 루트에 두고 Next.js standalone 또는 production start 산출물만 runtime image에 포함
- `infra/`, 테스트 원본, `.env*`, 로컬 캐시와 원본 업로드 파일은 `.dockerignore`로 제외
- 이미지가 빌드될 때 Gemini API 호출이나 Key Vault 접근을 수행하지 않음

### 12.2 Container Apps

TRD 구현 시 CPU·메모리·최소/최대 replica·ingress·probe·ACR pull 권한·Managed Identity를 지정한다. 컨테이너는 stateless로 유지하고 APIM이 외부 rate limit을 담당한다.

초기 스캐폴딩 배포와 기능 구현 후 배포는 같은 AZD 서비스와 같은 Container App을 사용한다. 초기 단계에는 AI 호출 없이도 컨테이너가 기동해야 하며, Gemini Secret이 아직 연결되지 않았다는 이유로 `/api/health`가 실패해서는 안 된다. 기능 구현 후에는 동일한 리소스 경계에 Key Vault Secret 참조와 서버 전용 Gemini 설정만 추가한다.

다음 리소스 경계는 초기 배포부터 최종 배포까지 유지한다.

```text
Container Registry
Container Apps Environment
Container App
Managed Identity
Key Vault
Application Insights
API Management
```

초기 배포에서 리소스를 생략했다가 나중에 애플리케이션 endpoint, ingress, Secret 전달 방식을 바꾸는 방식은 피한다. 비용 또는 환경 제약으로 특정 리소스를 임시 생략해야 하는 경우에는 AZD 환경 변수와 인프라 파라미터로 명시하고, 외부 endpoint와 서비스 이름은 유지한다.

### 12.3 API Management

- `/api/identify`만 외부 공개
- `/api/health`는 Container Apps probe와 내부 운영 확인용으로 사용하며 기본 외부 API로 공개하지 않음
- CORS 허용 Origin 제한
- rate limit과 request size 정책 적용
- 429와 `Retry-After` 응답 표준화
- 백엔드 Container Apps 접근 보호
- backend timeout은 애플리케이션 60초 예산보다 짧지 않게 설정
- APIM이 생성하거나 전달하는 request ID를 Container Apps와 애플리케이션 로그에서 일관되게 사용

### 12.4 AZD 반복 배포 계약

기능 구현 후 별도 수동 배포 절차를 만들지 않고 `azd up`을 반복할 수 있도록 다음 값을 안정적인 계약으로 취급한다.

- AZD 서비스 이름과 Dockerfile 상대 경로
- Container App 및 Container Apps Environment의 논리적 이름
- Key Vault Secret 이름과 Managed Identity 권한 대상
- 애플리케이션이 받는 환경변수 이름
- APIM backend와 공개 API 경로
- infra 출력값과 서비스 간 참조 방식

코드 변경은 이미지 재빌드·Container App revision 갱신으로 반영하고, 인프라 변경은 Bicep 변경으로 반영한다. Secret 값은 `azure.yaml`, Dockerfile, 소스 코드, `.env.example`에 기록하지 않는다.

## 13. 환경변수 계약

`.env.example`에는 값이 아닌 이름과 설명만 둔다.

```text
GEMINI_API_KEY
GEMINI_PRO_MODEL=gemini-3.8-flash
GEMINI_FLASH_MODEL=gemini-3.8-flash
IDENTIFY_STAGE_TIMEOUT_MS=12000
IDENTIFY_TOTAL_TIMEOUT_MS=60000
GEMINI_INTER_CALL_DELAY_MS=5000
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
- [ ] ① 실패 시 ② `SKIPPED` 통합 테스트 통과
- [ ] ② 실패 시 원시 결과 미노출
- [ ] 이미지 버퍼 정리와 손상 파일 테스트 존재
- [ ] APIM rate limit을 staging에서 검증
- [ ] Key Vault Managed Identity 접근 검증
- [ ] 모델 응답·token·latency 계측 확인
- [ ] 30건 비용·성능 벤치마크 기록
- [ ] Docker build와 Azure staging 배포 성공
- [ ] 브라우저 번들에 Secret 없음 자동 검사
