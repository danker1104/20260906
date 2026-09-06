# MangaFind Design Specification

## 1. 문서 목적

본 문서는 MangaFind의 전체 UI/UX 디자인 방향과 디자인 시스템, Figma 제작 기준, Figma MCP 사용 방법, 반응형 웹 디자인 및 PWA 설치 후 앱 인터페이스를 정의한다.

이 문서는 다음 과정에서 공통 기준으로 사용한다.

```text
DESIGN.md
    ↓
Figma MCP
    ↓
Figma Design
    ↓
디자인 검토
    ↓
Next.js 구현
    ↓
PWA
    ↓
Docker
    ↓
Azure Container Apps
```

MangaFind는 단순한 홍보용 웹사이트가 아니다.

사용자가 처음 접속했을 때는 **서비스를 소개하는 웹사이트**처럼 보여야 하지만, PWA로 설치한 이후에는 **이미지 검색에 집중하는 모바일 앱**처럼 동작해야 한다.

따라서 디자인은 크게 다음 두 가지 Experience로 구분한다.

```text
1. Website Experience
   → 처음 방문한 사용자

2. PWA App Experience
   → 설치 후 반복적으로 사용하는 사용자
```

---

# 2. 프로젝트 개요

## 서비스명

**MangaFind**

## 서비스 정의

SNS에서 발견한 일본 만화의 캡처 이미지를 업로드하면 AI가 이미지 속 일본어, 대사, 등장인물, 작품 로고 등의 단서를 분석하고 웹 검색을 통해 작품을 식별하는 AI Manga Search 서비스.

검색 결과에서는 다음 정보를 제공한다.

* 한국어 제목
* 일본 원제
* 한국어 제목 유형
* 작가
* 한국 정발 여부
* 작품 식별 판정 수준
* 작품 판별 근거
* 다른 후보 작품

장르, 일본 출판사, 연재처, 연재 상태, 작품 표지와 한국 출판사는 확인된 경우에만 선택적으로 표시한다. V1에서는 검색 출처 URL이나 출처 목록을 사용자에게 표시하지 않는다.

---

# 3. 핵심 디자인 목표

MangaFind 디자인에서는 다음 목표를 우선한다.

## 3.1 빠른 검색

사용자가 MangaFind를 사용하는 핵심 목적은 매우 단순하다.

> SNS에서 본 만화가 무엇인지 알고 싶다.

따라서 앱 실행 후 가장 빠르게 접근할 수 있는 기능은 항상 이미지 업로드여야 한다.

```text
MangaFind 실행
      ↓
스크린샷 선택
      ↓
검색
```

불필요한 메뉴나 단계는 최소화한다.

---

## 3.2 모바일 우선

MangaFind의 주요 사용 상황은 다음과 같다.

```text
Instagram Reels
YouTube Shorts
X
SNS
    ↓
만화 발견
    ↓
Screenshot
    ↓
MangaFind
```

따라서 Desktop보다 Mobile UX를 우선한다.

우선순위:

```text
Mobile
↓
Tablet
↓
Desktop
```

---

# 4. Website와 PWA App 디자인 구분

MangaFind는 접속 방식에 따라 디자인 목적이 달라진다.

## Website

사용자가 브라우저에서 처음 MangaFind에 접근했을 때.

목적:

* MangaFind가 무엇인지 설명
* 실제 검색 기능 체험
* 서비스 신뢰 형성
* PWA 설치 유도

따라서 일반적인 Modern Tech Website 구조를 사용한다.

---

## PWA App

사용자가 MangaFind를 홈 화면에 설치하고 실행했을 때.

목적:

* 바로 이미지 선택
* AI 검색
* 결과 확인
* 다시 검색

따라서 Landing Page 요소 대부분을 제거하고 **앱 중심 UI**로 변경한다.

---

# 5. 전체 디자인 레퍼런스

디자인 레퍼런스는 그대로 복제하지 않는다.

각 레퍼런스에서 특정 요소만 가져와 MangaFind만의 디자인 시스템으로 재해석한다.

---

# 6. Reference 01 — Modern Heros

Figma Reference:

https://www.figma.com/design/D6WBUo6VTpLjLHrKOPw4g5/35-Modern-Heros-with-Gradients-and-Mockups--Community-?node-id=19-4007

## 참고 요소

* Hero Composition
* Large Typography
* Gradient
* Floating Mockups
* Strong Visual Hierarchy
* CTA 구성

## MangaFind 적용

주로 Website Landing Page의 Hero 영역에 활용한다.

예:

```text
                         Result Card
                              /
                             /

이 만화,                  Screenshot
뭐였지?                       Card

SNS에서 발견한
일본 만화를
캡처 한 장으로 찾아보세요.

[ 캡처 업로드 ]
```

---

# 7. Reference 02 — Piper

Figma Reference:

