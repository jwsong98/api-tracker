# Phase 0: HTML 시각화 생성 모듈

## 사전 준비

먼저 아래 문서들을 반드시 읽고 프로젝트의 전체 아키텍처와 설계 의도를 완전히 이해하라:

- `docs/prd.md` — 전체 제품 요구사항
- `docs/code-architecture.md` — 전체 아키텍처
- `docs/data-schema.md` — 파일 구조 및 데이터 포맷
- `docs/adr.md` — 기술 결정 사항 (특히 ADR-008: JSON 기본 출력)

그리고 아래 기존 코드를 반드시 읽어라:

- `src/types.ts` — GraphData, GraphNode, GraphEdge, Edge, EdgeRequest, EdgeResponse, SessionMeta, Bindings 타입 정의
- `src/storage/file-store.ts` — 파일 I/O 패턴 (readJson, writeJson, listDirs, getTrackerRoot)
- `src/core/session-manager.ts` — listSessions, getSession 함수 패턴
- `src/output/formatter.ts` — 기존 출력 포매터 패턴 참고

테스트 데이터 구조도 확인하라:

- `.test-recorder-48060/sessions/test-session/graph.json` — 노드/엣지 구조 예시
- `.test-recorder-48060/sessions/test-session/edges/001.json` — 엣지 상세 데이터 예시
- `.test-recorder-48060/sessions/test-session/edges/002.json` — 템플릿 참조 포함 예시
- `.test-recorder-48060/sessions/test-session/meta.json` — 세션 메타데이터 예시

## 작업 내용

### 1. `src/visualization/html-generator.ts` 생성

self-contained HTML 문자열을 생성하는 모듈이다. 브라우저에서 열면 vis.js 네트워크 그래프가 렌더링된다.

#### 데이터 수집 함수

```typescript
// 단일 세션의 시각화 데이터를 수집한다
export async function collectSessionData(sessionName: string): Promise<SessionVisualizationData>

// 전체 세션의 시각화 데이터를 수집한다
export async function collectAllSessionsData(): Promise<AllSessionsVisualizationData>
```

`collectSessionData`는:
1. `sessions/{name}/graph.json`을 읽어 GraphData를 가져온다
2. `sessions/{name}/edges/` 디렉토리의 모든 엣지 JSON 파일을 읽는다
3. `sessions/{name}/meta.json`을 읽어 세션 메타데이터를 가져온다
4. 이 세 가지를 묶어 반환한다

`collectAllSessionsData`는:
1. `listDirs("sessions")`로 모든 세션 이름을 가져온다
2. 각 세션에 대해 `collectSessionData`를 호출한다
3. `continueFrom` 관계를 분석하여 세션 간 연결 정보를 추가한다

#### HTML 생성 함수

```typescript
// 단일 세션용 HTML 생성
export function generateSessionHtml(data: SessionVisualizationData): string

// 전체 세션용 HTML 생성
export function generateAllSessionsHtml(data: AllSessionsVisualizationData): string
```

#### HTML 구조 요구사항

생성되는 HTML은 **단일 파일로 self-contained**여야 한다. 외부 의존성은 CDN 링크만 허용.

**레이아웃**:
- 좌측 70%: vis.js 네트워크 그래프
- 우측 30%: 엣지 클릭 시 request/response 상세 패널 (기본 상태: "엣지를 클릭하면 상세정보가 표시됩니다" 안내 텍스트)
- 상단: 세션 이름과 상태 표시 (--all 모드에서는 세션 범례)

**vis.js 설정**:
- CDN: `https://unpkg.com/vis-network@9.1.9/standalone/umd/vis-network.min.js`
- 방향 그래프: `edges.arrows.to.enabled = true`
- 계층 레이아웃: `layout.hierarchical` 사용, 위에서 아래로 (direction: "UD")
- 물리 시뮬레이션: 비활성화 (`physics: false`) — 계층 레이아웃이면 물리 불필요

