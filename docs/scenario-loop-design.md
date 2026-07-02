# Scenario Loop 설계 — 티켓 단위 goal-driven 구현 워크플로우

> 상태: 설계 확정 (2026-07-02). 구현 전.
> 결정 주체: jwsong. 관련 레포: `api-tracker`(CLI), `jwsong-develop-extensions`(VS Code 익스텐션), 각 백엔드 레포(루프 스킬).

## 1. 배경과 목표

지금까지 api-tracker는 QA(사후 검증) 도구로 사용했다. 이제 방향을 뒤집는다:

**티켓 → 시나리오를 먼저 작성(executable spec) → 현재 코드에서 실행하면 실패(RED) → 시나리오가 통과할 때까지 구현(GREEN) → 세션 기록이 곧 증거물.**

- 시나리오는 **일회성**이다. 회귀 테스트가 아니라 "이 티켓이 달성해야 할 것"의 실행 가능한 정의이며, 완료 후 기록으로 남는다.
- 각 티켓은 **독립 git worktree**에서 병렬 진행한다. api-tracker는 이미 worktree 독립적(`API_TRACKER_ROOT ?? cwd/.api-tracker`)이고, worktree별 백엔드 포트는 `config.yaml`의 `baseUrl`이 가리킨다(start.sh 빈 포트 자동 탐색 + baseUrl sync 기구현).
- 시나리오와 실행 진행의 인지 부채는 `session browse`와 같은 결의 **`scenario browse` 터미널 TUI**로 해결한다. VS Code 익스텐션 시각화는 규모·요구 불명확으로 **보류**(후속 후보, §6).

### Loop engineering 인사이트 반영

계보: prompt engineering → context engineering(Karpathy) → **loop engineering**(Boris Cherny "My job is to write loops", Peter Steinberger; Addy Osmani가 체계화). Karpathy의 인접 원칙: *"LLMs automate what you can verify."*

이 설계에 반영한 원칙:

| 원칙 | 반영 |
|---|---|
| Goal은 객관적 판정 가능해야 | 시나리오 = 결정적 CLI verifier. `scenario run`의 exit code와 result JSON이 판정 |
| Verifier를 구현보다 먼저, 분리해서 | 시나리오를 구현 **전에** 작성하고 RED를 먼저 확인. 판정은 모델이 아닌 결정적 CLI가 수행(self-grading 방지) |
| 종료 조건 3종 세트 | GREEN / max-attempts / no-progress. CLI가 아닌 바깥 루프(스킬) 책임 |
| Worktree 격리 + 외부 상태 추적 | 티켓=worktree, 상태=`scenario-result.json` 파일. 루프가 죽어도 상태는 파일에 남음 |
| Cognitive surrender 경고 | 시나리오 자체는 사람이 리뷰하는 지점. 익스텐션 시각화가 "산출물을 읽게 만드는" 장치 |