https://www.figma.com/design/DiLVb0WT168upXXd0WVKTT/piper-%7C-Tech-Company-Website--Preview---Community-?node-id=12119-61745&p=f

## 참고 요소

* Tech / SaaS Layout
* Typography
* Grid
* Spacing
* Card Composition
* Section Hierarchy
* Information Architecture

## MangaFind 적용

전체 홈페이지 구조를 결정하는 가장 중요한 레퍼런스로 사용한다.

---

# 8. Reference 03 — Razer

Website:

https://www.razer.com/kr-kr

## 참고 요소

* Dark Background
* High Contrast
* Premium Tech Feeling
* Large Visual
* Interaction
* Smooth Transition
* Strong Product Presentation

## 사용하지 않을 요소

Razer 자체 브랜드 스타일을 복제하지 않는다.

특히 다음 요소는 사용하지 않는다.

```text
Razer Green
Gaming Neon
Gaming Hardware aesthetic
Razer UI cloning
```

참고하는 것은 **색상이 아니라 완성도와 대비 방식**이다.

---

# 9. Reference 비중

전체 디자인은 다음 정도의 비중으로 해석한다.

```text
Piper
50%

Modern Heros
30%

Razer
20%
```

정리하면:

```text
전체 Layout
→ Piper

Hero / Gradient / Mockup
→ Modern Heros

Dark / Contrast / Interaction
→ Razer
```

---

# 10. Visual Direction

MangaFind의 핵심 디자인 키워드는 다음과 같다.

```text
Modern
AI
Manga
Search
Minimal
Premium
Dark
Fast
Visual
Clean
```

전통적인 만화 사이트가 아니라 **현대적인 AI Search Product**처럼 보여야 한다.

---

# 11. Color Direction

기본 Theme는 Dark.

## Background

완전한 Black만 반복적으로 사용하지 않는다.

여러 단계의 Dark Surface를 사용한다.

예:

```text
Background Base
#0A0A0C

Surface 01
#111116

Surface 02
#18181F

Elevated
#202028
```

정확한 Color Token은 Figma 디자인 과정에서 조정한다.

---

# 12. Accent Color

Razer Green 대신 다음 계열을 사용한다.

```text
Violet
Indigo
Blue
```

주요 Gradient 방향:

```text
Violet
   ↓
Indigo
   ↓
Blue
```

Accent는 제한적으로 사용한다.

사용 대상:

* Primary CTA
* Selected State
* AI Analysis
* Progress
* Focus
* Important Badge
* Confidence Indicator

---

# 13. Gradient 원칙

Gradient를 서비스 전체에 과도하게 사용하지 않는다.

주 사용 위치:

* Hero Background
* Primary CTA 일부
* AI 분석 Effect
* 결과 Highlight
* Loading Animation

Card 전체를 Gradient로 덮는 방식은 피한다.

---

# 14. Typography

한국어 / 일본어 / 영어가 동시에 자연스럽게 보여야 한다.

폰트는 다국어 가독성을 가장 우선한다.

Typography Hierarchy:

```text
Display
Hero Message

H1
Manga Korean Title

H2
Section Title

H3
Card Heading

Body
Description

Caption
Original Japanese Title
Source
Metadata
```

---

# 15. Manga Title 우선순위

검색 결과에서는 한국 사용자가 가장 궁금해할 정보를 먼저 보여준다.

```text
한국어 제목
      ↓
일본 원제
      ↓
제목 유형
```

예:

```text
향기로운 꽃은 늠름하게 핀다

薫る花は凛と咲く

[정식 제목]
```

또는

```text
별 아래의 그녀

星の下の彼女

[국내 통용명]
```

---

# 16. 한국어 제목 Badge

한국어 제목의 종류는 반드시 UI에서 구분한다.

### OFFICIAL

```text
정식 제목
```

한국 공식 출판 또는 라이선스 제목.

### COMMON

```text
국내 통용명
```

정식 출판은 없지만 한국 인터넷에서 널리 사용되는 이름.

### TRANSLATED

```text
AI 번역
```

확인 가능한 국내 이름이 없어 AI가 원제를 번역한 이름.

색상만으로 구분하지 않고 반드시 Text Label을 같이 사용한다.

---

# 17. Website 정보 구조

브라우저에서 접근하는 홈페이지는 다음 구조를 기본으로 한다.

```text
Navigation
     ↓
Hero
     ↓
Main Upload
     ↓
How It Works
     ↓
Example Result
     ↓
PWA Install
     ↓
Footer
```

---

# 18. Website Navigation

Desktop:

```text
MangaFind

찾기
서비스 소개
사용 방법

                           앱 설치
```

Navigation 항목은 최소한으로 유지한다.

---

# 19. Website Hero

대표 메시지:

```text
이 만화,
뭐였지?
```

Subtext:

