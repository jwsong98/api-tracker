# WebSocket 다중 사용자 세션 가이드

api-tracker로 여러 사용자가 동시에 채팅방에 참여하는 시나리오를 테스트하는 방법.

## 전제 조건

- 서버가 STOMP over WebSocket을 지원 (Spring Boot 기준 `/ws` endpoint)
- config.yaml에 사용자별 auth profile이 정의되어 있어야 함

---

## 1. config.yaml — 사용자별 인증 프로필

```yaml
server:
  baseUrl: "http://localhost:8080"

openapi:
  specPath: "./docs/openapi.yaml"

auth:
  profiles:
    userA:
      endpoint: "/auth/login"
      method: "POST"
      credentials:
        email: "userA@test.com"
        password: "test1234"
      tokenPath: "$.accessToken"
      note: "채팅 테스트 유저 A"
    userB:
      endpoint: "/auth/login"
      method: "POST"
      credentials:
        email: "userB@test.com"
        password: "test1234"
      tokenPath: "$.accessToken"
      note: "채팅 테스트 유저 B"
    userC:
      endpoint: "/auth/login"
      method: "POST"
      credentials:
        email: "userC@test.com"
        password: "test1234"
      tokenPath: "$.accessToken"
      note: "채팅 테스트 유저 C"

db:
  resetCommand: "./gradlew flywayClean flywayMigrate"
  resetWorkingDir: "../server"
```

## 2. flow.yaml — WebSocket 채팅 상태 머신

```yaml
version: 1
initialState: lobby
defaultAuth: userA          # 세션별로 override 가능

ws:
  endpoint: /ws             # WebSocket handshake endpoint
  timeout: 5000             # 기본 수신 대기 타임아웃 (ms)

states:
  lobby:
    route: /chat
    actions:
      # HTTP로 방 생성 (REST API)
      create_room:
        to: lobby
        manual: [roomName]
        calls:
          - operationId: createChatRoom
            body:
              name: ${manual.roomName}
            expect:
              status: 201
            observe:
              room:
                id: $.body.roomId
                label: $.body.name
            save:
              roomId: $.body.roomId

      # WebSocket으로 방 입장
      join_room:
        to: chat_room
        protocol: ws
        subscribe: /topic/chat/${saved.roomId}
        requires:
          room:
            observedAs: room
        calls:
          - id: join
            destination: /app/chat/${saved.roomId}/join
            body: {}
            expect:
              receive:
                timeout: 3000

  chat_room:
    route: /chat/:roomId
    actions:
      # 메시지 전송 + 수신 검증
      send_message:
        to: chat_room
        protocol: ws
        subscribe: /topic/chat/${saved.roomId}
        manual: [text]
        calls:
          - id: sendChat
            destination: /app/chat/${saved.roomId}
            clientId: true
            body:
              text: ${manual.text}
              clientGeneratedId: ${_clientId}
            expect:
              receive:
                timeout: 3000
                match:
                  $.body.clientGeneratedId: ${_clientId}
            observe:
              message:
                id: $.body.messageId
                label: $.body.text
            save:
              lastMessageId: $.body.messageId

      # 수신만 (다른 유저 메시지 확인)
      listen:
        to: chat_room
        protocol: ws
        subscribe: /topic/chat/${saved.roomId}
        calls:
          - id: listen
            destination: /app/chat/${saved.roomId}/ping
            body: {}
            expect:
              receive:
                timeout: 5000

      # 방 퇴장
      leave_room:
        to: lobby
        protocol: ws
        subscribe: /topic/chat/${saved.roomId}
        calls:
          - id: leave
            destination: /app/chat/${saved.roomId}/leave
            body: {}
```

---

## 3. 실행 순서 — 다중 사용자 시나리오

핵심: **사용자마다 별도 세션**을 만들고, 각 세션의 action에서 `--auth`로 인증을 구분한다.

### Step 1: 인증

```bash
api-tracker auth login --profile userA
api-tracker auth login --profile userB
api-tracker auth login --profile userC
```

### Step 2: 세션 생성 (사용자별)

```bash
api-tracker flow start --session userA-chat
api-tracker flow start --session userB-chat
api-tracker flow start --session userC-chat
```

세 세션 모두 flow.yaml의 `initialState: lobby`에서 시작한다.

### Step 3: 방 생성 (userA가 HTTP로)

```bash
api-tracker flow run create_room --session userA-chat --value roomName='"일반채팅"'
```

출력에서 `roomId`를 확인한다. `save`로 `roomId`가 userA-chat 세션에 저장된다.

### Step 4: 다른 세션에 roomId 공유

userB, userC 세션에도 roomId가 있어야 한다. 두 가지 방법:

**방법 A — 각 세션에서 방 목록 조회 후 observe**

```bash
# flow.yaml에 list_rooms action 추가 필요
api-tracker flow run list_rooms --session userB-chat
api-tracker flow run list_rooms --session userC-chat
```

**방법 B — flow-state.json 직접 수정** (테스트용 빠른 방법)

```bash
# userA-chat의 flow-state.json에서 roomId 확인
api-tracker flow state --session userA-chat

# userB, userC의 flow-state.json에 saved.roomId와 observed.room을 복사
# (AI agent가 JSON 파일을 직접 수정)
```

### Step 5: 방 입장 (WebSocket)

