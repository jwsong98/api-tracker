# User Flow: API Tracker CLI

## Flow 1: 새 세션에서 API 테스트

```
init
  → .api-tracker/config.yaml, openapi.yaml, flow.yaml 예시 생성
  → 기존 파일은 기본적으로 덮어쓰지 않음

session start --name "user-crud" --reset-db
  → DB 시드 리셋 (gradle 명령 실행)
  → 세션 디렉토리 생성, meta.json 초기화
  → Node 0 (시드 상태) 생성

auth login --profile admin
  → config.yaml에서 프로필 credentials 조회
  → 인증 API 호출 → 토큰을 auth.json에 캐싱

call POST /api/users --body '{"name":"홍길동"}' --auth admin
  → auth.json에서 토큰 조회 (만료 시 자동 갱신)
  → HTTP 호출 실행
  → Edge 001 기록 (요청/응답/타임스탬프)
  → 응답 값을 bindings.json에 등록
  → Node 1 생성
  → JSON 출력: node id, 요청, 응답, 바인딩, 경고

call GET '/api/users/$ref(node.1.response.id)' --auth admin
  → 템플릿 치환: bindings에서 node.1.response.id 조회 → 실제 URL 생성
  → HTTP 호출 실행
  → Edge 002 기록 (템플릿 원본 + 치환된 값 모두 저장)
  → Node 2 생성
```

## Flow 2: 코드 수정 후 Replay

```
replay --to node.2 --session "user-crud"
  → DB 시드 리셋
  → Edge 001 재실행
    → 응답 비교: 원본과 일치 → 바인딩 갱신 (UUID 변경 반영)
    → 계속
  → Edge 002 재실행 (갱신된 바인딩으로 템플릿 치환)
    → 응답 비교: status 200→400 불일치
    → 중단 + diff 출력
    → 세션은 diverged 상태로 마킹
```

## Flow 3: 분기 생성

```
replay --to node.2 --session "user-crud"
  → Node 2 상태 복원 완료

call DELETE '/api/users/$ref(node.1.response.id)' --auth admin
  → Node 2에서 새 Edge 분기
  → Edge 003 기록, Node 3 생성
  → graph.json에 분기 반영
```

## Flow 4: 세션 이어가기

```
session start --name "org-test" --continue-from "user-crud"
  → DB 리셋하지 않음
  → user-crud의 마지막 Node를 org-test의 Node 0으로 참조
  → 이후 호출은 org-test 세션에 기록
```

## Flow 5: 인증 프로필 전환

```
auth login --profile user
  → 다른 프로필로 토큰 발급
  → 이후 --auth user로 호출하면 해당 토큰 사용

call GET /api/admin/settings --auth user
  → 403 Forbidden 응답 기록
  → AI agent가 권한 부족으로 판단
```

## Flow 6: 도달 불가능 호출 감지

```
call GET /api/users/seed-user-id-001 --auth admin
  → 자동 추론: "seed-user-id-001"이 이전 응답에 없음
  → 경고: UNREACHABLE_SUSPECT 플래깅
  → 호출은 정상 진행, 응답 기록
```

## Flow 7: 상태 머신 기반 가드 실행

```
flow start --session "qa-flow"
  → 일반 세션 생성
  → flow.yaml의 initialState로 flow-state.json 초기화

flow start --session "login-flow" --state login
  → flow.yaml의 initialState 대신 login 상태에서 세션 시작
  → 로그인부터 검증하는 흐름에 사용

flow actions --session "qa-flow"
  → 현재 상태에서 실행 가능한 action 목록 출력

flow run load_projects --session "qa-flow"
  → 현재 상태에 load_projects가 있는지 검증
  → OpenAPI operationId(listProjects)로 method/path 조회
  → API 호출
  → 응답 status 검증
  → observe(project) 후보 저장
  → 상태 전이

flow inputs open_project_detail --session "qa-flow"
  → open_project_detail에 필요한 observed input 후보 출력
  → manual 입력은 OpenAPI 스키마에서 타입/required/enum을 끌어와 함께 출력
    (예: visibility → type:string, enum:["public","private"], required:false)
    스키마에 매핑되지 않는 manual 키(예: 전체 body를 받는 patch)는 {name, required:true}로 표시

flow run open_project_detail --session "qa-flow" --input project:p1
  → p1이 이전 응답에서 관측된 project인지 검증
  → 검증 성공 시 getProject 호출
  → 검증 실패 시 호출하지 않고 에러 반환

flow run create_project --session "qa-flow" --value name='"Demo"' --value visibility='"private"'
  → create_project action의 manual 입력 name, visibility가 있는지 검증
  → body 템플릿의 ${manual.name}, ${manual.visibility} 치환
  → createProject 호출
  → 응답에서 새 project를 observe 후보로 저장
```

`flow`는 raw API 호출을 노출하지 않는다. QA Agent는 action만 실행할 수 있고,
현재 상태에 없는 action이나 관측되지 않은 ID를 사용한 action은 차단된다.
생성/수정처럼 화면에서 사용자가 직접 입력하는 값은 `--value`로 전달한다.

## 에이전트 출력 계약 (actions / inputs / run)

세 명령은 에이전트가 그대로 파싱하도록 **공통 봉투**로 출력한다.

- 공통 머리: `{ "ok": true, "state": { "id", "route", "variant" }, ... }`
- `actions`: `actions[]` — 각 항목이 `{ id, to, protocol?, inputs: { observed[], manual[] } }`.
  `inputs`까지 한 번에 담으므로 행동을 고르려고 `inputs`를 또 호출할 필요가 없다.
  - `observed[]` = `{ input, observedAs, candidates[] }` (이전 응답에서 관측돼 고를 수 있는 값)
  - `manual[]` = `{ name, type?, required, enum?, format?, ... }` (직접 입력해야 하는 값, OpenAPI 스키마 기반)
- `inputs <action>`: 같은 스키마로 **한 action만** 자세히 (`action: { id, to, inputs }`).
- `run <action>`: `{ ok, state, action, from, to, calls[], changed: { observed[], saved[] } }`.
  전체 세션 상태 대신 이번 호출로 바뀐 키(`changed`)만 돌려준다.

가드 실패는 텍스트가 아니라 JSON 에러로 내려온다 (exit code 1):

```json
{ "ok": false,
  "error": { "code": "MISSING_REQUIRED_INPUT", "message": "...",
             "input": "project", "producers": ["load_projects"] } }
```

에러 `code`: `ACTION_NOT_AVAILABLE`, `MISSING_REQUIRED_INPUT`, `INPUT_NOT_OBSERVED`,
`MISSING_MANUAL_VALUE`, `UNKNOWN_OPERATION`, `UNEXPECTED_STATUS`, `UNKNOWN_STATE`.