```text
SNS에서 발견한 일본 만화를
캡처 한 장으로 찾아보세요.
```

Primary CTA:

```text
캡처 업로드
```

Secondary CTA:

```text
어떻게 찾나요?
```

---

# 20. Hero Visual

단순 만화 이미지를 넣지 않는다.

서비스의 기능을 보여주는 Mockup을 사용한다.

```text
Screenshot
     ↓
AI Scan
     ↓
Manga Result
```

화면 주변에 다음 UI를 Floating 형태로 배치할 수 있다.

```text
Screenshot Card

AI Analysis Card

Manga Result Card
```

---

# 21. Main Upload

MangaFind에서 가장 중요한 Component.

Desktop에서는 Drag & Drop 지원.

```text
┌──────────────────────────────┐
│                              │
│       캡처를 올려주세요      │
│                              │
│ Drag & Drop 또는 파일 선택   │
│                              │
│         최대 3장             │
│                              │
└──────────────────────────────┘
```

업로드 제한:

- JPG, JPEG, PNG, WebP
- 파일당 최대 10MB
- 가로·세로 각각 최대 8192px
- 이미지 1장당 최대 64MP
- 최대 3장

업로드 상태:

```text
기본 / 파일 선택됨 / 분석 가능 / 업로드 중
지원하지 않는 형식 / 파일 크기 초과 / 해상도 초과
손상된 이미지 / 최대 장수 초과
```

오류 메시지는 원인과 다음 행동을 함께 표시한다.

```text
이 이미지는 10MB를 초과했어요.
더 작은 이미지를 선택해 주세요.
```

---

# 22. Mobile Upload

모바일에서는 Drag & Drop을 강조하지 않는다.

```text
캡처를 올려주세요

      [ + ]

사진 선택

PNG · JPG · WebP
최대 3장

[ 만화 찾기 ]
```

---

# 23. Multi Screenshot

최대 3장을 업로드한다.

```text
┌──────┐ ┌──────┐ ┌──────┐
│ IMG1 │ │ IMG2 │ │  +   │
└──────┘ └──────┘ └──────┘
```

각 이미지에는 제거 버튼을 제공한다.

유효하지 않은 이미지에는 오류 상태를 표시하고 분석 시작 버튼을 비활성화한다. 유효한 이미지로 교체하면 다시 분석할 수 있어야 한다.

안내:

```text
여러 장을 올리면 더 많은 단서를 분석할 수 있어요.
```

---

# 24. How It Works

Landing Page에서는 AI가 어떻게 동작하는지 아주 간단하게 설명한다.

```text
01
캡처

↓

02
AI 분석

↓

03
웹 검색

↓

04
작품 확인
```

사용자가 AI가 단순히 추측하는 것이 아니라 실제 검색과 검증을 사용한다는 것을 이해할 수 있게 한다.

---

# 25. AI Analysis Screen

검색 버튼을 누른 이후 단순 Spinner만 보여주지 않는다.

현재 진행 중인 과정을 보여준다.

```text
AI가 만화를 찾고 있어요.

● 이미지 단서 분석

○ 일본 작품 검색

○ 한국 정보 검색

○ 최종 결과 정리
```

표시 단계는 실제 백엔드 파이프라인과 일치해야 한다. 근거 없는 퍼센트나 완료 표시를 사용하지 않는다.

---

# 26. Search Result

검색 결과의 정보 우선순위:

```text
한국어 제목

일본 원제

Title Badge

작가

한국 정발 여부

판정 수준

Evidence

Alternative Candidates
```

표지, 장르, 출판사, 연재처, 연재 상태는 확인된 경우에만 결과 상세 영역에 표시한다. V1 화면에는 검색 출처 목록이나 외부 링크를 표시하지 않는다.

---

# 27. Main Result Card

예:

```text
┌───────────────────────────┐

향기로운 꽃은 늠름하게 핀다

薫る花は凛と咲く

[ 정식 제목 ]

미카미 사카

Romance · School

작품 식별 판정 수준

높음

└───────────────────────────┘
```

---

# 28. 작품 정보

정보를 일본과 한국으로 구분한다.

```text
일본

출판사
연재처
연재 상태
```

```text
한국

정발 여부
한국 출판사
한국어 제목 상태
```

Desktop에서는 2 Column.

Mobile에서는 Vertical Stack.

---

# 29. Confidence

예:

```text
작품 식별 판정 수준

높음

정확한 확률이 아닌 검색 근거의 충분함을 나타냅니다.
```

Confidence는 AI의 절대 확률처럼 표현하지 않는다.

사용자가 이해하기 쉬운 **검색 결과 신뢰 지표**로 표현한다.

---

# 30. Evidence

Confidence와 함께 판별 근거를 제공한다.

```text
확인된 단서

✓ 이미지 속 대사 일치

✓ 등장인물 이름 일치

✓ 작품 정보 일치
```

