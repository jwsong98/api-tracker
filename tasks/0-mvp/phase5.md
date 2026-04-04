# Phase 5: Call 명령어 + 기록 + 감지 + 출력

## 사전 준비

먼저 아래 문서들을 반드시 읽고 프로젝트의 전체 아키텍처와 설계 의도를 완전히 이해하라:

- `docs/data-schema.md` — Edge JSON 구조, graph.json, bindings.json
- `docs/flow.md` — Flow 1 (호출 기록), Flow 6 (도달 불가능 감지)
- `docs/adr.md` — ADR-005 (감지만, 차단 안 함), ADR-008 (JSON 출력), ADR-011 (이중 저장)
- `docs/code-architecture.md` — Data Flow 섹션

그리고 이전 phase의 작업물을 반드시 확인하라:

- `src/types.ts` — 모든 타입
- `src/core/session-manager.ts` — 세션 로드, 메타 업데이트
- `src/core/auth-manager.ts` — getToken
- `src/core/binding-engine.ts` — resolveTemplate, resolveRequest, inferRefs, extractBindings
- `src/core/http-caller.ts` — callWithAuth
- `src/storage/file-store.ts` — readJson, writeJson

## 작업 내용

### 1. 레코더 — `src/core/recorder.ts`

API 호출 결과를 Edge로 기록하고 세션 상태를 갱신한다.

- `recordEdge(options: { session: string; method: string; path: string; body?: any; authProfile?: string; templatePath: string; templateBody?: any; refs: Ref[]; response: { status: number; headers: Record<string, string>; body: any }; warnings: string[] }): Promise<{ edgeId: number; fromNode: number; toNode: number }>`

  처리 순서:
  1. 세션 meta.json에서 현재 lastNodeId, edgeCount를 읽는다
  2. edgeId = edgeCount + 1, fromNode = lastNodeId, toNode = lastNodeId + 1
  3. Edge 객체를 구성하여 `edges/{NNN}.json`에 저장 (NNN은 3자리 zero-pad)
  4. graph.json에 새 node와 edge를 추가
     - node label: `"{method} {path} → {status}"` (path는 치환된 실제 값)
  5. binding-engine의 extractBindings로 응답에서 새 바인딩을 추출하여 bindings.json에 병합
  6. meta.json 갱신: lastNodeId++, edgeCount++

### 2. 도달 불가능 호출 감지 — `src/detection/unreachable.ts`

- `detectUnreachable(refs: Ref[]): string[]`
  - refs 배열에서 source가 `"unknown"`인 항목을 찾는다
  - 각 항목에 대해 경고 문자열 생성: `"UNREACHABLE_SUSPECT: '{value}' has no known source in previous responses"`
  - 경고 배열 반환

### 3. 출력 포매터 — `src/output/formatter.ts`

- `formatOutput(data: any, options?: { human?: boolean }): string`
  - human=false (기본): `JSON.stringify(data, null, 2)`
  - human=true: 주요 필드를 사람이 읽기 쉬운 형태로 정리 (status code 강조, body 축약 등)
  - MVP에서는 human 모드를 간단하게만 구현. JSON에 색상/정렬 정도.

### 4. CLI 명령어 — `src/cli/commands/call.ts`

`call <method> <path>` 명령어:

옵션:
- `--body <json>` — 요청 body (JSON 문자열)
- `--auth <profile>` — 인증 프로필 이름
- `--session <name>` — 세션 이름 (생략 시 현재 active 세션)
- `--header <key:value>` — 추가 헤더 (반복 가능)

처리 흐름:
1. config 로드
2. 세션 로드 (--session 또는 active 세션)
3. 세션의 bindings.json 로드
4. binding-engine으로 path와 body의 `$ref()` 치환 → 치환 결과 + 명시적 refs
5. binding-engine으로 자동 추론 → 추가 refs
6. unreachable 감지 → warnings
7. http-caller로 API 호출
8. recorder로 Edge 기록
9. 출력:
```json
{
  "node": 1,
  "edge": 1,
  "request": { "method": "POST", "path": "/api/users", "body": {...} },
  "response": { "status": 201, "body": {...} },
  "refs": [...],
  "warnings": [...],
  "newBindings": { "node.1.response.id": "a1b2c3" }
}
```

### 5. 테스트 — `src/core/__tests__/recorder.test.ts`

- Edge 기록 → edges/001.json 생성 확인
- graph.json에 node, edge 추가 확인
- bindings.json에 새 바인딩 추가 확인
- meta.json의 lastNodeId, edgeCount 증가 확인
- 두 번째 Edge 기록 → edges/002.json, fromNode=1, toNode=2

### 6. 테스트 — `src/detection/__tests__/unreachable.test.ts`

- source가 "unknown"인 ref → 경고 반환
- source가 명시적인 ref → 빈 배열 반환
- 혼합 → unknown인 것만 경고

## Acceptance Criteria

```bash
npm run build
npm test -- src/core/__tests__/recorder
npm test -- src/detection/__tests__/unreachable
```

## AC 검증 방법

위 AC 커맨드를 실행하라. 모두 통과하면 `/tasks/0-mvp/index.json`의 phase 5 status를 `"completed"`로 변경하라.
수정 3회 이상 시도해도 실패하면 status를 `"error"`로 변경하고, 에러 내용을 index.json의 해당 phase에 `"error_message"` 필드로 기록하라.

## 주의사항

- recorder는 HTTP 호출을 하지 않는다. 호출 결과를 받아서 기록만 한다. 관심사 분리를 지켜라.
- formatter의 human 모드는 MVP에서 최소 구현. 복잡한 색상/테이블 렌더링을 하지 마라.
- call 명령어에서 세션이 없거나 active 세션이 없으면 명확한 에러 JSON을 출력하라: `{ "error": "No active session. Run 'session start' first." }`
- edge 파일명은 3자리 zero-pad (001, 002, ..., 999). 1000개 이상은 고려하지 않는다.
- 기존 테스트를 깨뜨리지 마라.
