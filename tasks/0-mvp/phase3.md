# Phase 3: 인증 관리

## 사전 준비

먼저 아래 문서들을 반드시 읽고 프로젝트의 전체 아키텍처와 설계 의도를 완전히 이해하라:

- `docs/data-schema.md` — config.yaml의 auth.profiles, auth.json 스키마
- `docs/flow.md` — Flow 5 (인증 프로필 전환)
- `docs/adr.md` — ADR-008 (JSON 기본 출력)

그리고 이전 phase의 작업물을 반드시 확인하라:

- `src/types.ts` — Config, AuthProfile, AuthCache 타입
- `src/storage/file-store.ts` — readJson, writeJson
- `src/storage/config-loader.ts` — loadConfig
- `src/cli/commands/session.ts` — commander 서브커맨드 패턴 참조

## 작업 내용

### 1. 인증 매니저 — `src/core/auth-manager.ts`

구현할 함수:

- `login(profileName: string): Promise<{ token: string; expiresAt?: string }>`
  - config.yaml에서 해당 프로필의 credentials와 endpoint를 읽는다
  - `fetch(baseUrl + endpoint, { method, body: credentials })`로 로그인 API 호출
  - 응답에서 `tokenPath` (JSONPath 단순 형태: `$.accessToken` 등)로 토큰을 추출한다
  - `auth.json`에 캐싱: `{ [profileName]: { token, expiresAt, note } }`
  - 반환: token, expiresAt

- `getToken(profileName: string): Promise<string>`
  - auth.json에서 해당 프로필의 캐싱된 토큰을 반환
  - 토큰이 없으면 자동으로 `login()` 호출
  - 반환: token 문자열

- `refreshOnUnauthorized(profileName: string): Promise<string>`
  - 강제 재로그인 후 새 토큰 반환. 401 응답 시 http-caller가 이 함수를 호출하게 된다.

- `getAuthStatus(): Promise<AuthCache>`
  - auth.json 전체 반환

핵심 규칙:
- `tokenPath`는 `$.field` 또는 `$.field.nested` 같은 단순 점 표기법만 지원하면 된다. 정규 JSONPath 라이브러리는 불필요.
- fetch 실패(네트워크 에러, 4xx/5xx) 시 명확한 에러 메시지를 throw.

### 2. CLI 명령어 — `src/cli/commands/auth.ts`

- `auth login --profile <name>`
  - login() 호출, 결과를 JSON 출력
  - 출력: `{ "profile": "admin", "token": "eyJ...(처음 20자)...", "cached": true }`
  - 보안: 토큰 전체를 출력하지 않고 앞 20자 + "..." 으로 마스킹

- `auth status`
  - getAuthStatus() 호출
  - 출력: `{ "profiles": { "admin": { "cached": true, "note": "..." }, "user": { "cached": false, "note": "..." } } }`
  - config.yaml의 프로필 목록과 auth.json의 캐싱 상태를 합쳐서 보여준다

### 3. 테스트 — `src/core/__tests__/auth-manager.test.ts`

nock을 사용하여 로그인 API를 mock한다.

- 로그인 성공 → auth.json에 토큰 캐싱 확인
- 캐싱된 토큰 조회
- 토큰 없을 때 자동 로그인
- refreshOnUnauthorized → 새 토큰 발급 확인
- 잘못된 프로필 이름 → 에러
- 로그인 API 실패(401) → 에러 메시지 확인

## Acceptance Criteria

```bash
npm run build
npm test -- src/core/__tests__/auth-manager
```

## AC 검증 방법

위 AC 커맨드를 실행하라. 모두 통과하면 `/tasks/0-mvp/index.json`의 phase 3 status를 `"completed"`로 변경하라.
수정 3회 이상 시도해도 실패하면 status를 `"error"`로 변경하고, 에러 내용을 index.json의 해당 phase에 `"error_message"` 필드로 기록하라.

## 주의사항

- `tokenPath` 파싱에 외부 JSONPath 라이브러리를 추가하지 마라. `$.a.b.c` → `obj.a.b.c` 수준의 단순 구현이면 충분하다.
- auth.json은 `.api-tracker/` 안에 저장되고, `.gitignore`에 의해 `.api-tracker/` 전체가 무시된다. 별도 보안 처리 불필요.
- nock 사용 시 테스트 끝에 반드시 `nock.cleanAll()`을 호출하라.
- 기존 테스트를 깨뜨리지 마라.