---

# 31. Alternative Candidate

결과를 무조건 하나로 확정하지 않는다.

```text
다른 후보

#2

작품명
판정 수준 중간

#3

작품명
판정 수준 낮음
```

Main Candidate보다 Visual Priority를 낮춘다.

---

# 32. Internal Evidence Policy

검색 결과의 출처와 인용 정보는 서버에서 최종 판정과 운영 분석에만 사용한다.

V1 결과 화면에는 출처 URL, 출처 목록, 외부 링크를 표시하지 않는다. 출처를 충분히 확인하지 못한 정보는 공식 정보처럼 표시하지 않고 `확인 불충분` 상태로 보여준다.

---

# 33. Search Failure

작품을 찾지 못했을 경우:

```text
작품을 확실하게 찾지 못했어요.

다른 장면이나
대사가 포함된 캡처를 추가하면
더 정확하게 찾을 수 있습니다.

[ 이미지 추가 ]

[ 다시 검색 ]
```

한국 정보 검색만 실패한 경우에는 일본 작품 결과를 숨기지 않고 부분 성공 상태로 표시한다.

```text
일본 작품은 찾았어요.

한국 정보 조사가 완료되지 않았습니다.

한국어 제목
확인 불충분

한국 정발 여부
확인 불충분
```

---

# 34. Low Confidence

판정 수준이 낮으면 확정적 표현을 피한다.

```text
가능성이 높은 작품

○○○○

판정 수준이 낮습니다.

다른 캡처를 추가하면
더 정확한 결과를 얻을 수 있습니다.
```

---

# 35. Website PWA Install Section

홈페이지에서는 PWA 설치 기능을 적극적으로 알려준다.

```text
MangaFind를 앱처럼 사용하세요.

홈 화면에 추가하면
SNS에서 만화를 발견했을 때
바로 MangaFind를 실행할 수 있습니다.

[ 앱 설치 ]
```

Phone Mockup과 함께 보여줄 수 있다.

---

# 36. PWA App Experience

PWA로 설치된 MangaFind는 홈페이지와 동일하게 구성하지 않는다.

웹사이트는 다음 목적을 가진다.

```text
서비스 소개
+
기능 체험
+
설치 유도
```

PWA는 다음 목적만 가진다.

```text
검색
+
결과 확인
```

따라서 PWA 실행 시 Hero, How It Works, Example Result, Install 설명, Footer 등은 기본 화면에서 제거한다.

---

# 37. PWA App Home

PWA를 실행했을 때의 첫 화면.

```text
┌─────────────────────────┐

MangaFind             ⚙

어떤 만화를
찾아볼까요?

┌─────────────────────┐
│                     │
│       +             │
│                     │
│  캡처 선택          │
│                     │
└─────────────────────┘

PNG · JPG · WebP
최대 3장

[ 만화 찾기 ]

└─────────────────────────┘
```

앱 실행 후 업로드까지 Scroll이 필요하지 않아야 한다.

---

# 38. PWA Navigation

V1에서는 기능이 적기 때문에 복잡한 Bottom Navigation을 만들지 않는다.

초기 권장:

```text
Home / Search

Settings 또는 Info
```

검색 기록 기능이 V2에서 추가되면:

```text
찾기

기록

저장
```

형태로 확장한다.

---

# 39. PWA Header

Standalone 환경에서는 브라우저 Navigation이 사라질 수 있기 때문에 자체 Header가 필요하다.

기본 구조:

```text
←

MangaFind

⋯
```

Home에서는 Back 버튼이 필요하지 않다.

Result / Detail 화면에서는 명확한 Back Action을 제공한다.

---

# 40. PWA Search Flow

설치 앱의 핵심 UX:

```text
PWA 실행
     ↓
캡처 선택
     ↓
Preview
     ↓
만화 찾기
     ↓
AI Analysis
     ↓
Search Result
```

가능한 한 한 방향 Flow로 만든다.

---

# 41. PWA Image Selection

스마트폰 사용자가 방금 찍은 Screenshot을 바로 선택하기 편하게 한다.

Upload Button은 최소한 다음 정도의 Touch Target을 확보한다.

```text
큰 Primary Action
+
명확한 Icon
+
명확한 Label
```

Icon만 있는 작은 버튼은 주요 업로드 Action에 사용하지 않는다.

---

# 42. PWA Screenshot Preview

```text
찾을 이미지

┌──────┐
│ IMG1 │ ×
└──────┘

┌──────┐
│ IMG2 │ ×
└──────┘

[ + 이미지 추가 ]

[ 만화 찾기 ]
```

Screen width에 따라 Horizontal 또는 Grid로 구성한다.

---

# 43. PWA Analysis

Full Screen에 가까운 집중형 UI.

