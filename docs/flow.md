# User Flow: API Tracker CLI

## Flow 1: 새 세션에서 API 테스트

```
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
