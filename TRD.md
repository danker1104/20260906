# MangaFind V1 Technical Requirements Document

## 1. 문서 목적과 확정 결정

이 문서는 `PRD.md`와 `아키텍처.md`를 실제 구현 계약으로 구체화한다.

확정 사항:

- TypeScript, Node.js, Next.js App Router, React, Tailwind CSS
- 동기식 `POST /api/identify`
- OCR.space·Tavily·SerpApi Google Lens 연구 후 Azure Foundry 최종 판정 1회
- 정상 요청당 Azure Foundry 호출 1회 제한
- 단계별 timeout 12초, 전체 timeout 60초
- 서버 자동 재시도 없음
- 전역 rate limit: Azure API Management
- Secret: Azure Key Vault + Container Apps Managed Identity
- 원본 이미지 및 영구 검색 이력 저장 없음. 비용 절감을 위한 bounded process-memory research cache는 7.2의 제한을 따른다.

구체적인 SDK 버전, 이미지 처리 라이브러리 버전, APIM SKU, Container Apps 리소스는 구현 전 검증 후 lockfile과 배포 설정에 고정한다.

## 2. 기술 스택과 코드 경계

| 영역 | 기준 |
|---|---|
| 언어 | TypeScript strict mode |
| 런타임 | Node.js LTS |
| 웹 | Next.js App Router, React |
| 스타일 | Tailwind CSS |
| AI | Azure AI Foundry model inference endpoint |
| 검색 | Tavily, SerpApi Google Lens |
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
│     ├─ ai/                           Azure Foundry 어댑터 및 프롬프트
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

- `GET /api/health`: 외부 Foundry, Key Vault, 검색 서비스에 의존하지 않고 애플리케이션 프로세스가 요청을 처리할 수 있으면 HTTP 200을 반환한다.
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
	namuWikiUrl?: string;
	yes24?: {
		matched: boolean;
		itemId?: string;
		title?: string;
		coverUrl?: string;
		productUrl?: string;
		publisher?: string;
	};
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
- 예외적으로 `namuWikiUrl`에 최종 후보와 일치하는 나무위키 작품 문서 1개의 정규 URL을 제공할 수 있다. 기존 한국어 조사 및 번역명 역검색 결과에서만 선택하며, 별도 검색·모델 호출·재시도를 추가하지 않는다.
- `namuWikiUrl`은 HTTPS와 정확한 `namu.wiki` 호스트, `/w/{문서명}` 경로만 허용한다. 사용자 정보·비표준 포트·잘못된 인코딩·하위 문서·관리 이름공간은 거부하고 query와 fragment는 제거한다.
- 문서명과 검색 결과 제목이 일치하고, 일본 원제 또는 확인된 `OFFICIAL`/`COMMON` 한국어 제목과 일치해야 한다. 일본 원제 근거 또는 만화 분류 근거도 필요하다. `(만화)` 등 만화 구분자는 허용하지만 애니메이션 등 다른 구분자와 AI 번역명만의 일치는 허용하지 않는다.
- 모델이 반환한 URL은 사용하지 않는다. 일치하는 문서가 없으면 필드를 생략하고 UI 링크도 숨긴다. 링크 유무는 기존 제목·정발 상태와 식별 결과 상태를 바꾸지 않는다. 나무위키 본문을 별도로 요청하지 않으므로 링크의 실시간 접근 가능성은 보장하지 않는다.

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

각 단계는 HTTP 객체를 직접 다루지 않고 입력·출력 타입을 사용한다. 원시 Foundry 응답은 다음 단계로 직접 전달하지 않고 Schema 검증을 통과한 내부 객체로 변환한다.

### 5.1 ① 이미지 연구: OCR.space·Tavily·SerpApi Google Lens

OCR 원문과 줄 순서를 보존하고, 기존 overlay의 줄·단어 좌표를 후보 생성에 전달한다. 괄호 제목·일본어 해시태그와 인접한 연속 줄에서 최대 6줄·80자·6개의 제목 후보를 생성한다. 서로 다른 이미지, 떨어진 영역, 문장 종결부호와 SNS UI를 가로질러 결합하지 않는다. 좌표가 없으면 제한된 원문 순서 조합을 사용하며, 대사·불확실한 문구는 단서로 보존한다.