```text
      AI Animation

AI가 만화를 찾고 있어요

이미지를 분석하고 있습니다.

● ● ●

이미지 단서 분석
일본 작품 검색
한국 정보 검색
최종 결과 정리
```

불필요한 Navigation은 Analysis 중 최소화한다.

---

# 44. PWA Result

웹사이트 Result보다 더 Compact하게 표현한다.

```text
← 결과

[ Cover ]

한국어 작품명

日本語タイトル

[국내 통용명]

작가

정발 X


판정 수준 높음


확인된 단서

✓ 대사 일치
✓ 캐릭터 일치


[ 작품 정보 보기 ]


다른 후보
```

한국 정보가 없는 후보는 다음처럼 표시한다.

```text
한국어 제목
확인 불충분

한국 정발 여부
확인 불충분
```

---

# 45. PWA Detail

Result 화면에서 모든 Metadata를 한 번에 보여주지 않고 필요 시 상세 정보 화면으로 이동할 수 있다.

```text
Result
   ↓

작품 정보 보기
   ↓

Detail
```

Detail:

```text
Cover

Title

Author

Genre

Japan Publisher

Serialization

Korean Release

판단 근거
```

V1 결과 보존 정책:

- 결과는 현재 브라우저 세션에서만 유지한다.
- 결과를 서버나 DB에 저장하지 않는다.
- 결과 화면을 새로고침하거나 직접 재접속하면 결과를 복원하지 않고 검색 홈으로 안내한다.
- 결과 화면에는 `다시 검색`과 `홈으로` 복구 경로를 제공한다.
- V1에서는 결과 내용을 URL에 포함하지 않는다.

---

# 46. Safe Area

PWA는 스마트폰에서 실행되므로 Safe Area를 고려한다.

특히:

```text
iPhone Dynamic Island

Notch

Home Indicator

Android Gesture Navigation
```

Header와 Bottom Action이 시스템 UI에 가려지지 않도록 한다.

---

# 47. PWA Standalone 기준

PWA Standalone 상태에서는 Browser Address Bar가 없다.

따라서 다음 기능을 앱 자체 UI에서 명확히 제공해야 한다.

* Back
* Home
* Refresh / Retry
* Upload
* Search
* Error Recovery

---

# 48. PWA 설치 여부에 따른 화면

Web Browser:

```text
Hero
Upload
How It Works
Example
Install
Footer
```

Standalone PWA:

```text
App Header
Upload
Analysis
Result
```

가능하다면 앱에서 Display Mode를 감지하여 Landing 요소를 자동으로 숨긴다.

---

# 49. Responsive Design

기본적인 디자인 우선순위:

```text
Mobile
0~767px

Tablet
768~1023px

Desktop
1024px+
```

모바일 우선으로 설계하며, 모든 핵심 화면은 375px 폭에서 가로 스크롤 없이 동작해야 한다. 후보 카드·긴 일본어 제목·한국어 제목은 줄바꿈과 overflow를 처리한다.

고정 규칙:

- 업로드 preview는 고정 aspect ratio를 사용한다.
- 결과 카드와 버튼은 상태 변화에도 크기가 바뀌지 않는다.
- Desktop 결과는 2열, Mobile 결과는 세로 스택이다.
- Safe Area와 키보드 포커스가 콘텐츠를 가리지 않도록 한다.

---

# 50. Desktop

Desktop에서는 콘텐츠 공간을 활용한다.

Result 예:

```text
┌───────────┬─────────────────────────┐
│           │                         │
│   Cover   │ 한국어 제목             │
│           │ 일본 원제               │
│           │                         │
│           │ Author                  │
│           │ Genre                   │
│           │                         │
│           │ Confidence              │
│           │                         │
└───────────┴─────────────────────────┘
```

---

# 51. Animation

Animation은 기능 이해를 돕는 목적으로만 사용한다.

추천:

* Fade
* Slide
* Upload Preview
* Scanning
* Progress Transition
* Result Reveal
* Button Feedback
* Small Hover Motion

피해야 할 것:

* 과도한 Glow
* 지속적인 Background Motion
* Heavy 3D
* 정보 확인을 방해하는 Motion

---

# 52. Accessibility

반드시 고려:

* 충분한 Color Contrast
* Keyboard Navigation
* Focus State
* Touch Target
* Alt Text
* Text Label
* 적절한 Font Size
* 색상에만 의존하지 않는 상태 표시

구현 기준:

