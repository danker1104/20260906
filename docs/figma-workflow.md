# MangaFind Figma Workflow

이 문서는 MangaFind 디자인 작업에서 Figma MCP를 연결하고 사용하는 절차를 정의한다. 제품 UI 요구사항과 상태 명세는 `DESIGN.md`를 기준으로 한다.

## 1. 작업 순서

```text
DESIGN.md 확인
→ Figma 파일의 기존 Variables·Components 확인
→ Website/PWA 화면 범위 확인
→ Foundations·Components 제작
→ 화면 Prototype 연결
→ 디자인 검토
→ Figma Context를 읽어 Next.js 구현
```

전체 화면을 한 번에 생성하지 않는다. 먼저 색상·타이포그래피·간격·버튼·배지·업로드·결과 상태를 확정한다.

## 2. Remote MCP

Figma Remote MCP 사용이 가능한 환경에서는 공식 Remote Endpoint를 사용한다.

```text
https://mcp.figma.com/mcp
```

연결 전 Figma 계정과 프로젝트 접근 권한을 확인한다. MCP 설정과 인증 정보에는 Secret을 포함하지 않는다.

## 3. VS Code 설정 예시

VS Code의 MCP 사용자 설정에 다음 서버를 등록할 수 있다.

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

설정 후 인증과 권한 승인 상태를 확인하고, 선택한 Figma Frame 또는 Layer의 Context만 읽는다.

## 4. MCP 작업 지시 순서

Agent에게 다음 정보를 확인시킨다.

1. `DESIGN.md`의 Website/PWA 구분
2. V1 필수·선택 정보 범위
3. `PARTIAL_SUCCESS`, `UNKNOWN`, `TRANSLATED` 상태
4. 출처 목록을 표시하지 않는 V1 정책
5. Mobile 0~767px, Tablet 768~1023px, Desktop 1024px 이상 breakpoint
6. 접근성·Safe Area·reduced motion 기준
7. Figma Variables·Auto Layout·Component 상태

## 5. 구현 전 검토

- 업로드 오류 상태가 모두 디자인되어 있는가
- 실제 백엔드 단계와 분석 화면이 일치하는가
- 숫자형 확률과 사용자 출처 링크가 남아 있지 않은가
- 부분 성공과 한국어 제목 `UNKNOWN` 상태가 표시되는가
- 긴 제목과 후보 목록이 모바일에서 깨지지 않는가
- 키보드 focus와 아이콘 label이 정의되어 있는가
- 결과 새로고침 시 홈으로 복구되는가

## 6. Figma Desktop MCP

Remote MCP를 사용할 수 없는 환경에서만 Figma Desktop MCP를 보조적으로 검토한다. Local Endpoint와 설정 방식은 사용하는 Figma·VS Code 버전에 맞는 공식 문서를 확인한 뒤 적용한다.