일본어 OCR을 무조건 세로쓰기 순서로 재배열하지 않는다. 글자 중심이 같은 열에 정렬되고 인접 열의 시작 높이가 맞는 등 세로쓰기 근거가 명확할 때만 같은 열은 위에서 아래, 인접 열은 오른쪽에서 왼쪽으로 복원한다. OCR이 글자나 열을 분리하면 기존 단어 좌표로 가까운 조각만 연결해 검색용 문장을 복원하고 문장부호를 유지한다. 이 읽기 순서 복원은 제목 후보 결합과 구분하며, 가로쓰기·대각선·방향이 불확실한 배치·떨어진 영역은 세로쓰기 규칙으로 합치지 않고 제공자 순서를 유지한다. 좌표가 부족하거나 overlay에 원문 문자가 누락되면 제공자 원문을 유지한다. 추가 OCR·검색·모델 호출은 하지 않는다.

OCR 제목은 Tavily에서 전체 작품명이 일치하고 만화 문맥이 있으며, 알려진 일본 출판·연재 출처 또는 독립된 두 출처의 출판·연재 근거가 확인돼야 검증된다. 단순 결과 개수·일부 문자열 일치는 검증 성공이 아니다. 후보 부재, 검증 실패 또는 검색 근거 충돌 시 기존 선택 이미지 1장의 Lens fallback을 사용한다. 검증된 후보가 하나이고 충돌이 없으면 Lens를 생략한다. OCR 후보·원문·Lens 출처는 함께 판정에 전달하고, 검증된 전체 제목과 무관한 모델 선택이나 부분 제목은 거부한다. YES24·국립중앙도서관은 일본 작품 식별 근거에서 제외한다.

이 보완은 OCR 요청 수, 일본 Tavily 최대 4회(OCR 최대 2회 + Lens 최대 2회), 기존 한국 검색·역검색 예산, Foundry 호출 경로를 늘리지 않는다. Lens의 이미지 최적화·업로드·타임아웃·기존 재시도 동작도 변경하지 않는다. 현재 코드의 Foundry 호출 수와 문서상 1회 목표 사이에 존재하는 차이는 `docs/benchmark.md`에 기록하며, 이번 수정에서 호출 구조를 재설계하지 않는다.

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

### 5.2 ② 최종 판정: Azure AI Foundry

①의 검증된 OCR·단서·검색 결과 JSON을 입력으로 받는다.