- 아이콘 전용 버튼에는 `aria-label`을 제공한다.
- 파일 입력과 모든 폼 컨트롤에는 명시적인 label을 제공한다.
- 이미지에는 의미에 맞는 `alt`를 제공하고 장식용 이미지는 빈 alt를 사용한다.
- 로딩·검증·오류 상태는 `aria-live="polite"` 영역으로 알린다.
- 모든 interactive element에 `:focus-visible` 기반의 명확한 focus 상태를 제공한다.
- 오류 발생 시 오류 메시지와 수정 방법을 함께 표시한다.
- Drag & Drop은 파일 선택 버튼과 키보드 조작으로 대체 가능해야 한다.
- `prefers-reduced-motion`이 활성화되면 스캔·전환 애니메이션을 줄이거나 끈다.
- 주요 업로드·검색 버튼은 아이콘만 사용하지 않고 text label을 포함한다.

---

# 53. Component Structure

Figma에서 다음 Components를 생성한다.

```text
Button

Icon Button

Badge

Navbar

App Header

Upload Zone

Upload Preview

Manga Card

Candidate Card

Progress

Confidence

Evidence Item

Info Row

Dialog

Toast

Error State

Empty State
```

V1에서는 사용자 출처 목록을 제공하지 않으므로 `Source Link` 컴포넌트는 구현 대상에서 제외한다. 내부 검색 근거는 `Evidence Item`으로만 표시한다.

---

# 54. Button Variants

```text
Primary

Secondary

Ghost

Danger

Disabled

Loading
```

---

# 55. Badge Variants

```text
Official

Common

Translated
```

---

# 56. Upload Variants

```text
Empty

Hover

Selected

Uploading

Error

Disabled
```

---

# 57. Result Variants

```text
High Confidence

Medium Confidence

Low Confidence

Partial Success

Korean Title Unknown

Translated Title

Not Found
```

상태 표시 규칙:

- `HIGH`, `MEDIUM`, `LOW`는 숫자 확률이 아닌 판정 수준으로 표시한다.
- `TRANSLATED`는 `AI 번역` 또는 `참고 제목` 라벨을 함께 표시한다.
- `UNKNOWN`은 `한국어 제목 확인 불충분`으로 표시한다.
- `PARTIAL_SUCCESS`는 일본 작품 정보는 표시하고 한국 정보에는 `확인 불충분`을 표시한다.

---

# 58. Figma Structure

Figma 파일은 다음 구조를 권장한다.

```text
00 Cover

01 Foundations

02 Components

03 Website

04 Mobile Web

05 PWA App

06 Prototype

07 Archive
```

---

# 59. Foundations

다음 디자인 Token을 관리한다.

```text
Colors

Typography

Spacing

Radius

Effects

Grid

Icons
```

---

# 60. Figma Frame 제작 대상

## Website

```text
Desktop Landing

Mobile Landing

Desktop Result

Mobile Result
```

## PWA

```text
App Home

Image Selected

AI Analysis

Search Result

Manga Detail

Candidate List

Low Confidence

Not Found
```

---

# 61. Figma Prototype Flow

최소한 다음 Flow를 Prototype으로 연결한다.

### Website

```text
Landing

→ Upload

→ Analysis

→ Result
```

### PWA

```text
App Home

→ Image Select

→ Preview

→ Search

→ Analysis

→ Result

→ Detail
```

---

# 62. Figma MCP 사용 목적

상세 연결·인증·작업 절차는 [docs/figma-workflow.md](docs/figma-workflow.md)로 분리한다. 이 문서에서는 Figma를 사용하는 제품 디자인 원칙과 검토 기준만 유지한다.

MangaFind 프로젝트에서는 Figma MCP를 단순히 디자인을 읽어오는 용도로만 사용하지 않는다.

다음 Workflow에 활용한다.

```text
DESIGN.md
      ↓
AI Agent
      ↓
Figma MCP
      ↓
Figma Canvas
      ↓
디자인 생성 / 수정
      ↓
Figma Design Context
      ↓
Next.js 구현
```

Figma MCP는 AI Agent가 Figma의 Components, Variables, Layout 등의 구조화된 디자인 정보를 읽을 수 있게 해주며, 지원되는 환경에서는 Figma Canvas에 직접 디자인을 생성하거나 수정하는 Workflow도 제공한다.

---

# 63. Figma MCP 연결 방식

Figma에서는 Remote MCP Server 사용을 우선한다.

Figma 공식 권장 Remote Endpoint:

```text
https://mcp.figma.com/mcp
```

Remote 방식은 별도의 Figma Desktop MCP Server를 계속 실행할 필요가 없으며, 현재 Figma가 일반적인 사용 사례에 권장하는 방식이다.

---

# 64. VS Code + Figma MCP 연결

VS Code를 사용하는 경우 Command Palette를 실행한다.

Windows:

```text
Ctrl + Shift + P
```

검색:

```text
MCP: Open User Configuration
```

`mcp.json`에 다음 서버를 등록한다.

```json
{
  "inputs": [],
  "servers": {
    "figma": {
      "url": "https://mcp.figma.com/mcp",
      "type": "http"
    }
  }
}
```

파일 저장 후 Figma MCP Server의 **Start**를 실행한다.