```bash
# userA 입장 — defaultAuth(userA) 사용
api-tracker flow run join_room --session userA-chat --input room:${roomId}

# userB 입장 — auth override
api-tracker flow run join_room --session userB-chat --input room:${roomId}

# userC 입장
api-tracker flow run join_room --session userC-chat --input room:${roomId}
```

각 `flow run`이 독립적으로 WebSocket 연결 → STOMP CONNECT → SUBSCRIBE → SEND → 수신 검증 → DISCONNECT를 수행한다.

### Step 6: 메시지 전송 + 수신 검증

```bash
# userA가 메시지 전송
api-tracker flow run send_message --session userA-chat --value text='"안녕하세요"'
```

출력 예시:
```json
{
  "action": "send_message",
  "calls": [{
    "destination": "/app/chat/room-1",
    "clientGeneratedId": "550e8400-e29b-41d4-a716-446655440000",
    "sent": true,
    "received": {
      "count": 1,
      "matched": true,
      "matchedMessage": {
        "destination": "/topic/chat/room-1",
        "body": {
          "messageId": "msg-1",
          "text": "안녕하세요",
          "clientGeneratedId": "550e8400-e29b-41d4-a716-446655440000",
          "sender": "userA"
        },
        "timestamp": "2026-05-28T10:00:00.123Z"
      },
      "timeElapsed": 87
    }
  }]
}
```

**수신 검증 결과 읽는 법:**
- `received.matched: true` → clientGeneratedId가 일치하는 메시지가 돌아옴 = 성공
- `received.matched: false` → 타임아웃 내 매칭 메시지 없음 = 실패
- `received.count` → 수신된 총 메시지 수
- `received.timeElapsed` → 전송 후 수신까지 걸린 시간 (ms)

### Step 7: 다른 유저도 메시지 전송

```bash
api-tracker flow run send_message --session userB-chat --value text='"반갑습니다"'
api-tracker flow run send_message --session userC-chat --value text='"저도요!"'
```

---

## 4. 수신 검증 모드 3가지

### A. clientGeneratedId 매칭 (가장 정확)

```yaml
calls:
  - destination: /app/chat/room-1
    clientId: true
    body:
      text: ${manual.text}
      clientGeneratedId: ${_clientId}
    expect:
      receive:
        timeout: 3000
        match:
          $.body.clientGeneratedId: ${_clientId}
```

내가 보낸 UUID가 포함된 메시지가 돌아오는지 확인. 다른 유저의 메시지와 혼동 없음.

### B. 타임아웃 기반 (아무 메시지든)

```yaml
calls:
  - destination: /app/chat/room-1/join
    body: {}
    expect:
      receive:
        timeout: 3000
```

3초 내 아무 메시지든 1개 오면 성공. 입장 알림 같은 곳에 적합.

### C. fire-and-forget (수신 확인 안 함)

```yaml
calls:
  - destination: /app/chat/room-1/typing
    body: { typing: true }
```

`expect.receive`가 없으면 SEND만 하고 끝. 타이핑 알림 등에 사용.

---

## 5. edge 기록 구조

각 WebSocket action은 `edges/NNN.json`에 기록된다. HTTP edge와 같은 위치에 저장되며,
`ws` 필드가 추가된다:

```json
{
  "edgeId": 3,
  "fromNode": 2,
  "toNode": 3,
  "request": {
    "method": "WS",
    "path": "/app/chat/room-1",
    "body": { "text": "안녕하세요", "clientGeneratedId": "550e..." }
  },
  "response": {
    "status": 200,
    "body": { "messageId": "msg-1", "text": "안녕하세요" }
  },
  "ws": {
    "protocol": "ws",
    "destination": "/app/chat/room-1",
    "subscribe": "/topic/chat/room-1",
    "clientGeneratedId": "550e8400-e29b-41d4-a716-446655440000",
    "received": [
      {
        "destination": "/topic/chat/room-1",
        "body": { "messageId": "msg-1", "text": "안녕하세요", "clientGeneratedId": "550e..." },
        "timestamp": "2026-05-28T10:00:00.123Z"
      }
    ],
    "matchedMessage": {
      "destination": "/topic/chat/room-1",
      "body": { "messageId": "msg-1", "text": "안녕하세요", "clientGeneratedId": "550e..." },
      "timestamp": "2026-05-28T10:00:00.123Z"
    }
  }
}
```

- `response.status`: 수신 성공이면 200, 타임아웃이면 408
- `ws.received[]`: 수신된 모든 메시지 (디버깅용)
- `ws.matchedMessage`: match 조건에 맞은 메시지 (observe/save 대상)

---

## 6. 주의사항

1. **각 `flow run`은 독립 프로세스**: WebSocket 연결이 action마다 새로 생성되고 종료된다. 장시간 구독이 필요한 테스트에는 적합하지 않다.

2. **auth override**: flow.yaml의 `defaultAuth`는 세션 전체 기본값. 세션별로 다른 유저를 쓰려면 call 레벨에서 `auth: userB`를 지정하거나, 세션별 flow.yaml을 분리한다.

3. **세션 간 데이터 공유**: 각 세션의 `saved`/`observed`는 독립적. 한 세션에서 생성한 roomId를 다른 세션에서 쓰려면 observe action(방 목록 조회 등)을 먼저 실행해야 한다.

4. **수신 검증 타이밍**: subscribe → send 순서로 실행되므로, send 전에 이미 구독이 완료된 상태. 서버가 메시지를 빠르게 브로드캐스트하면 수신을 놓치지 않는다.
