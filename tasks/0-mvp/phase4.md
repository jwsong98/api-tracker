# Phase 4: HTTP 호출 + 바인딩 엔진

## 사전 준비

먼저 아래 문서들을 반드시 읽고 프로젝트의 전체 아키텍처와 설계 의도를 완전히 이해하라:

- `docs/data-schema.md` — Edge의 request.template, refs, bindings.json 구조
- `docs/flow.md` — Flow 1의 템플릿 치환 과정, Flow 6의 자동 추론
- `docs/adr.md` — ADR-002 (하이브리드 바인딩), ADR-011 (이중 저장)
- `docs/code-architecture.md` — binding-engine이 중심이라는 설계 원칙

그리고 이전 phase의 작업물을 반드시 확인하라:

- `src/types.ts` — Edge, Ref, Bindings 타입
- `src/core/auth-manager.ts` — getToken, refreshOnUnauthorized
- `src/storage/file-store.ts` — readJson, writeJson

## 작업 내용

### 1. 바인딩 엔진 — `src/core/binding-engine.ts`

이 모듈이 프로젝트의 핵심이다. 세 가지 책임:

#### a) 템플릿 치환

- `resolveTemplate(template: string, bindings: Bindings): { resolved: string; refs: Ref[] }`
  - `$ref(node.N.response.path)` 패턴을 찾아 bindings에서 값을 조회하여 치환
  - 정규식: `\$ref\(([^)]+)\)`
  - 치환된 각 참조를 `Ref` 배열로 반환: `{ value, source: "node.N.response.path", boundAs: null }`
  - 바인딩에 없는 참조를 만나면 에러 throw (명시적 참조가 깨진 것이므로)

- `resolveRequest(request: { path: string; body?: any }, bindings: Bindings): { resolved: { path: string; body?: any }; refs: Ref[] }`
  - path 문자열과 body 객체(JSON 문자열화 후)에서 모든 `$ref()`를 치환
  - body가 객체면 JSON.stringify → 치환 → JSON.parse

#### b) 자동 추론

- `inferRefs(request: { path: string; body?: any }, bindings: Bindings): Ref[]`
  - 요청의 path와 body에서 UUID v4 패턴(`[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}`)을 추출
  - 각 UUID가 bindings의 value와 일치하면 `Ref`로 기록: `{ value, source: "auto:바인딩키", boundAs: null }`
  - 일치하지 않으면 경고용 Ref: `{ value, source: "unknown", boundAs: null }` — 이것이 UNREACHABLE_SUSPECT의 기반

#### c) 바인딩 등록

- `extractBindings(edgeId: number, toNode: number, responseBody: any): Record<string, { value: any; origin: string; jsonPath: string }>`
  - 응답 body를 재귀 탐색하여 UUID v4 값이나 숫자 ID를 찾아 바인딩으로 등록
  - 바인딩 키: `node.{toNode}.response.{jsonPath}` (예: `node.1.response.id`, `node.1.response.data.userId`)
  - origin: `edge.{edgeId}`를 문자열로 지정
  - 중첩 객체는 점 표기법으로 경로 생성 (배열은 `[index]` 표기)
  - 모든 leaf 값을 등록하되, 빈 문자열/null/boolean은 제외

### 2. HTTP 호출기 — `src/core/http-caller.ts`

- `callApi(options: { method: string; url: string; headers?: Record<string, string>; body?: any }): Promise<{ status: number; headers: Record<string, string>; body: any }>`
  - Node.js 내장 `fetch` 사용
  - body가 있으면 `Content-Type: application/json` 자동 설정
  - 응답 body는 JSON 파싱 시도, 실패하면 텍스트로 저장

- `callWithAuth(options: { method: string; url: string; body?: any; authProfile?: string }): Promise<{ status: number; headers: Record<string, string>; body: any }>`
  - authProfile이 지정되면 auth-manager에서 토큰을 가져와 `Authorization: Bearer {token}` 헤더 추가
  - 응답이 401이면 `refreshOnUnauthorized()` 후 한 번 재시도
  - 재시도도 401이면 그대로 401 응답 반환 (에러 throw 하지 않음)

### 3. 테스트

#### `src/core/__tests__/binding-engine.test.ts`

- `$ref(node.1.response.id)` 치환 → 올바른 값으로 교체됨
- body 내 `$ref()` 치환
- 없는 바인딩 참조 → 에러
- UUID 자동 추론 → 바인딩에 있는 UUID 매칭
- UUID 자동 추론 → 바인딩에 없는 UUID → source "unknown"
- 응답 body에서 바인딩 추출 → 중첩 객체의 UUID 등록 확인
- 빈 값/boolean/null은 바인딩 추출에서 제외 확인

#### `src/core/__tests__/http-caller.test.ts`

nock 사용:

- 기본 GET 호출 → 200 응답
- POST with body → 응답 확인
- 401 → 자동 재시도 → 200
- 401 → 재시도도 401 → 401 반환

## Acceptance Criteria

```bash
npm run build
npm test -- src/core/__tests__/binding-engine
npm test -- src/core/__tests__/http-caller
```

## AC 검증 방법

위 AC 커맨드를 실행하라. 모두 통과하면 `/tasks/0-mvp/index.json`의 phase 4 status를 `"completed"`로 변경하라.
수정 3회 이상 시도해도 실패하면 status를 `"error"`로 변경하고, 에러 내용을 index.json의 해당 phase에 `"error_message"` 필드로 기록하라.

## 주의사항

- `extractBindings`에서 배열 내부 객체도 재귀 탐색해야 한다. 단, 배열 자체를 바인딩 값으로 등록하지는 마라.
- `$ref()` 정규식은 중첩 괄호를 지원할 필요 없다. `$ref(node.1.response.id)` 같은 단순 형태만 처리하면 된다.
- http-caller는 config의 `server.baseUrl`을 알아야 한다. 이를 인자로 받는 방식으로 구현하라 (config를 직접 import하지 마라).
- nock 사용 시 `nock.cleanAll()`과 `nock.enableNetConnect()`를 테스트 후 정리하라.
- 기존 테스트를 깨뜨리지 마라.
