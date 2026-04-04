# Code Architecture: API Tracker CLI

## Tech Stack

- Runtime: Node.js
- Language: TypeScript
- CLI Framework: 미정 (commander / yargs 등)
- HTTP Client: 미정 (undici / axios 등)
- Output: JSON (기본) / pretty-print (`--human`)

## Module Structure

```
src/
  cli/                    # CLI 명령어 파싱 & 라우팅
    index.ts              # 엔트리포인트
    commands/
      session.ts          # session start|list|show
      call.ts             # call <method> <path>
      replay.ts           # replay --to <node>
      auth.ts             # auth login|status
      db.ts               # db reset
  core/                   # 비즈니스 로직 (CLI 독립)
    session-manager.ts    # 세션 생성, 로드, 상태 전이
    http-caller.ts        # HTTP 호출 실행, 인증 헤더 주입
    recorder.ts           # Edge 기록, Node 생성, graph.json 갱신
    replayer.ts           # Replay 실행, 응답 비교, diff 생성
    binding-engine.ts     # 템플릿 치환, 자동 추론, 바인딩 갱신
    auth-manager.ts       # 프로필 로드, 토큰 캐싱, 만료 갱신
    db-resetter.ts        # gradle 명령 실행으로 DB 리셋
  detection/
    unreachable.ts        # 도달 불가능 호출 감지 (출처 추적)
  output/
    formatter.ts          # JSON / human-readable 출력 분기
    diff.ts               # 응답 비교 diff 생성
  storage/
    file-store.ts         # .api-tracker/ 파일 읽기/쓰기
    config-loader.ts      # config.yaml 파싱
```

## Key Design Decisions

### CLI는 stateless process
매 호출이 독립 프로세스. 상태는 전부 `.api-tracker/` 파일에 persist. 이유: Claude Code가 Bash tool로 한 명령씩 실행하는 구조에 맞춤.

### core와 cli 분리
CLI 파싱과 비즈니스 로직을 분리하여, 향후 프로그래매틱 API나 테스트에서 core를 직접 사용 가능.

### binding-engine이 중심
거의 모든 명령이 바인딩 엔진을 경유한다 (`$ref(node.N.response.path)` 문법):
- `call`: 템플릿 치환 → 호출 → 새 바인딩 등록
- `replay`: 바인딩 갱신하면서 순차 실행
- `unreachable` 감지: 바인딩에 없는 값 탐지

### 출력은 항상 structured
모든 명령은 exit code + JSON 객체 반환. 에러도 `{ "error": "...", "details": {...} }` 형태. AI agent가 파싱할 수 있어야 하므로 비정형 텍스트 출력 금지.

## Data Flow

```
[CLI Command]
  → config-loader (config.yaml 읽기)
  → session-manager (세션 로드/생성)
  → binding-engine (템플릿 치환)
  → http-caller (HTTP 실행)
  → recorder (Edge/Node/graph 기록)
  → unreachable detector (경고 생성)
  → formatter (JSON 출력)
```

## Replay Flow

```
[replay --to node.N]
  → db-resetter (gradle 명령으로 DB 시드 리셋)
  → session-manager (대상 세션 로드)
  → graph.json에서 Node 0 → Node N 경로의 Edge 목록 추출
  → 각 Edge에 대해:
    → binding-engine (저장된 템플릿을 현재 바인딩으로 치환)
    → http-caller (재실행)
    → diff (원본 응답 vs 실제 응답 비교)
      → 불일치 시: 중단, diff 출력, 세션 diverged 마킹
      → 일치 시: 바인딩 갱신 (새 UUID 등 반영), 계속
  → 완료 시: "Node N 상태 도달" 출력
```
