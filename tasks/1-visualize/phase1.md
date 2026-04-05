# Phase 1: visualize CLI 커맨드 + 브라우저 오픈

## 사전 준비

먼저 아래 문서들을 반드시 읽고 프로젝트의 전체 아키텍처와 설계 의도를 완전히 이해하라:

- `docs/prd.md` — 전체 제품 요구사항
- `docs/code-architecture.md` — 전체 아키텍처
- `docs/data-schema.md` — 파일 구조
- `docs/adr.md` — 기술 결정 사항 (특히 ADR-004: 상태 없는 CLI, ADR-008: JSON 기본 출력)

그리고 이전 phase의 작업물을 반드시 확인하라:

- `src/visualization/html-generator.ts` — phase 0에서 생성한 HTML 생성 모듈. 내보내는 함수: `collectSessionData`, `collectAllSessionsData`, `generateSessionHtml`, `generateAllSessionsHtml`

기존 CLI 커맨드 패턴을 반드시 읽어라:

- `src/cli/index.ts` — 메인 CLI 프로그램, 커맨드 등록 방식
- `src/cli/commands/session.ts` — 서브커맨드 패턴 예시 (Command 팩토리 함수, JSON 출력)
- `src/cli/commands/replay.ts` — 옵션 패턴 예시 (--session, --to 등)
- `src/core/session-manager.ts` — `getActiveSession()`, `getSession()` 함수

## 작업 내용

### 1. `src/cli/commands/visualize.ts` 생성

```typescript
export function visualizeCommand(): Command
```

Commander 서브커맨드로 `visualize`를 등록한다.

**옵션**:
- `--session <name>` — 특정 세션을 시각화. 생략하면 현재 active 세션을 사용.
- `--all` — 모든 세션을 통합 시각화.
- `--session`과 `--all`을 동시에 지정하면 에러: `{ "error": "--session and --all cannot be used together" }`

**동작 흐름**:

1. 옵션 파싱
2. `--all`이면:
   - `collectAllSessionsData()` 호출
   - `generateAllSessionsHtml(data)` 호출
3. `--session <name>`이면:
   - `collectSessionData(name)` 호출
   - `generateSessionHtml(data)` 호출
4. 둘 다 없으면:
   - `getActiveSession()`으로 active 세션을 찾는다
   - active 세션이 없으면 에러: `{ "error": "No active session found. Use --session <name> or --all" }`
   - `collectSessionData(activeSessionName)` 호출
   - `generateSessionHtml(data)` 호출
5. 생성된 HTML 문자열을 임시 파일로 저장:
   - 경로: `os.tmpdir()` + `/api-tracker-visualize-${Date.now()}.html`
   - `fs.writeFileSync`로 저장 (임시 파일이므로 file-store를 거치지 않는다)
6. 브라우저로 열기:
   - `process.platform === "darwin"` → `open <filepath>`
   - `process.platform === "linux"` → `xdg-open <filepath>`
   - `process.platform === "win32"` → `start <filepath>`
   - `child_process.exec`로 실행, fire-and-forget (결과를 기다리지 않는다)
7. JSON 출력: `{ "file": "<filepath>", "session": "<session-name>" }` (--all이면 `"session": "all"`)

**에러 처리**:
- 세션을 찾을 수 없으면: `{ "error": "Session \"<name>\" not found" }`
- .api-tracker 디렉토리가 없으면: `{ "error": "No .api-tracker directory found in current directory" }`
- try-catch로 감싸서 모든 에러를 JSON 형식으로 출력

### 2. `src/cli/index.ts` 수정

기존 커맨드 등록 패턴을 따라 visualize 커맨드를 추가한다:

```typescript
import { visualizeCommand } from "./commands/visualize.js";

// 기존 addCommand 뒤에 추가
program.addCommand(visualizeCommand());
```

## Acceptance Criteria

```bash
npm run build                              # 컴파일 에러 없음
npm test                                   # 기존 테스트 모두 통과
node dist/cli/index.js --help              # visualize가 서브커맨드 목록에 표시됨
node dist/cli/index.js visualize --help    # --session, --all 옵션이 표시됨
```

## AC 검증 방법

위 AC 커맨드를 실행하라. 모두 통과하면 `/tasks/1-visualize/index.json`의 phase 1 status를 `"completed"`로 변경하라.
수정 3회 이상 시도해도 실패하면 status를 `"error"`로 변경하고, 에러 내용을 index.json의 해당 phase에 `"error_message"` 필드로 기록하라.
작업 중 사용자 개입이 반드시 필요한 상황이 발생하면 status를 `"blocked"`로, `"blocked_reason"` 필드에 사유를 구체적으로 기록하고 작업을 즉시 중단하라.

## 주의사항

- 기존 커맨드(session, auth, call, replay, db)를 절대 수정하지 마라.
- 기존 테스트를 깨뜨리지 마라.
- 브라우저 오픈은 fire-and-forget이다. 프로세스 완료를 기다리지 마라. 오픈 실패 시에도 에러를 throw하지 말고, JSON 출력에 파일 경로를 포함하여 사용자가 수동으로 열 수 있게 하라.
- 임시 파일은 `os.tmpdir()`을 사용하라. `.api-tracker/` 안에 HTML 파일을 생성하지 마라.
- `child_process.exec`는 `node:child_process`에서 import하라.
- `fs.writeFileSync`는 `node:fs`에서 import하라. 임시 파일 쓰기에는 file-store.ts를 사용하지 않는다 (file-store는 .api-tracker/ 내부 전용).
- phase 0에서 만든 `html-generator.ts`의 함수 시그니처를 변경하지 마라. 있는 그대로 사용하라.