- 일본 작품 후보 TOP 3을 선정한다.
- 후보별 한국 제목·정발 여부·근거·판정 수준을 반환한다.
- 근거 없는 후보는 반환하지 않는다.
- Canonical 판정의 후보 묶음은 단서 단위다. 기존 evidence가 인물·관련 콘텐츠의 소속 작품과 전체 일본 원제를 명시하면 그 관계에 한해 후보 간 근거를 종합할 수 있다. `searchCandidateTitle`과 원본 출처의 연결은 보존하며 단순 동시 등장·같은 작가·모델 기억으로 근거를 옮기지 않는다. 인물명은 `CHARACTER_NAME_MATCH` 보조 근거로 사용하고 작품명으로 반환하지 않는다. 서버는 각 결과의 전체 원제 검증을 거친 뒤 정규화한 원제가 정확히 같은 결과만 첫 등장 순서를 유지해 통합하고, 기존 판정 수준 중 높은 결과의 필드를 사용하며 근거 enum의 합집합을 최대 5개로 제한한다. 통합 자체로 판정 수준을 올리지 않고, 다른 전체 제목·후속작은 유지한다. 한국어 근거 부족은 일본 후보를 추가할 사유가 아니며 이 처리는 검색·모델 호출을 늘리지 않는다.
- 일본어 OCR은 원문을 보존한 검색 단서이며, 정규화·편집거리와 기존 출판/연재 근거로 확인된 유일한 전체 작품명을 교정 후보로 전달한다. 유사한 검증 작품이 여러 개면 자동 교정하지 않는다. 특정 단어 치환은 금지한다. `UNKNOWN`·원제 null·`UNVERIFIED`·빈 근거인 미식별 보조 항목만 Canonical 응답 정규화에서 제외한다. 실제 작품을 주장하는 무근거 후보는 기존 스키마 검증에 실패하며 반환 후보의 근거 최소 1개 조건은 유지한다.
- 한국어 작품명 후보 추출과 공식·통용명 분류에서는 검색 결과의 제목·본문 경계를 보존하고, 국내배송·해외 거래처·직수입 취소수수료 안내를 작품명 후보로 사용하지 않는다. 원본 검색 근거는 유지한다.
- 확정 원제는 다시 일본 문자만 추출하지 않고 영문·숫자·기호를 포함한 전체 문자열에서 공백만 정리해 한국 검색·역검색에 전달한다. 한국어 후보 추출은 영문·숫자·기호를 보존하되 한글이 없는 일반 영문 문구는 이름 후보에서 제외하고 YES24 등 출처 꼬리말은 분리한다. Lens 직접 표기 보호의 예외는 그 Lens 검색의 `searchCandidateTitle`과 연결된 출판·연재 검증 출처가 전체 원제와 괄호 안 독음을 나란히 명시한 경우로 한정한다. 단순 동시 등장이나 모델 기억으로 원제를 바꾸지 않는다.
- 한국어 제목의 `- 나무위키` 등 출처 꼬리말만 제거해 동일 명칭의 독립 출처를 집계한다. COMMON과 한국 정발은 분리하며, 위키 1개만으로 COMMON·OFFICIAL·정발을 확정하지 않는다.
- 한국어 이름은 동일 전체 일본 원제로 검증된 유일한 나무위키 작품 문서명(`koreanVerifiedAliases`)을 최우선으로 선택한다. 그 이름이 별도 공식·통용명 후보와 정확히 일치하는지로 상태를 분류하고, 어느 근거도 없으면 `TRANSLATED` 참고 표기와 정발 `UNKNOWN`을 유지한다. 나무위키 이름이 없거나 여러 이름이 충돌할 때는 기존 공식·통용명·참고 번역 선택으로 돌아간다. 검색·모델 호출과 링크 검증 조건은 변경하지 않는다.
- 이름 선택 이후 최종 단일 후보는 기존 국립중앙도서관 실조회 Provider로 해당 한국어 제목을 최대 1회 검색한다(`TITLE`, 1페이지, 10건). `NL_API_MODE=live`와 유효한 `NL_API_KEY` 설정이 필요하고 모의 데이터는 사용하지 않는다. 기존 Provider의 응답 검증·프로세스 캐시를 재사용한다. 먼저 유효 ISBN·만화 분류·출판사·작가 비충돌 자료의 시리즈명 또는 권수를 분리한 실제 표제를 이름 후보로 모은다. 최우선 나무위키 이름이 없으면 완전 일치를 우선하고, 없으면 90% 이상인 유일한 실제 표제로 한국어 이름을 교정한다. 검증된 나무위키 이름이 있으면 이름을 잠그고 정확히 같은 도서 표제만 사용한다. 이름 선택 후에는 해당 실제 표제와 ISBN을 정확히 대조하고, 서로 다른 작가·출판사의 동명 자료가 없을 때만 `koreanTitleStatus=OFFICIAL`로 확증한다. 90% 비교는 이름 선택에만 사용하며 ISBN·상품·문서 링크 대조를 느슨하게 하지 않는다. 일본 원제·이미지 confidence·publicationStatus는 이 조회만으로 변경하지 않는다. 등록 ISBN은 출간 완료 근거가 아니다. 모드·설정·자료 부족, 조회 실패, timeout은 기존 후보를 유지하고 자동 재시도하지 않는다.
- 나무위키 최우선 이름이 없을 때 한국어 이름을 찾는 단계에서만 완전 일치를 우선하고, 없으면 기존 공식·통용명 근거 후보 중 유사도 0.9 이상인 유일한 표기를 채택한다. 이름 유사도는 NFKC·소문자화·공백/문장부호/기호 제거 후 NFD로 분해한 자모의 최장 공통 부분 수열 길이를 사용하며 `2 * LCS / (양쪽 자모 길이의 합)`으로 계산한다. 0.9를 포함하고, 서로 다른 후보가 여러 개면 자동 교정하지 않는다. 이 함수와 임계값은 YES24 상품 대조·나무위키 링크 검증에 사용하지 않는다. 특정 조사·단어·작품명 치환은 하지 않는다. 공통 부분 수열 계산은 제목당 최대 1,000 코드포인트로 제한한다.
- 기존 일본 작품 판정 응답의 선택적 내부 필드 `koreanSearchTranslation`에 검색용 한국어 직역을 받는다. 별도 번역 호출은 추가하지 않는다. 유효한 직역이 있으면 한국 검색은 직역으로 먼저 실행하고 근거가 부족하면 일본 원제로 조회한다. 번역이 없거나 유효하지 않으면 기존 검색 경로를 유지하며 한국 검색 최대 2회와 기존 조건부 역검색 예산은 늘리지 않는다.
- 일본 인명·성씨·지명은 한국 한자음이나 글자 뜻으로 옮기지 않고 제공된 독음 근거로 표기한다. 독음이 불명확하면 검색용 번역을 null로 두고 원제 검색을 사용한다. 같은 원제에 연결된 한국 검색 자료의 인명 표기를 모델이 교정한 경우, 초기 참고 번역으로 다시 덮어쓰지 않는다. 단일 사용 근거만으로 COMMON을 부여하지 않는다.
- 검색용 직역은 공식·통용명 근거가 아니다. 번역 우선 경로의 공식·통용명 분류에는 일본 원제 연결이 확인된 검색 결과만 사용한다. 근거가 없으면 직역은 `TRANSLATED`, 정발은 `UNKNOWN`으로 표시한다. 한국어 제목에 일본어 원문을 그대로 반환하지 않는다. 검색용 번역 필드는 공개 후보 응답에 노출하지 않는다.
- 한국어 표기가 직역과 달라도 일본 원제가 정확히 일치하면 동일 작품의 표기 후보로 연결한다. 기존 나무위키 검색 결과에서 안전한 작품 문서 URL·문서 제목·전체 일본 원제를 함께 확인하고, 한국어 문서명은 기존 두 번째 검색의 단서와 내부 `koreanVerifiedAliases`로 전달한다. 원제가 확인되면 요약의 장르 단어 누락이나 LOW 신뢰도만으로 링크를 배제하지 않는다. 유일한 검증 문서명은 이름 선택에서 최우선이지만, 별도의 공식·통용명 근거 없이 해당 상태나 정발을 확정하지 않는다. 부분 제목·후속작·다른 매체 문서는 동일 원제로 간주하지 않는다. 추가 페이지 수집 호출은 하지 않는다.
- 나무위키의 전체 원제 확인은 기존 일본 문자 구간에 더해 인용된 전체 제목과 영문·숫자·기호 구간도 정확히 대조한다. URL·문서명·매체 구분자 검증은 유지하고, 부분 문자열이나 90% 유사도로 문서 링크를 허용하지 않는다.
- YES24 조회는 한국어 검색 제목과 식별된 일본 원제가 있는 경우 LOW·정발 UNKNOWN·TRANSLATED 상태여도 기존 최대 1회 수행할 수 있다. 도서관에서 확증한 ISBN이 있으면 제목 대신 그 ISBN으로 기존 1회 조회를 수행한다. 저신뢰 상품은 한국어 제목·일본 원제·확증 ISBN 중 하나의 정확한 일치를 요구한다. 한국어 제목 전체가 상품명의 앞부분에서 일치하고 뒤에 영문·숫자 병기만 남는 경우도 완전 제목 일치로 인정해 상품명 전체의 길이 차이로 거부하지 않는다. 다른 한국어 접미 제목이나 guide/fanbook/artbook/novel 표기는 이 포함 일치 규칙의 대상이 아니다. 공백으로 분리된 말미 숫자와 권·巻 등의 권수 표시는 비교에서 분리하되 제목 자체의 숫자는 보존한다. 원제는 문자 종류로 제한하지 않고 영문·숫자·기호를 포함해 권수 분리 후 정확히 대조한다. 동일 ISBN 또는 원제가 확인되면 상품명의 길이 점수로 다시 거부하지 않는다. 상품에 다른 ISBN이나 원제가 명시돼 있으면 배제하고 작가 대조를 유지한다. 일본어판·직수입과 제공 ISBN 체크섬 오류를 배제한다. 조회 성공만으로 이미지 신뢰도를 올리거나 선택한 한국어 이름에 영문 병기를 붙이지 않는다. 이 규칙은 한국어 이름 찾기의 90% 유사도와 별개다. 나무위키 URL은 ISBN으로 생성하거나 추측하지 않고 기존 검색의 안전한 작품 문서 검증만 사용한다.
- 기존 검색 결과에 안전한 YES24 상품 URL과 전체 원제 근거가 있으면 추가 조회 없이 재사용한다. 최우선 나무위키 이름이 없을 때 한국어판 근거와 원제가 확인된 상품의 실제 출판명은 직역과 조금 달라도 최종 OFFICIAL 제목으로 채택하며, 권수·세트 표시를 작품명과 분리한다. 최종 상품 보강 뒤에도 같은 원제로 검증된 유일한 나무위키 이름이 있으면 그 이름과 해당 표기의 기존 상태를 유지하고 상품 정보·별도 정발 근거를 보존한다. 기존 나무위키 자료의 링크 검증은 그대로 수행한다. 단순히 검색 제목이 비슷하다는 이유로 공식명을 생성하지 않는다.
- 나무위키의 명시적 넘겨주기 검색 결과는 원제·만화 문맥·제목을 함께 검증해 기존 별칭 URL을 보존한다. 목적 URL을 추측하거나 리다이렉트 확인 요청을 추가하지 않는다. 개발 로그에는 교정 여부·선택 상태·상품 제외 사유·requestId별 최종 링크 개수만 기록하고 OCR 원문·검색 본문·전체 URL 목록은 기록하지 않는다.

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
- 비용 절감을 위해 성공한 OCR/refinement, Lens, Tavily, Foundry의 구조화된 결과만 process-memory TTL cache에 임시 보관할 수 있다. 키는 전처리 이미지, query 또는 prompt의 SHA-256이며 원본 이미지와 API 키는 캐시하지 않는다.
- `MANGAFIND_RESEARCH_CACHE_TTL_MS` 기본값은 600000ms, 최대값은 3600000ms, 0은 비활성화다. provider별 최대 128개 항목이며 오류 응답은 캐시하지 않는다.
- 캐시 URL에서 userinfo 및 인증성 query parameter를 제거한다. cache는 프로세스 메모리 전용으로 재시작 시 삭제되고 Container Apps replica 간 공유되지 않는다.
- 비정상 프로세스 종료까지의 완전한 메모리 삭제는 보장 대상이 아니므로 컨테이너 메모리·재시작 모니터링을 둔다.
- 이미지 본문과 검색 원문은 로그·메트릭에 기록하지 않는다.