출처: [Osmani — Loop Engineering](https://addyosmani.com/blog/loop-engineering/), [The New Stack](https://thenewstack.io/loop-engineering/), [Karpathy — Sequoia Ascent 2026](https://karpathy.bearblog.dev/sequoia-ascent-2026/)

## 2. 확정된 설계 결정

1. **시나리오 모델 = flow 경로 + goal.** 시나리오는 기존 `flow.yaml` 상태머신 위의 action 경로다. 독립 시퀀스 파일이나 raw call 하이브리드는 채택하지 않는다. 신규 API가 필요하면 flow.yaml에 state/action을 먼저 추가한다 — 이것 자체가 spec 작업의 일부다.
2. **Goal 판정 범위 = API 응답 단언 + 후속 조회 상태 검증.** step별 expect(status + body JSONPath) 그리고 goal 단계의 별도 GET 호출 단언. WS 수신 검증·외부 shell 훅은 이번 범위에서 제외(후속 후보).
3. **시각화 = CLI TUI (`scenario browse`).** 익스텐션 작업은 보류한다 — 규모가 크고 원하는 형태가 아직 불명확. 목적은 "goal을 사람이 쉽게 인식"하는 것이므로, 기존 `session browse`(readline TUI, `src/cli/session-browser.ts`)와 같은 결로 충분하다. `scenario-result.json` 포맷은 외부 뷰어가 붙을 수 있게 유지(익스텐션은 나중에 이 파일만 watch하면 됨).
4. **미확정 값(uuid/timestamp 등) 의존은 late-binding + 구조적 매처 + baseline 캡처**로 해결한다(§3.4).

## 3. api-tracker 신규 기능 (Phase 1)

### 3.1 시나리오 파일 — `.api-tracker/scenarios/<ticket>.yaml`

```yaml
version: 1
ticket: RDP-1234
title: 하자보수 검수 권한 분리
description: 검수는 발견자(작성자)만 가능해야 한다
flow: flow.yaml          # 기반 상태머신 (기본값). tracker-root 상대 경로
params:                  # 기본 파라미터. `--param k=json`으로 override, ${params.*}로 참조
  projectId: "..."       # seed에서 알고 있는 값(escape hatch)

baseline:                # steps 전에 실행 → ${baseline.*}에 저장 (전/후 비교용)
  - operationId: listDefects
    params: { projectId: "${params.projectId}" }
    save: { defectCount: "$.body.totalElements" }

steps:                   # flow action을 걸어 상태머신을 걷는다(navigation 전용)
  - action: createDefect
    inputs:
      manual.title: "누수 발생"                 # manual.<name> → 요청 값(any JSON, ${...} 템플릿)
      observed.projectId: "${params.projectId}" # observed.<name> → 관측 후보 선택(id/템플릿, 또는 {index}/{label})
  # step은 자체 body 단언을 갖지 않는다. 성공/실패는 flow action의 가드 + flow.yaml expect로 판정.
  # 생성 응답 검증은 goal의 후속 조회로 한다(확정 결정).

goal:                    # 수용 기준(acceptance). 상태머신 밖 단발 호출 + assert
  - name: 생성한 하자가 목록에 노출된다
    operationId: listDefects
    params: { projectId: "${params.projectId}" }
    assert:
      status: 200
      body:
        "$.body.totalElements": { equals: "${baseline.defectCount + 1}" }
  - name: 타인은 검수할 수 없다
    operationId: inspectDefect
    auth: siteManager                            # goal 단위 auth override
    params: { defectId: "${saved.defectId}" }    # steps가 flow.yaml에서 save한 값
    assert:
      status: 403
```

- **step = navigation 전용.** `steps[].action`은 flow-runtime(`runFlowAction`)의 가드/전이/observe/save/state 영속화를 그대로 통과한다. step의 성공/실패는 그 flow action의 성공 여부(가드 + flow.yaml에 정의된 call `expect`)로 판정하며, **시나리오 단에서 step에 body 단언을 얹지 않는다.** 생성 응답에 대한 검증은 goal의 후속 조회로 수행한다(확정 결정: "API 응답 단언 + 후속 조회").
- step input은 `observed.<name>` / `manual.<name>` 접두사로 구분한다. 템플릿(`${params/saved/baseline/run.*}`)은 **러너가 runFlowAction 호출 전에 리터럴로 미리 해소**하므로 flow-runtime은 시나리오를 알 필요가 없다(무변경). observed 선택은 id/템플릿 문자열 또는 `{ index: N }` / `{ label: "..." }` 셀렉터.
- `goal[]` / `baseline[]`은 상태머신 밖 단발 호출(flat 형식: operationId/params/body/auth/save/assert). `${saved.*}`(steps가 flow-state에 남긴 값), `${baseline.*}`, `${run.startedAt|now}`, `${params.*}` 풀을 공유한다.
- **매처**(goal.assert.body 전용, 구현 완료): `equals`(리터럴 기본), `exists`, `isUuid`, `matches`(regex), `contains`, `length`/`minLength`, `gt`/`gte`/`lt`/`lte`, `after`/`before`. flow-runtime의 expect는 손대지 않았다.

### 3.2 CLI 커맨드

| 커맨드 | 역할 |
|---|---|
| `scenario validate <file> [--human]` | 스키마 검증 + 경로 정합성 dry-check (각 step이 직전 step의 도착 상태에서 실행 가능한 action인지, observed inputs가 action의 requires와 맞는지, baseline/goal operationId 존재). HTTP 없음 |
| `scenario run <file> [--session <name>] [--param k=json ...] [--human]` | 실행. 세션 리셋 후 baseline→steps→goal. exit code: GREEN=0, RED=1. `--human`은 체크리스트 |
| `scenario status [--session <name>] [--human]` | 최신 `scenario-result.json` 출력. `--session` 생략 시 가장 최근 run |

- 파일 인자는 이름(`defect-inspect`) 또는 경로. 이름은 `scenarios/<name>.yaml`로 해석.
- 세션명 기본값 = ticket을 sanitize(`[a-zA-Z0-9-]`). 매 run은 세션을 리셋(clean attempt)하며 attempt는 직전 result에서 이어받아 증가.
- 루프 제어(max-attempts, no-progress)는 CLI 밖(스킬/에이전트) 책임. CLI는 **결정적 verifier**로서 1회 판정만 한다.

### 3.3 결과 영속화 — `sessions/<name>/scenario-result.json`

```json
{
  "ticket": "RDP-1234",
  "title": "하자보수 검수 권한 분리",
  "scenarioPath": "scenarios/RDP-1234.yaml",
  "session": "RDP-1234",
  "attempt": 3,
  "startedAt": "...", "finishedAt": "...",
  "overall": "red",
  "baseline": [
    { "operationId": "listDefects", "status": "passed", "httpStatus": 200, "saved": ["defectCount"] }
  ],
  "steps": [
    { "id": 0, "action": "createDefect", "status": "passed", "from": "project", "to": "defect_detail" }
  ],
  "goal": [
    { "id": 0, "name": "생성한 하자가 목록에 노출된다", "operationId": "listDefects", "status": "failed",
      "httpStatus": 200,
      "error": { "kind": "assert.body", "path": "$.body.totalElements", "matcher": "equals", "expected": 2, "actual": 1 } }
  ]
}
```

- status: `passed | failed | pending`. step은 flow action 실행 후 결과만 기록(진행 중 `running` 중간 기록은 구현하지 않음 — 익스텐션 보류로 불필요).
- 각 호출은 기존 `recordEdge`로 `edges/NNN.json`에도 남는다 → 요청/응답 상세는 browse에서 재사용.
- `attempt`는 같은 세션에서 run 반복 시 증가(직전 result에서 이어받음). 루프의 no-progress 감지 근거(직전 attempt와 실패 지점·에러 동일 여부).
- `overall`은 baseline·모든 step·모든 goal이 pass일 때만 `green`. 실패 step 이후 goal은 `pending`.

### 3.4 미확정 값 대응 — 작성 시점에 알 수 없는 uuid/timestamp

시나리오 작성 시점에는 서버가 생성할 id·timestamp를 알 수 없다. 세 가지 층위로 해결한다. **원칙: goal에 리터럴 값을 박는 순간 시나리오가 깨진다 — 값은 실행 중에 잡아 오거나(late-binding), 구조적으로 단언한다(matcher).**

**(a) Late-binding — save/observe 체인 (기존 기구 재사용)**
서버 생성 값이 **후속 호출의 입력**으로 필요한 경우. step의 `save`/`observe`로 실행 중에 캡처하고 이후 step·goal은 `${saved.*}`로만 참조한다. 이미 flow-runtime에 있는 기구이며, 시나리오의 goal도 같은 변수 풀을 공유하는 것이 설계의 핵심.

```yaml
steps:
  - action: createDefect      # 응답의 $.id를 save: defectId
goal:
  - call: { operationId: getDefect, params: { defectId: "${saved.defectId}" } }
```

**(b) 구조적 매처 — 값이 아니라 형태·관계를 단언**
서버 생성 값을 **검증**해야 하는 경우, 등호 비교 대신 매처를 쓴다. expect/assert의 body 단언 값 자리에 매처 객체를 허용:

```yaml
assert:
  status: 200
  body:
    "$.id":        { isUuid: true }
    "$.createdAt": { after: "${run.startedAt}" }   # 실행 시작 이후에 생성됨
    "$.status":    "REGISTERED"                     # 리터럴 = equals (기본)
    "$.items":     { minLength: 1 }
    "$.items[*].id": { contains: "${saved.defectId}" }
```

최소 매처 세트: `equals`(기본), `exists`, `isUuid`, `matches`(regex), `after`/`before`(ISO timestamp 비교), `minLength`/`length`, `contains`. 러너는 `${run.startedAt}`, `${run.now}` 등 **실행 컨텍스트 변수**를 제공한다 — "작성 시점에 모르는 timestamp"는 대부분 "실행 시작 이후인가"라는 상대 단언으로 치환된다.

**(c) Baseline 캡처 — 전/후 비교**
"목록에 1건 늘었다", "unread가 증가했다"처럼 절대값을 알 수 없는 경우. steps 실행 **전에** 조회를 실행해 `${baseline.*}`에 저장하고, goal에서 상대 비교한다:

```yaml
baseline:
  - call: { operationId: listDefects, params: { projectId: "${manual.projectId}" } }
    save: { defectCount: "$.totalElements" }
goal:
  - call: { operationId: listDefects, params: { projectId: "${manual.projectId}" } }
    assert:
      body:
        "$.totalElements": { equals: "${baseline.defectCount + 1}" }   # 산술은 +N 오프셋만 지원
```

산술 표현은 범용 evaluator를 만들지 않고 `${var + N}` / `${var - N}` 오프셋만 지원한다(YAML 안에 식 언어를 키우지 않기 위한 의도적 제약).

> 이 3층으로도 안 되는 경우(예: 외부 시스템이 발급하는 값)는 시나리오가 아니라 seed/환경 준비 문제로 본다 — `manual.*` 입력으로 격리하고 시나리오 밖에서 해결한다.

### 3.5 `scenario browse` — 인지 부채 해결 (익스텐션 대체)

`session browse`(readline TUI, `src/cli/session-browser.ts`)와 같은 결의 인터랙티브 뷰. 목적: **사람이 goal과 진행 상태를 한눈에 인식**하는 것. 에이전트용이 아니라 루프를 지켜보는 사람용이다(Osmani의 cognitive surrender 방어선).

- **목록 화면**: `scenarios/*.yaml` × 최신 result를 조합 — 티켓, 제목, RED/GREEN/미실행, attempt 수, 마지막 실행 시각. worktree별로 띄우면 그 자체가 티켓 현황판.
- **시나리오 화면**: 선택 시 steps + goal을 세로 체크리스트로 렌더:
  ```
  RDP-1234  하자보수 검수 권한 분리          attempt 3   ● RED
  ──────────────────────────────────────────────
  STEPS
   ✔ 1. login                    POST /auth/login → 200
   ✔ 2. createDefect             POST /defects    → 201
   ✘ 3. inspectDefect            expect $.status = "REGISTERED", actual "DRAFT"
  GOAL
   ◌ 생성한 하자가 목록에 노출된다        (pending — step 실패로 미도달)
   ◌ 타인은 검수할 수 없다
  ```
- step에서 Enter → 기존 `browseEdges` 재사용으로 해당 edge의 요청/응답 상세 진입(코드 재사용 지점).
- 비인터랙티브 출력도 제공: `scenario status --human`이 같은 체크리스트를 1회 렌더(CI/로그·루프 종료 보고용).

result JSON 포맷(§3.3)은 그대로 유지 — 나중에 익스텐션이 생기면 이 파일만 watch하면 된다.

## 4. 익스텐션 (보류)

VS Code 익스텐션(FlowGraphView 오버레이) 방안은 **이번 범위에서 제외**한다. 규모 대비 원하는 형태가 불명확하다. 인터페이스 계약(`scenario-result.json`, scenarios YAML)이 안정화된 뒤 필요가 명확해지면 provider+view 한 쌍으로 추가한다(대칭 레지스트리 구조상 나중에 붙이는 비용이 낮음).

## 5. 루프 스킬 (Phase 3) — 백엔드 레포 측

`/ticket-loop <ticket>` (스킬 또는 커맨드):

1. **Bootstrap**: worktree 생성 → start.sh(빈 포트 자동 + baseUrl sync) → `.api-tracker/scenarios/<ticket>.yaml` 스캐폴드
2. **시나리오 작성**: 티켓 요구사항 → flow.yaml 보강(신규 state/action) + 시나리오 작성 → `scenario validate`
3. **RED 확인**: `scenario run` — 반드시 실패해야 한다. 통과하면 시나리오가 잘못됐거나 이미 구현된 것(중요한 가드). 이 시점이 **사람 리뷰 포인트**(시나리오 = spec 승인).
4. **구현 루프**: 구현 → `scenario run` → result 분석 → 반복
5. **종료 조건**: GREEN / max-attempts 도달 / no-progress(연속 N회 동일 실패 지점·에러) → 중단 후 보고
6. **완료**: scenario-result(GREEN) + 세션 기록을 증거물로 커밋/PR

## 6. 구현 순서와 미결 사항

| Phase | 대상 | 상태 | 내용 |
|---|---|---|---|
| 1 | api-tracker | ✅ 완료 | scenario 스키마 + validate/run/status + 매처(isUuid/after/contains/…) + baseline + `${var+N}` 오프셋 + scenario-result.json + `--human` 체크리스트. flow-runtime 무변경(renderCall만 export). `src/scenario/`, `src/cli/commands/scenario.ts` |
| 2 | api-tracker | 후속 | `scenario browse` 인터랙티브 TUI (목록↔체크리스트↔`browseEdges` 재사용). `status --human`은 Phase 1에 이미 포함 |
| 3 | 백엔드 레포 | 후속 | /ticket-loop 스킬 (bootstrap + RED 가드 + 구현 루프 + 종료 조건) |

**Phase 1 구현 노트**: step은 navigation 전용(자체 body 단언 없음)으로 확정 — 덕분에 flow-runtime을 건드리지 않고 `runFlowAction`을 그대로 재사용한다. 시나리오 템플릿 리졸버(`${var+N}` 산술 포함)는 flow의 renderValue와 분리해 시나리오 컨텍스트(params/baseline/saved/run/env)를 다룬다. goal/baseline만 별도 non-throwing 실행기로 처리해 per-item pass/fail을 result에 담는다.

**미결(후속 후보)**:
- VS Code 익스텐션 시나리오 뷰 (§4 — 보류, result JSON 계약만 유지)
- WS(STOMP) 수신 검증을 goal에 포함할지 — 기존 `receive.match` 재사용으로 확장 용이
- no-progress 감지의 구체 기준(동일 실패 step + 동일 error kind 연속 2회?)
- 신규 API의 flow.yaml state/action 초안을 operationId에서 생성하는 스캐폴딩 편의 기능
- `_issues/flow-manual-fields-nested-and-whole-body-typing.md` — manual 중첩 필드 한계가 시나리오 inputs에도 그대로 적용됨. 시나리오 작성 중 걸리면 우선순위 상향
