# Data Schema: API Tracker CLI

## Directory Structure

```
.api-tracker/
  config.yaml
  flow.yaml
  auth.json
  sessions/
    {session-name}/
      meta.json
      flow-state.json
      edges/
        {NNN}.json
      graph.json
      bindings.json
```

## flow.yaml

라우트 기반 상태 머신 정의. `flow` 명령은 현재 상태의 action만 실행하고,
`observe`로 관측한 값만 이후 action 입력으로 허용한다.

```yaml
version: 1
initialState: project_list
defaultAuth: user

ws:                            # WebSocket 설정 (protocol: ws 사용 시 필수)
  endpoint: /ws                # handshake endpoint (baseUrl + endpoint)
  timeout: 5000                # 기본 수신 대기 타임아웃 (ms)

states:
  project_list:
    route: /projects
    actions:
      load_projects:
        to: project_list
        calls:
          - id: listProjects
            operationId: listProjects
            expect:
              status: 200
            observe:
              project:
                id: $.body.projects[*].id
                label: $.body.projects[*].name

      open_project_detail:
        to: project_detail
        requires:
          project:
            observedAs: project
        calls:
          - id: getProject
            operationId: getProject
            params:
              projectId: ${project.id}
            expect:
              status: 200

      create_project:
        to: project_detail
        manual:
          - name
          - visibility
        calls:
          - id: createProject
            operationId: createProject
            body:
              name: ${manual.name}
              visibility: ${manual.visibility}
            expect:
              status: 201
            observe:
              project:
                id: $.body.id
                label: $.body.name

  project_detail:
    route: /projects/:projectId

  # WebSocket/STOMP 예시
  chat_room:
    route: /chat/:roomId
    actions:
      send_message:
        to: chat_room
        protocol: ws                          # ws | http (default: http)
        subscribe: /topic/chat/${saved.roomId}  # STOMP SUBSCRIBE destination
        manual: [text]
        calls:
          - id: sendChat
            destination: /app/chat/${saved.roomId}  # STOMP SEND destination
            clientId: true                    # UUID 자동 생성 → ${_clientId}
            body:
              text: ${manual.text}
              clientGeneratedId: ${_clientId}
            expect:
              receive:                        # 수신 검증
                timeout: 3000
                match:                        # 조건 매칭 (optional)
                  $.body.clientGeneratedId: ${_clientId}
            observe:
              message:
                id: $.body.messageId
```

`manual`은 생성/수정처럼 사용자가 직접 넣어야 하는 값이다. CLI에서는
`--value name='"Demo"' --value visibility='"private"'`처럼 전달하고,
YAML에서는 `${manual.name}` 형태로 참조한다.

### WebSocket action 필드

| 필드 | 위치 | 설명 |
|------|------|------|
| `ws` | 루트 | WebSocket endpoint, 기본 타임아웃 |
| `protocol: ws` | action | STOMP 프로토콜 사용 선언 |
| `subscribe` | action | STOMP SUBSCRIBE destination |
| `destination` | call | STOMP SEND destination (operationId 대신 사용) |
| `clientId: true` | call | UUID 자동 생성, body에서 `${_clientId}`로 참조 |
| `expect.receive` | call | 수신 검증: `timeout` (ms), `match` (JSONPath → 기대값) |

## flow-state.json

```json
{
  "currentState": "project_list",
  "saved": {},
  "observed": {
    "project": [
      {
        "id": "p1",
        "label": "Demo Project",
        "source": {
          "action": "load_projects",
          "call": "listProjects"
        }
      }
    ]
  },
  "history": [
    {
      "action": "load_projects",
      "from": "project_list",
      "to": "project_list",
      "ok": true,
      "timestamp": "2026-05-27T00:00:00.000Z"
    }
  ]
}
```

세션 시작 시 기본 초기 상태는 `flow.yaml`의 `initialState`를 사용한다. 특정 상태에서
시작해야 하면 `flow start --session qa-flow --state login`처럼 override할 수 있다.

## config.yaml

