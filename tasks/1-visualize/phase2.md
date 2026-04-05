# Phase 2: 테스트 + 빌드 검증

## 사전 준비

먼저 아래 문서들을 반드시 읽고 프로젝트의 전체 아키텍처와 설계 의도를 완전히 이해하라:

- `docs/data-schema.md` — 파일 구조 및 데이터 포맷
- `docs/code-architecture.md` — 전체 아키텍처

그리고 이전 phase의 작업물을 **전부** 확인하라:

- `src/visualization/html-generator.ts` — phase 0에서 생성한 HTML 생성 모듈
- `src/cli/commands/visualize.ts` — phase 1에서 생성한 CLI 커맨드
- `src/cli/index.ts` — phase 1에서 수정된 메인 CLI (visualize 커맨드 등록 확인)

기존 테스트 패턴을 참고하라:

- `src/__tests__/integration.test.ts` — 통합 테스트 패턴 (임시 디렉토리, API_TRACKER_ROOT 설정, nock)
- `src/core/__tests__/recorder.test.ts` — 유닛 테스트 패턴 (임시 디렉토리, 파일 검증)
- `src/core/__tests__/session-manager.test.ts` — 세션 관련 테스트 패턴

테스트 데이터 구조도 확인하라:

- `.test-recorder-48060/sessions/test-session/` — graph.json, edges/001.json, edges/002.json, meta.json, bindings.json

## 작업 내용

### 1. `src/visualization/__tests__/html-generator.test.ts` 생성

vitest로 html-generator 모듈의 유닛 테스트를 작성한다.

#### 테스트 환경 설정

기존 테스트(예: `src/core/__tests__/recorder.test.ts`)와 동일한 패턴을 따른다:

1. `beforeEach`에서 임시 디렉토리 생성, `API_TRACKER_ROOT` 환경변수 설정
2. 테스트용 세션 데이터를 임시 디렉토리에 직접 생성 (file-store의 writeJson 사용)
3. `afterEach`에서 임시 디렉토리 정리, 환경변수 복원

#### 테스트용 fixture 데이터

아래 데이터를 임시 디렉토리에 세팅한다. `.test-recorder-48060/`의 데이터 구조를 참고하되, 테스트 내에서 인라인으로 정의한다.

**세션 1: "user-crud"** (기본 시나리오)
- meta.json: `{ name: "user-crud", status: "active", createdAt: "2026-04-05T10:00:00Z", continueFrom: null, lastNodeId: 2, edgeCount: 2 }`
- graph.json: seed(0) → POST /api/users → 201 (1) → GET /api/users/{id} → 200 (2)
- edges/001.json: POST /api/users, 201, body: { id: "uuid-aaa", name: "홍길동" }
- edges/002.json: GET /api/users/uuid-aaa, 200, body: { id: "uuid-aaa", name: "홍길동", status: "active" }, template: { path: "/api/users/$ref(node.1.response.id)" }

**세션 2: "user-delete"** (continueFrom 시나리오, --all 모드 테스트용)
- meta.json: `{ name: "user-delete", status: "active", createdAt: "2026-04-05T11:00:00Z", continueFrom: "user-crud", lastNodeId: 1, edgeCount: 1 }`
- graph.json: seed(0, label: "continue:user-crud") → DELETE /api/users/{id} → 204 (1)
- edges/001.json: DELETE /api/users/uuid-aaa, 204, body: null

#### 테스트 케이스

**1. collectSessionData — 단일 세션 데이터 수집**
- "user-crud" 세션의 데이터를 수집
- 반환값에 meta, graph, edges가 포함되는지 확인
- edges 배열 길이가 2인지 확인
- edges가 edgeId 순서로 정렬되어 있는지 확인

**2. collectAllSessionsData — 전체 세션 데이터 수집**
- 2개 세션 모두 수집되는지 확인
- continueFromLinks에 user-crud → user-delete 연결이 포함되는지 확인
- link의 parentLastNodeId가 2 (user-crud의 lastNodeId)인지 확인

**3. generateSessionHtml — 단일 세션 HTML 생성**
- 반환값이 문자열이고 비어있지 않은지 확인
- `<!DOCTYPE html>` 포함 확인
- vis.js CDN URL 포함 확인: `unpkg.com/vis-network`
- 노드 데이터 포함 확인: `"seed"`, `"POST /api/users"` 등이 HTML 내에 존재
- 엣지 데이터 포함 확인: edges 배열이 스크립트에 임베딩됨
- 세션 이름 "user-crud" 포함 확인
- 상세 패널 영역 존재 확인 (`id="detail-panel"` 같은 식별자)

**4. generateAllSessionsHtml — 전체 세션 HTML 생성**
- 반환값에 두 세션 모두의 노드가 포함되는지 확인
- continueFrom 점선 연결 데이터가 포함되는지 확인 (`dashes: true` 또는 유사 표현)
- 세션 범례(legend) 영역 존재 확인

**5. 존재하지 않는 세션에 대한 에러 처리**
- `collectSessionData("nonexistent")`가 에러를 throw하는지 확인

**6. 노드 색상 매핑 검증**
- 생성된 HTML에서 POST 노드에 초록(#4CAF50) 색상이 할당되는지 확인
- GET 노드에 파랑(#2196F3) 색상이 할당되는지 확인
- DELETE 노드에 빨강(#F44336) 색상이 할당되는지 확인
- seed 노드에 회색(#9E9E9E) 색상이 할당되는지 확인

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 없음
npm test        # 모든 테스트 통과 (기존 + 새 테스트)
```

## AC 검증 방법

위 AC 커맨드를 실행하라. 모두 통과하면 `/tasks/1-visualize/index.json`의 phase 2 status를 `"completed"`로 변경하라.
수정 3회 이상 시도해도 실패하면 status를 `"error"`로 변경하고, 에러 내용을 index.json의 해당 phase에 `"error_message"` 필드로 기록하라.
작업 중 사용자 개입이 반드시 필요한 상황이 발생하면 status를 `"blocked"`로, `"blocked_reason"` 필드에 사유를 구체적으로 기록하고 작업을 즉시 중단하라.

## 주의사항

- 기존 테스트를 절대 수정하지 마라. 새 테스트만 추가한다.
- phase 0, 1에서 만든 코드를 수정하지 마라. 테스트가 실패하면 phase 0/1의 코드를 수정하는 것이 아니라, 코드의 실제 동작에 맞게 테스트를 작성하라.
- 단, phase 0/1의 코드에 명백한 버그가 있어서 테스트 작성이 불가능한 경우에만, 최소한의 수정을 허용한다. 이 경우 어떤 버그를 수정했는지 커밋 메시지에 명시하라.
- 테스트에서 실제 브라우저를 열지 마라. HTML 생성 결과만 검증한다.
- 테스트에서 실제 HTTP 호출을 하지 마라. 모든 데이터는 파일 시스템에 직접 작성한다.
- 임시 디렉토리는 반드시 afterEach/afterAll에서 정리하라.