**노드 스타일링** (라이트 테마):
- seed 노드: 회색 (#9E9E9E), 다이아몬드 shape
- POST 응답 노드: 초록 (#4CAF50), 박스 shape
- GET 응답 노드: 파란 (#2196F3), 박스 shape
- PUT/PATCH 응답 노드: 주황 (#FF9800), 박스 shape
- DELETE 응답 노드: 빨강 (#F44336), 박스 shape
- 기타: 기본 회색 (#607D8B), 박스 shape
- 노드 라벨에서 HTTP method 추출: `label.startsWith("POST")` 등으로 판단

**엣지 스타일링**:
- 기본 엣지: 검정 (#333333), 화살표 포함
- `--all` 모드에서 세션 간 `continueFrom` 연결: 점선 (dashes: true), 회색 (#999999)

**상세 패널 (우측)**:
- 엣지 클릭 이벤트 (`network.on("selectEdge", ...)`)로 해당 엣지의 상세 데이터를 표시
- 표시 항목:
  - Edge ID, From Node → To Node
  - Request: method, path (template과 resolved 둘 다), headers, body
  - Response: status, headers, body
  - Refs 목록 (있는 경우)
  - Warnings (있는 경우)
  - Auth profile (있는 경우)
  - Timestamp
- JSON body는 `JSON.stringify(body, null, 2)`로 포맷팅, `<pre>` 태그로 감싸기
- 노드 클릭 시에는 패널을 초기 상태("엣지를 클릭하세요")로 리셋

**`--all` 모드 추가 요구사항**:
- 각 세션마다 고유 색상 할당 (미리 정의된 8색 팔레트 순환)
- 노드 ID 충돌 방지: `{sessionName}::{nodeId}` 형태로 내부 ID를 구성
- `continueFrom` 관계: 부모 세션의 마지막 노드(lastNodeId) → 자식 세션의 seed(node 0)를 점선 엣지로 연결
- 상단에 세션별 색상 범례 표시

**CSS (라이트 테마)**:
- 배경: 흰색 (#FFFFFF)
- 패널 배경: 연한 회색 (#F5F5F5)
- 텍스트: 다크 (#333333)
- 코드 블록: 연한 배경 (#F0F0F0), 모노스페이스 폰트
- 경계선: #E0E0E0

#### 타입 정의

필요한 타입들은 `src/visualization/html-generator.ts` 파일 내에 정의하라. `src/types.ts`를 수정하지 마라.

```typescript
interface SessionVisualizationData {
  meta: SessionMeta;
  graph: GraphData;
  edges: Edge[];
}

interface AllSessionsVisualizationData {
  sessions: SessionVisualizationData[];
  continueFromLinks: Array<{
    parentSession: string;
    parentLastNodeId: number;
    childSession: string;
  }>;
}
```

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 없음
npm test        # 기존 테스트 모두 통과 (이 phase에서 새 테스트는 추가하지 않음)
```

## AC 검증 방법

위 AC 커맨드를 실행하라. 모두 통과하면 `/tasks/1-visualize/index.json`의 phase 0 status를 `"completed"`로 변경하라.
수정 3회 이상 시도해도 실패하면 status를 `"error"`로 변경하고, 에러 내용을 index.json의 해당 phase에 `"error_message"` 필드로 기록하라.
작업 중 사용자 개입이 반드시 필요한 상황이 발생하면 status를 `"blocked"`로, `"blocked_reason"` 필드에 사유를 구체적으로 기록하고 작업을 즉시 중단하라.

## 주의사항

- `src/types.ts`를 수정하지 마라. 시각화 전용 타입은 `html-generator.ts` 파일 내에 정의하라.
- 기존 테스트를 깨뜨리지 마라.
- vis.js는 CDN으로만 로드하라. npm 의존성에 추가하지 마라.
- HTML 문자열은 template literal로 생성하라. 별도의 HTML 파일이나 템플릿 엔진을 사용하지 마라.
- 엣지 데이터를 HTML에 임베딩할 때 `JSON.stringify`로 직렬화하여 `<script>` 태그 안의 JavaScript 변수로 넣어라. XSS 방지를 위해 `</script>` 문자열이 데이터에 포함될 경우를 처리하라 (JSON 내 `<\/script>`로 이스케이프).
- 이 phase에서는 CLI 커맨드를 만들지 마라. HTML 생성 모듈만 구현한다.
- `file-store.ts`의 기존 함수(readJson, listDirs 등)를 최대한 활용하라. 직접 fs를 import하지 마라.