```yaml
server:
  baseUrl: "http://localhost:8080"

openapi:
  specPath: "./docs/openapi.yaml"    # 파일 경로 또는 URL

auth:
  profiles:
    admin:
      endpoint: "/auth/login"
      method: "POST"
      credentials:
        email: "admin@test.com"
        password: "test1234"
      tokenPath: "$.accessToken"      # 응답에서 토큰 추출 JSONPath
      note: "시스템 관리자, 전체 권한"
    user:
      endpoint: "/auth/login"
      method: "POST"
      credentials:
        email: "user@test.com"
        password: "test1234"
      tokenPath: "$.accessToken"
      note: "A조직 일반 사용자"

db:
  resetCommand: "./gradlew flywayClean flywayMigrate"
  resetWorkingDir: "../server"        # 명령 실행 디렉토리
```

## auth.json

```json
{
  "admin": {
    "token": "eyJ...",
    "expiresAt": "2026-04-05T12:00:00Z",
    "note": "시스템 관리자, 전체 권한"
  }
}
```

## meta.json

```json
{
  "name": "user-crud",
  "status": "active",               // active | completed | diverged
  "createdAt": "2026-04-05T10:00:00Z",
  "continueFrom": null,             // 또는 "prev-session-name"
  "lastNodeId": 3,
  "edgeCount": 3
}
```

## edges/{NNN}.json

```json
{
  "edgeId": 1,
  "fromNode": 0,
  "toNode": 1,
  "timestamp": "2026-04-05T10:01:00Z",
  "request": {
    "method": "POST",
    "path": "/api/users",
    "headers": { "Authorization": "Bearer eyJ..." },
    "body": { "name": "홍길동" },
    "template": {
      "path": "/api/users",
      "body": { "name": "홍길동" }
    }
  },
  "response": {
    "status": 201,
    "headers": { "content-type": "application/json" },
    "body": { "id": "a1b2c3", "name": "홍길동" }
  },
  "refs": [
    {
      "value": "a1b2c3",
      "source": "response.new",
      "boundAs": "node.1.response.id"
    }
  ],
  "warnings": [],
  "authProfile": "admin"
}
```

핵심 필드 설명:
- `request.template`: 템플릿 치환 전 원본. `$ref(node.N.response.path)` 포함 가능
- `request.path/body`: 치환 후 실제 사용된 값
- `refs[].source`: `"node.N.response.path"` (명시적) 또는 `"auto:node.N.response.path"` (자동 추론) 또는 `"response.new"` (이 응답에서 새로 생성된 값)
- `warnings`: `"UNREACHABLE_SUSPECT: 'org-001' has no known source"` 또는 `"WS_RECEIVE_TIMEOUT"` 등
- `ws`: WebSocket action일 때만 존재. `protocol`, `destination`, `subscribe`, `clientGeneratedId`, `received[]`, `matchedMessage` 포함

## graph.json

```json
{
  "nodes": [
    { "id": 0, "label": "seed" },
    { "id": 1, "label": "POST /api/users → 201" },
    { "id": 2, "label": "GET /api/users/a1b2c3 → 200" },
    { "id": 3, "label": "DELETE /api/users/a1b2c3 → 204" }
  ],
  "edges": [
    { "id": 1, "from": 0, "to": 1, "file": "001.json" },
    { "id": 2, "from": 1, "to": 2, "file": "002.json" },
    { "id": 3, "from": 2, "to": 3, "file": "003.json" }
  ]
}
```

UI 시각화용. 노드 클릭 → meta 표시, 엣지 클릭 → 해당 edge JSON 상세 표시.

## bindings.json

```json
{
  "node.1.response.id": {
    "value": "a1b2c3",
    "origin": "edge.001",
    "jsonPath": "$.id"
  },
  "node.2.response.name": {
    "value": "홍길동",
    "origin": "edge.002",
    "jsonPath": "$.name"
  }
}
```

Replay 시 이 맵이 갱신되며, 이후 템플릿 치환에 갱신된 값이 사용된다.