브라우저 인증 창이 열리면 MangaFind 디자인에 사용할 Figma 계정으로 로그인하고 권한을 승인한다.

연결 완료 후 VS Code의 AI Agent가 Figma MCP를 사용할 수 있다.

VS Code에서 Remote MCP를 설정하는 이 방식은 현재 Figma 공식 설정 방법이다.

---

# 65. Codex + Figma MCP

Codex를 디자인 또는 개발 Agent로 사용할 경우 Figma MCP를 연결하여 다음과 같은 Workflow를 구성할 수 있다.

```text
Codex
  ↕
Figma MCP
  ↕
MangaFind Figma
```

사용 목적:

```text
DESIGN.md 읽기

↓

MangaFind 디자인 생성

↓

Figma 디자인 분석

↓

Next.js Component 구현

↓

디자인과 코드 비교

↓

UI 수정
```

Codex에서도 Figma MCP를 지원하며, 연결된 디자인의 Context를 Agent가 활용할 수 있다.

---

# 66. Desktop MCP는 보조 방식

필요한 경우 Figma Desktop App의 Dev Mode에서 Desktop MCP Server를 사용할 수도 있다.

Local Endpoint:

```text
http://127.0.0.1:3845/mcp
```

다만 기본 MangaFind Workflow에서는 Remote MCP를 우선한다.

Desktop MCP는 특정 조직/Enterprise Workflow 등을 위한 용도로 제공되며 Figma 역시 일반적으로 Remote MCP 사용을 권장한다.

---

# 67. Figma MCP 사용 전 확인

MCP 연결 후 바로 전체 디자인을 만들도록 지시하지 않는다.

먼저 Agent에게 다음 내용을 확인시킨다.

```text
1. DESIGN.md 읽기

2. MangaFind 프로젝트 목적 이해

3. Reference URL 확인

4. Existing Figma Components 확인

5. Foundations 확인

6. Website / PWA 구분 확인

7. 디자인 생성
```

---

# 68. Figma MCP Reference 활용

Reference URL을 Agent에게 전달할 때 각각의 역할을 명확히 지정한다.

```text
Reference 01
Modern Heros

Use for:
Hero
Gradient
Mockup
Visual hierarchy
```

```text
Reference 02
Piper

Use for:
Layout
Grid
Card
Spacing
Typography
Section hierarchy
```

```text
Reference 03
Razer

Use for:
Dark mood
Contrast
Premium visual quality
Interaction inspiration
```

---

# 69. Reference 복제 금지

Figma MCP Agent에게 반드시 다음 원칙을 전달한다.

```text
Do not directly copy any reference design.

Do not reproduce proprietary branding.

Use references only as visual inspiration.

Create a unique MangaFind design system.
```

특히 Razer:

```text
Do not copy:

Razer green

Razer branding

Razer product layouts exactly

Gaming neon aesthetic
```

---

# 70. Figma MCP 작업 순서

전체 디자인을 한 번에 생성하는 것보다 다음 순서로 작업한다.

### Stage 1

```text
Foundations
```

* Color
* Typography
* Spacing
* Radius
* Grid

### Stage 2

```text
Core Components
```

* Button
* Badge
* Card
* Upload
* Header

### Stage 3

```text
Website Home
```

### Stage 4

```text
Website Result
```

### Stage 5

```text
PWA App Home
```

### Stage 6

```text
PWA Search Flow
```

### Stage 7

```text
Responsive Variant
```

### Stage 8

```text
Prototype
```

---

# 71. Figma MCP 첫 디자인 지시

첫 번째 Figma 생성 단계에서는 홈페이지부터 제작한다.

Agent가 우선 생성할 화면:

```text
Desktop Landing

Mobile Landing
```

그 다음:

```text
PWA App Home
```

을 별도 Frame으로 제작한다.

Website Mobile Landing과 PWA Home을 같은 디자인으로 만들지 않는다.

---

# 72. Website Mobile과 PWA 차이

### Mobile Website

```text
Logo

Hero

Description

Upload

How It Works

Example

Install

Footer
```

### Installed PWA

```text
App Header

Upload

Recent Action (V2)

Search
```

가장 큰 차이:

> 웹은 서비스를 설명하고, 앱은 서비스를 사용한다.

---

# 73. Figma MCP에서 디자인 구현 후 확인할 사항

Agent가 Frame을 생성한 뒤 다음 기준으로 다시 검토한다.

```text
Visual hierarchy

Spacing consistency

Mobile usability

Touch target

Typography

Contrast

Component reuse

Auto Layout

Responsive behavior

Website/PWA separation
```

---

# 74. Auto Layout

Figma MCP를 통해 생성되는 주요 화면과 Component는 가능한 한 Auto Layout을 사용한다.

고정 좌표 기반의 무분별한 배치는 피한다.

