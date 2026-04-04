# Phase 7: CLI 엔트리포인트 + 통합 테스트

## 사전 준비

먼저 아래 문서들을 반드시 읽고 프로젝트의 전체 아키텍처와 설계 의도를 완전히 이해하라:

- `docs/prd.md` — 전체 제품 요구사항
- `docs/flow.md` — 모든 사용자 흐름
- `docs/data-schema.md` — 파일 구조
- `docs/code-architecture.md` — 전체 아키텍처
- `docs/adr.md` — 모든 기술 결정

그리고 이전 phase의 작업물을 **전부** 확인하라:

- `src/cli/commands/session.ts` — session 명령어
- `src/cli/commands/auth.ts` — auth 명령어
- `src/cli/commands/call.ts` — call 명령어
- `src/cli/commands/replay.ts` — replay 명령어
- `src/cli/commands/db.ts` — db 명령어
- `src/output/formatter.ts` — 출력 포매터
- `src/types.ts` — 전체 타입

## 작업 내용

### 1. CLI 엔트리포인트 — `src/cli/index.ts`

commander를 사용하여 루트 프로그램을 구성한다.

```typescript
// 대략적인 구조 (정확한 구현은 이전 phase의 코드를 보고 맞춰라)
const program = new Command()
  .name("api-tracker")
  .description("API 호출 기록 및 Replay CLI")
  .version("0.1.0")
  .option("--human", "사람이 읽기 쉬운 출력 형식")

program.addCommand(sessionCommand())
program.addCommand(authCommand())
program.addCommand(callCommand())
program.addCommand(replayCommand())
program.addCommand(dbCommand())
```

글로벌 옵션:
- `--human` — 모든 출력을 사람용 포맷으로
- `--help` — commander가 자동 생성하는 도움말

에러 핸들링:
- 모든 명령어의 action에서 try-catch로 에러를 잡아 JSON 에러 출력 후 `process.exit(1)`
- 출력 형식: `{ "error": "에러 메시지", "details": {...} }`

shebang:
- 파일 최상단에 `#!/usr/bin/env node` 추가

### 2. 통합 테스트 — `src/__tests__/integration.test.ts`

전체 흐름을 하나의 테스트 스위트로 검증한다. nock으로 HTTP를 mock하고, 임시 디렉토리에 config.yaml과 .api-tracker/를 구성한다.

#### 테스트 환경 설정 (beforeAll)

1. 임시 디렉토리 생성
2. `API_TRACKER_ROOT`를 임시 디렉토리의 `.api-tracker`로 설정
3. config.yaml 생성:
   ```yaml
   server:
     baseUrl: "http://localhost:3000"
   openapi:
     specPath: "./openapi.yaml"
   auth:
     profiles:
       admin:
         endpoint: "/auth/login"
         method: "POST"
         credentials:
           email: "admin@test.com"
           password: "test1234"
         tokenPath: "$.accessToken"
         note: "테스트 관리자"
   db:
     resetCommand: "echo 'db reset done'"
   ```
4. nock으로 mock 서버 설정:
   - `POST /auth/login` → `{ "accessToken": "test-token-123" }`
   - `POST /api/users` → `{ "id": "uuid-aaa-111", "name": "홍길동" }`
   - `GET /api/users/uuid-aaa-111` → `{ "id": "uuid-aaa-111", "name": "홍길동", "status": "active" }`

#### 테스트 시나리오: 전체 흐름

이 테스트는 CLI 명령어를 직접 호출하지 않고, core 모듈의 함수를 조합하여 전체 흐름을 검증한다. (CLI 파싱은 commander가 보장하므로 core 로직 통합 테스트에 집중한다.)

1. **세션 시작**: sessionManager.createSession({ name: "test-flow" }) → meta.json 확인
2. **인증**: authManager.login("admin") → 토큰 캐싱 확인
3. **첫 번째 호출**: 
   - POST /api/users 호출 (call 명령어의 core 로직)
   - Edge 001 기록 확인
   - bindings에 `node.1.response.id` = `"uuid-aaa-111"` 등록 확인
4. **두 번째 호출 (템플릿 사용)**:
   - GET `/api/users/$ref(node.1.response.id)` → 치환 후 `/api/users/uuid-aaa-111`
   - Edge 002 기록 확인
   - refs에 명시적 참조 기록 확인
5. **Replay**:
   - nock 재설정: POST /api/users → `{ "id": "uuid-bbb-222", "name": "홍길동" }`
   - replay --to node.2 실행
   - DB 리셋 확인 (echo 명령 실행됨)
   - Edge 001 재실행: 응답 비교 → body.id가 다르지만 **전체 구조는 동일** → 바인딩 갱신: "uuid-aaa-111" → "uuid-bbb-222"
   - Edge 002 재실행: URL이 `/api/users/uuid-bbb-222`로 치환됨
   - 최종 bindings 갱신 확인

6. **Replay 분기 감지**:
   - nock 재설정: POST /api/users → status 400
   - replay --to node.1 실행
   - diverged 상태, diff에 status 차이 포함

#### 중요: Replay에서 body.id 변경에 대한 처리

Replay 시 응답의 id 같은 비결정적 필드가 달라져도 "구조가 동일하면 일치"로 봐야 하는지, "값이 하나라도 다르면 불일치"로 봐야 하는지 — 이 프로젝트에서는 **값이 달라도 구조(키 구조 + 값 타입)가 같으면 일치**로 판정한다. diff 모듈의 비교 로직을 이에 맞게 조정하라.

구체적으로:
- status code가 다르면 무조건 불일치
- body 비교 시: 키 구조와 값의 타입이 동일하면 일치. 값 자체의 차이는 무시.
- 이를 위해 `diff.ts`의 `diffResponses`를 수정해야 할 수 있다. body를 "구조 비교"하는 헬퍼 함수를 추가하라.

### 3. package.json bin 설정 확인

`npm run build` 후 `node dist/cli/index.js --help`가 정상 동작하는지 확인하라.

## Acceptance Criteria

```bash
npm run build
npm test
node dist/cli/index.js --help
```

세 명령 모두 에러 없이 통과해야 한다. `npm test`는 이전 phase의 테스트를 포함한 전체 테스트가 통과해야 한다. `--help`는 모든 서브커맨드(session, auth, call, replay, db)가 표시되어야 한다.

## AC 검증 방법

위 AC 커맨드를 실행하라. 모두 통과하면 `/tasks/0-mvp/index.json`의 phase 7 status를 `"completed"`로 변경하라.
수정 3회 이상 시도해도 실패하면 status를 `"error"`로 변경하고, 에러 내용을 index.json의 해당 phase에 `"error_message"` 필드로 기록하라.

## 주의사항

- **Replay의 응답 비교는 "구조 비교"이다.** status code는 정확히 일치해야 하지만, body는 키 구조 + 값 타입만 비교한다. UUID 등 비결정적 값이 매번 다르기 때문이다. 이 규칙을 반드시 구현하라. 이전 phase의 diff.ts를 수정해야 할 수 있다.
- 통합 테스트에서 실제 파일 시스템을 사용한다. 테스트 후 임시 디렉토리를 정리하라 (afterAll).
- `--help` 출력은 commander가 자동 생성한다. 커스텀 도움말 텍스트를 추가하지 마라.
- 이전 phase에서 만든 모든 테스트가 여전히 통과해야 한다. 이전 테스트를 수정해야 한다면 최소한으로 수정하라.
- shebang(`#!/usr/bin/env node`)을 빠뜨리지 마라.
