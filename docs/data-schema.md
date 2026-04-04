# Data Schema: API Tracker CLI

## Directory Structure

```
.api-tracker/
  config.yaml
  auth.json
  sessions/
    {session-name}/
      meta.json
      edges/
        {NNN}.json
      graph.json
      bindings.json
```

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
- `warnings`: `"UNREACHABLE_SUSPECT: 'org-001' has no known source"` 등

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