Component가 다양한 Width에서도 자연스럽게 동작하도록 한다.

---

# 75. Variables

가능하면 Figma Variables를 활용한다.

예:

```text
color/bg/base

color/bg/surface

color/text/primary

color/text/secondary

color/accent/primary

space/4

space/8

space/12

space/16

radius/sm

radius/md

radius/lg
```

이름은 실제 디자인 제작 과정에서 조정 가능하다.

---

# 76. Figma → Code

디자인 완료 후 MCP를 통해 디자인 Context를 읽고 Next.js 구현에 활용한다.

Workflow:

```text
Figma Frame 선택

↓

Copy Link to Selection

↓

AI Agent에 전달

↓

Figma MCP로 Context 읽기

↓

Components / Variables / Layout 분석

↓

Next.js + Tailwind 구현
```

Figma 공식 MCP Workflow 역시 선택한 Frame 또는 Layer의 링크를 기반으로 디자인 Context를 Agent에게 전달하는 방식을 지원한다.

---

# 77. 코드 구현 원칙

Figma에서 생성된 코드를 그대로 복사하는 것을 목표로 하지 않는다.

MCP에서 받아야 하는 핵심 정보:

```text
Layout

Spacing

Typography

Color

Component structure

Responsive behavior

Assets
```

이를 MangaFind 코드 구조에 맞춰 구현한다.

---

# 78. Website 구현 대상

```text
/

Landing Page

/api/identify와 연결되는 Upload

Result Flow
```

---

# 79. PWA 구현 대상

Standalone 상태에서는 App UI를 활성화한다.

Concept:

```text
display-mode: standalone
```

또는 브라우저 환경 정보를 활용하여 PWA 실행 여부를 판별한다.

설치형 UI와 Browser UI는 동일한 Backend를 사용하며 Frontend Experience만 다르게 제공한다.

---

# 80. 디자인에서 피해야 할 것

다음 디자인은 사용하지 않는다.

```text
Razer clone

Green neon gaming UI

Comic speech bubble 중심 UI

과도한 Manga decoration

과도한 Gradient

과도한 Glassmorphism

모든 요소 Card화

복잡한 Dashboard

과도한 Navigation

지나친 Animation

Desktop UI를 축소한 Mobile UI
```

---

# 81. MangaFind 브랜드 방향

MangaFind는 다음 조합을 표현한다.

```text
Manga

+

AI

+

Visual Search

+

Modern Technology
```

목표는 전통적인 만화 정보 사이트가 아니다.

다음과 같은 인상을 목표로 한다.

> 만화를 위한 Visual AI Search Engine

---

# 82. 최종 Website Flow

```text
Landing

↓

Upload

↓

Analysis

↓

Search Result

↓

Alternative Candidate

↓

PWA Install
```

---

# 83. 최종 PWA Flow

```text
App 실행

↓

Screenshot 선택

↓

Preview

↓

만화 찾기

↓

AI Analysis

↓

Result

↓

Detail 또는 다른 후보

↓

다시 찾기
```

---

# 84. 디자인 우선순위

디자인을 평가할 때 다음 순서로 판단한다.

```text
1.
사용자가 즉시 이미지 업로드 방법을 알 수 있는가?

2.
앱 실행 후 최소한의 조작으로 검색할 수 있는가?

3.
검색 결과 작품을 빠르게 이해할 수 있는가?

4.
한국어 제목 유형을 구별할 수 있는가?

5.
AI 검색 근거를 확인할 수 있는가?

6.
Website와 PWA 역할이 명확하게 구분되는가?

7.
Mobile에서 자연스럽게 사용할 수 있는가?

8.
Desktop에서도 완성도가 유지되는가?

9.
디자인 시스템이 일관적인가?

10.
MangaFind만의 브랜드 이미지가 존재하는가?
```

---

# 85. 최종 디자인 정의

MangaFind는 **Dark Theme 기반의 현대적인 Visual AI Search 서비스**로 디자인한다.

Website에서는 Piper의 구조적 안정성, Modern Heros의 Hero Composition과 Gradient, Razer의 높은 대비와 Premium Interaction을 참고한다.

그러나 Reference Design을 복제하지 않고 MangaFind만의 Visual System을 구축한다.

홈페이지는 사용자가 MangaFind를 처음 이해하고 검색을 체험하며 PWA 설치까지 이어지도록 설계한다.

PWA로 설치한 이후에는 Landing Page 형태를 제거하고 **검색 자체에 집중한 Native App 스타일의 인터페이스**를 제공한다.

궁극적인 목표는 사용자가 SNS에서 만화를 발견한 순간:

```text
Screenshot

↓

MangaFind 실행

↓

사진 선택

↓

검색

↓

작품 확인
```

이라는 흐름을 가장 빠르고 자연스럽게 수행할 수 있도록 만드는 것이다.
