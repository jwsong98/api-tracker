# PRD: API Tracker CLI

## Problem

주니어 백엔드 개발자가 API를 테스트할 때 호출 흐름을 체계적으로 기록·재현할 수단이 없다. 수동 테스트는 반복이 어렵고, 코드 변경 후 영향 확인이 비효율적이다.

## Solution

API 호출을 **방향 그래프(Node=상태, Edge=호출)** 로 자동 기록하고, 임의 시점으로 replay할 수 있는 CLI 도구.

## Primary User

AI agent (Claude Code). 사람도 사용 가능하나, 모든 인터페이스 설계는 AI-first.

## Core Capabilities

| # | 기능 | 설명 |
|---|------|------|
| 1 | **호출 기록** | HTTP 요청/응답을 Edge로 기록. 템플릿 바인딩(`$ref(node.N.response.path)`)으로 비결정적 값(UUID 등) 참조 |
| 2 | **Replay** | DB를 시드 상태로 리셋 후 지정 Node까지 Edge를 순서대로 재실행. 응답 불일치 시 중단 + diff 표시 |
| 3 | **분기** | 동일 Node에서 다른 Edge를 실행하여 새 경로 생성 |
| 4 | **바인딩 자동 추론** | 템플릿 미사용 시 UUID 등 고유값을 이전 응답에서 자동 매칭. 실패 시 경고 후 진행 |
| 5 | **도달 불가능 호출 감지** | 요청 값의 출처가 이전 응답에 없으면 경고 (시드 데이터 직접 참조 가능성) |
| 6 | **인증 관리** | 글로벌 프로필(이름/비고/credentials) 기반 토큰 캐싱 |
| 7 | **세션 관리** | 생성, 이어가기(`--continue-from`), DB 리셋, 목록 조회 |

## Non-Goals

- 부하/동시성 테스트
- 서버 다운 감지·자동 복구
- 테스트 성공/실패 자동 판정 (AI에게 위임)
- GET 요청 replay 스킵 최적화
- 서버측 테스트용 API(고정 UUID/시간 등) 제공

## Constraints

- 대상 서버: Spring + Flyway, OpenAPI3 스펙 보유
- DB 리셋: gradle 명령 기반, 서버는 무상태 가정
- 외부 부수효과(이메일 등): 개발환경에서 mock 처리 전제
- 저장: 프로젝트 루트 `.api-tracker/`, git-friendly
- 구현: Node.js / TypeScript

## Success Criteria

- AI agent가 단일 세션에서 API 흐름을 기록하고, 코드 수정 후 replay로 변화를 감지할 수 있다.
- 기록된 그래프를 별도 UI에서 시각화할 수 있는 포맷(graph.json)으로 export된다.
