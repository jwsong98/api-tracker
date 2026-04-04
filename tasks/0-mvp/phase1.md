# Phase 1: Storage + Config 레이어

## 사전 준비

먼저 아래 문서들을 반드시 읽고 프로젝트의 전체 아키텍처와 설계 의도를 완전히 이해하라:

- `docs/data-schema.md` — 파일 저장 구조 및 각 JSON/YAML 스키마
- `docs/code-architecture.md` — 모듈 구조

그리고 이전 phase의 작업물을 반드시 확인하라:

- `package.json`, `tsconfig.json` — 프로젝트 설정
- `src/` 하위 디렉토리 구조

## 작업 내용

### 1. 타입 정의 — `src/types.ts`

프로젝트 전체에서 사용하는 타입을 한 파일에 정의한다. `docs/data-schema.md`의 스키마를 TypeScript 인터페이스로 옮긴다.

정의할 타입:
- `Config` — config.yaml 전체 구조 (server, openapi, auth.profiles, db)
- `AuthProfile` — 개별 인증 프로필 (endpoint, method, credentials, tokenPath, note)
- `AuthCache` — auth.json 전체 구조 (프로필별 token, expiresAt, note)
- `SessionMeta` — meta.json (name, status, createdAt, continueFrom, lastNodeId, edgeCount)
- `SessionStatus` — `"active" | "completed" | "diverged"`
- `Edge` — edges/NNN.json (edgeId, fromNode, toNode, timestamp, request, response, refs, warnings, authProfile)
- `EdgeRequest` — method, path, headers, body, template
- `EdgeResponse` — status, headers, body
- `Ref` — value, source, boundAs
- `GraphData` — graph.json (nodes, edges 배열)
- `GraphNode` — id, label
- `GraphEdge` — id, from, to, file
- `Bindings` — bindings.json (키: 바인딩 경로, 값: { value, origin, jsonPath })

### 2. 파일 저장소 — `src/storage/file-store.ts`

`.api-tracker/` 하위 파일을 읽고 쓰는 유틸리티. 모든 경로는 프로젝트 루트 기준 `.api-tracker/` 접두사를 자동 붙인다.

구현할 함수:
- `readJson<T>(relativePath: string): Promise<T | null>` — 파일 없으면 null 반환
- `writeJson(relativePath: string, data: unknown): Promise<void>` — 디렉토리 자동 생성(recursive mkdir)
- `readYaml<T>(relativePath: string): Promise<T>` — yaml 패키지 사용
- `exists(relativePath: string): Promise<boolean>`
- `listDirs(relativePath: string): Promise<string[]>` — 하위 디렉토리 목록
- `getTrackerRoot(): string` — `.api-tracker` 절대 경로 반환. 환경변수 `API_TRACKER_ROOT`가 설정되어 있으면 해당 경로를, 아니면 `process.cwd() + "/.api-tracker"`를 사용.

핵심 규칙:
- 모든 파일 I/O는 `fs/promises` 사용.
- JSON 쓰기 시 `JSON.stringify(data, null, 2)` + trailing newline.
- 에러 시 의미 있는 메시지와 함께 throw.

### 3. Config 로더 — `src/storage/config-loader.ts`

구현할 함수:
- `loadConfig(): Promise<Config>` — `config.yaml`을 읽어 `Config` 타입으로 반환. 파일이 없으면 에러 throw.

### 4. 배럴 export — `src/storage/index.ts`

file-store와 config-loader의 public 함수를 re-export한다.

### 5. 테스트 — `src/storage/__tests__/file-store.test.ts`

- `writeJson` → `readJson` 라운드트립 테스트
- 존재하지 않는 파일 `readJson` → null 반환
- 중첩 디렉토리 자동 생성 테스트
- `readYaml` 기본 동작 테스트

테스트에서는 임시 디렉토리를 사용하고, `API_TRACKER_ROOT` 환경변수로 격리한다.

## Acceptance Criteria

```bash
npm run build
npm test -- src/storage
```

## AC 검증 방법

위 AC 커맨드를 실행하라. 모두 통과하면 `/tasks/0-mvp/index.json`의 phase 1 status를 `"completed"`로 변경하라.
수정 3회 이상 시도해도 실패하면 status를 `"error"`로 변경하고, 에러 내용을 index.json의 해당 phase에 `"error_message"` 필드로 기록하라.

## 주의사항

- `types.ts`의 타입은 `docs/data-schema.md`와 정확히 일치해야 한다. 임의로 필드를 추가하거나 빼지 마라.
- file-store는 `.api-tracker/` 경로만 다룬다. 프로젝트 루트의 다른 파일에 접근하는 함수를 만들지 마라.
- config-loader에서 validation 로직은 넣지 마라. 타입 캐스팅만 수행한다.
- 기존 테스트를 깨뜨리지 마라.