### 7.3 Secret

- Azure Foundry API Key는 Azure Key Vault에 저장한다.
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
| 선택 한국어 이름의 ISBN 도서 확인 | 4초 (전체 예산 내) |
| 검증·응답·네트워크 여유 | 12초 |
| 전체 | 60초 |

각 단계 timeout은 모델 호출과 네트워크 왕복을 포함한다. 서버 자동 재시도는 없다.

ISBN 이름 확인은 기존 60초 전체 예산을 늘리지 않는다. YES24의 기존 최대 8초 조회 여유를 제외한 남은 시간과 4초 중 작은 값으로 제한하고, 여유가 없으면 호출하지 않는다. 기존 Tavily·Lens·Foundry 호출 수는 유지하고 국립중앙도서관 조회만 최종 단일 후보에 최대 1회 추가한다. 확인 ISBN은 요청 내부에서만 상품 조회에 넘기며 공개 응답 스키마·URL·새 저장소를 추가하지 않는다.

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

정상 요청의 기본 호출 수는 Azure Foundry 1회다. 다음 값을 계측한다.

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

Azure Foundry와 Search를 mock한다.

- ①→② 모두 성공
- ① `INSUFFICIENT` → ② `SKIPPED` → `INSUFFICIENT`
- ① `FAILED`·`TIMEOUT` → ② `SKIPPED` → `FAILED`
- ② timeout·검증 실패 → `FAILED`
- 1회 Foundry 호출 상한 확인
- 이미지 검증 실패 → HTTP 400
- APIM 429 응답 매핑

