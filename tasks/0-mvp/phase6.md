# Phase 6: DB 리셋 + Replay + Diff

## 사전 준비

먼저 아래 문서들을 반드시 읽고 프로젝트의 전체 아키텍처와 설계 의도를 완전히 이해하라:

- `docs/data-schema.md` — graph.json, bindings.json, edge 구조
- `docs/flow.md` — Flow 2 (Replay 후 diff), Flow 3 (분기 생성)
- `docs/adr.md` — ADR-001 (Replay 기반 복원), ADR-006 (불일치 시 중단+diff), ADR-010 (gradle 위임)
- `docs/code-architecture.md` — Replay Flow 섹션

그리고 이전 phase의 작업물을 반드시 확인하라:

- `src/types.ts` — 모든 타입
- `src/core/session-manager.ts` — 세션 로드, 메타 업데이트
- `src/core/binding-engine.ts` — resolveRequest, extractBindings
- `src/core/http-caller.ts` — callWithAuth
- `src/core/recorder.ts` — Edge 기록 구조 이해 (replay에서는 recorder를 호출하지 않음)
- `src/storage/file-store.ts` — readJson

## 작업 내용

### 1. DB 리셋 — `src/core/db-resetter.ts`

- `resetDatabase(config: Config): Promise<{ success: boolean; output: string }>`
  - config.db.resetCommand를 child_process의 `execAsync`(util.promisify(exec))로 실행
  - config.db.resetWorkingDir이 있으면 해당 디렉토리에서 실행
  - stdout/stderr를 합쳐 output으로 반환
  - 프로세스 exit code가 0이 아니면 success=false + 에러 출력 포함
  - 타임아웃: 60초 (하드코딩 OK)

### 2. 응답 Diff — `src/output/diff.ts`

- `diffResponses(original: EdgeResponse, actual: EdgeResponse): { match: boolean; diff: any }`
  - `deep-diff` 라이브러리의 `diff()` 함수를 사용하여 두 응답을 비교
  - status code 비교 + body 비교
  - headers는 비교하지 않는다 (Date 등 항상 다른 헤더 때문)
  - match: diff가 없으면 true
  - diff: deep-diff의 결과 배열. null이면 일치.

- `formatDiff(original: EdgeResponse, actual: EdgeResponse, diffResult: any): string`
  - 사람이 읽기 쉬운 diff 문자열 생성
  - status code 차이, body의 변경/추가/삭제된 필드 표시

### 3. Replayer — `src/core/replayer.ts`

이 모듈이 replay 핵심 로직을 담당한다.

- `replayToNode(options: { session: string; targetNode: number; config: Config }): Promise<ReplayResult>`

  `ReplayResult` 타입:
  ```typescript
  type ReplayResult = {
    status: "success" | "diverged";
    dbReset: boolean;
    targetNode: number;
    replayed: Array<{
      edgeId: number;
      originalStatus: number;
      actualStatus: number;
      match: boolean;
    }>;
    bindingUpdates: Record<string, { old: string; new: string }>;
    // diverged일 때만:
    divergedAt?: number;
    diff?: any;
  };
  ```

  처리 흐름:
  1. **경로 계산**: graph.json에서 Node 0 → targetNode까지의 edge 경로를 추출한다. 그래프가 트리 구조이므로, 각 node의 부모 edge를 역추적하여 경로를 구성한다. targetNode에 도달하는 경로가 없으면 에러.

  2. **체인 세션 처리**: meta.json의 continueFrom이 있으면, 먼저 원본 세션의 모든 edge를 앞에 prepend한다. 원본 세션도 continueFrom이 있으면 재귀적으로 타고 올라간다. 최종적으로 시드 상태에서 시작하는 전체 edge 목록을 구성한다.

  3. **DB 리셋**: db-resetter로 시드 상태 복원.

  4. **순차 실행**: 각 edge에 대해:
     a. edge JSON 파일을 읽어 원본 요청의 template을 가져온다
     b. **현재 바인딩**(빈 상태에서 시작, replay 중 갱신됨)으로 template을 치환
     c. http-caller로 실제 API 호출
     d. 원본 응답과 실제 응답을 diff
     e. **일치**: extractBindings로 새 응답에서 바인딩 추출, 기존 바인딩 갱신. bindingUpdates에 변경된 바인딩 기록.
     f. **불일치**: 즉시 중단. status="diverged", divergedAt=edgeId, diff 포함.

  5. **완료**: 모든 edge 실행 후 세션의 bindings.json을 갱신된 바인딩으로 덮어쓴다.

### 4. CLI 명령어 — `src/cli/commands/replay.ts`

`replay --to <nodeId> --session <name>` 명령어:

- config 로드
- replayToNode 호출
- 결과를 JSON 출력:
  - 성공: replayed 배열, bindingUpdates, `"ready": true`
  - 분기: divergedAt, diff 표시

`--session` 생략 시 active 세션 사용.

### 5. CLI 명령어 — `src/cli/commands/db.ts`

`db reset` 명령어:

- config 로드
- resetDatabase 호출
- 결과 JSON 출력: `{ "success": true/false, "output": "..." }`

### 6. 테스트 — `src/core/__tests__/replayer.test.ts`

nock을 사용하여 API 응답을 mock한다.

테스트 시나리오:
1. **세션 준비**: file-store로 직접 세션 파일들(meta.json, graph.json, edges/001.json, edges/002.json, bindings.json)을 생성하여 "이미 기록된 세션"을 시뮬레이션한다.
2. **DB 리셋 mock**: db-resetter의 resetDatabase를 모듈 mock 또는 의존성 주입으로 mock한다 (실제 gradle 명령 실행 방지).

테스트 케이스:
- replay 성공: 2개 edge 재실행, 모든 응답 일치, bindings 갱신 확인
- replay 중 분기: 2번째 edge에서 응답 불일치 → diverged 상태, diff 포함 확인
- 바인딩 갱신: 원본에서 UUID "aaa"였던 게 replay에서 "bbb"로 변경 → bindingUpdates에 기록 확인
- 존재하지 않는 targetNode → 에러

### 7. 테스트 — `src/output/__tests__/diff.test.ts`

- 동일 응답 → match: true
- status code만 다름 → match: false, diff에 status 차이
- body 필드 다름 → match: false, diff에 변경된 필드

## Acceptance Criteria

```bash
npm run build
npm test -- src/core/__tests__/replayer
npm test -- src/output/__tests__/diff
```

## AC 검증 방법

위 AC 커맨드를 실행하라. 모두 통과하면 `/tasks/0-mvp/index.json`의 phase 6 status를 `"completed"`로 변경하라.
수정 3회 이상 시도해도 실패하면 status를 `"error"`로 변경하고, 에러 내용을 index.json의 해당 phase에 `"error_message"` 필드로 기록하라.

## 주의사항

- replayer는 edge를 **새로 기록하지 않는다**. recorder를 호출하지 마라. replay는 상태 복원 목적이지 새 기록 생성이 아니다.
- 체인 세션의 edge를 읽을 때, 원본 세션의 디렉토리에서 edge 파일을 읽어야 한다. 세션 간 파일 복사를 하지 마라.
- DB 리셋 테스트에서 실제 gradle을 실행하지 마라. 반드시 mock하라.
- `deep-diff`의 반환값이 undefined일 수 있다 (차이 없음). null 체크를 해라.
- 기존 테스트를 깨뜨리지 마라.
