# Phase 2: 세션 관리

## 사전 준비

먼저 아래 문서들을 반드시 읽고 프로젝트의 전체 아키텍처와 설계 의도를 완전히 이해하라:

- `docs/data-schema.md` — meta.json, graph.json, bindings.json 스키마
- `docs/flow.md` — Flow 1(새 세션), Flow 4(세션 이어가기) 참조
- `docs/adr.md` — ADR-007 (세션 이어가기 허용)

그리고 이전 phase의 작업물을 반드시 확인하라:

- `src/types.ts` — SessionMeta, GraphData, Bindings 등 타입 정의
- `src/storage/file-store.ts` — 파일 읽기/쓰기 함수
- `src/storage/config-loader.ts` — Config 로딩

## 작업 내용

### 1. 세션 매니저 — `src/core/session-manager.ts`

구현할 함수:

- `createSession(options: { name: string; continueFrom?: string }): Promise<SessionMeta>`
  - `sessions/{name}/` 디렉토리 생성
  - `meta.json` 초기화: status="active", lastNodeId=0, edgeCount=0
  - `graph.json` 초기화: nodes=[{ id: 0, label: "seed" }], edges=[]
  - `bindings.json` 초기화: 빈 객체
  - `continueFrom`이 지정된 경우:
    - 원본 세션의 meta.json에서 lastNodeId를 읽어 이 세션의 Node 0 label에 `"continue:원본세션명"` 표기
    - 원본 세션의 bindings.json을 복사하여 새 세션의 bindings.json으로 사용
  - 동일 이름 세션이 이미 존재하면 에러 throw

- `listSessions(): Promise<SessionMeta[]>`
  - `sessions/` 하위 디렉토리를 순회하며 각 meta.json을 읽어 배열로 반환

- `getSession(name: string): Promise<SessionMeta>`
  - 해당 세션의 meta.json 반환. 없으면 에러 throw.

- `updateSessionMeta(name: string, updates: Partial<SessionMeta>): Promise<void>`
  - meta.json의 특정 필드를 업데이트

- `getActiveSession(): Promise<string | null>`
  - status가 "active"인 세션 중 가장 최근 것의 name 반환. 없으면 null.

### 2. CLI 명령어 — `src/cli/commands/session.ts`

commander의 서브커맨드로 구현한다. 각 명령은 JSON을 stdout에 출력한다.

- `session start --name <name> [--continue-from <session>]`
  - createSession 호출
  - 출력: `{ "session": "name", "status": "active", "continueFrom": null }`

- `session list`
  - listSessions 호출
  - 출력: `{ "sessions": [...] }`

- `session show --name <name>`
  - getSession 호출 + 해당 세션의 graph.json도 함께 반환
  - 출력: `{ "meta": {...}, "graph": {...} }`

### 3. 테스트 — `src/core/__tests__/session-manager.test.ts`

- 세션 생성 → meta.json, graph.json, bindings.json 파일 존재 확인
- 세션 목록 조회
- 중복 이름 세션 생성 시 에러
- `continueFrom` 세션 생성 → 원본 bindings가 복사되었는지 확인
- `continueFrom` 대상 세션이 없을 때 에러

모든 테스트는 임시 디렉토리 + `API_TRACKER_ROOT` 환경변수로 격리한다.

## Acceptance Criteria

```bash
npm run build
npm test -- src/core/__tests__/session-manager
```

## AC 검증 방법

위 AC 커맨드를 실행하라. 모두 통과하면 `/tasks/0-mvp/index.json`의 phase 2 status를 `"completed"`로 변경하라.
수정 3회 이상 시도해도 실패하면 status를 `"error"`로 변경하고, 에러 내용을 index.json의 해당 phase에 `"error_message"` 필드로 기록하라.

## 주의사항

- `continueFrom` 시 DB 리셋을 하지 않는다. DB 상태는 이전 세션의 마지막 상태를 그대로 이어받는다는 가정이다.
- 세션 이름은 파일시스템 디렉토리명으로 사용되므로, 영문/숫자/하이픈만 허용하라.
- CLI 명령어 구현 시 `commander`의 `Command` 객체를 export하는 함수 형태로 만들어라. 나중에 루트 커맨드에 `.addCommand()`로 등록한다.
- 기존 테스트를 깨뜨리지 마라.