### 11.3 E2E 테스트

- 모바일 1장·3장 업로드
- 정상 결과와 부분 성공 결과
- `UNKNOWN` 한국 정보 표시
- 60초 timeout 안내
- 브라우저 번들에 Foundry Key 없음

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
- 이미지가 빌드될 때 Foundry API 호출이나 Key Vault 접근을 수행하지 않음

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
- Azure Foundry Key Vault Secret 이름과 Managed Identity 권한 대상
- 애플리케이션이 받는 환경변수 이름
- APIM backend와 공개 API 경로
- infra 출력값과 서비스 간 참조 방식

코드 변경은 이미지 재빌드·Container App revision 갱신으로 반영하고, 인프라 변경은 Bicep 변경으로 반영한다. Secret 값은 `azure.yaml`, Dockerfile, 소스 코드, `.env.example`에 기록하지 않는다.

## 13. 환경변수 계약

`.env.example`에는 값이 아닌 이름과 설명만 둔다.

```text
AZURE_FOUNDRY_ENDPOINT
AZURE_FOUNDRY_API_KEY
AZURE_FOUNDRY_MODEL
YES24_API_KEY
AZURE_FOUNDRY_STAGE_TIMEOUT_MS=12000
AI_TOTAL_TIMEOUT_MS=60000
AI_INTER_CALL_DELAY_MS=5000
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
