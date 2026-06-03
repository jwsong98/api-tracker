# flow inputs: manual 키 타입 매칭이 top-level 이름 일치만 지원

## 상태
열림 (의도된 한계, 후속 처리 대상)

## 배경
R1에서 `flow inputs`가 manual 입력에 OpenAPI 스키마의 타입/required/enum을 붙여 내려주도록 했다 (`describeManualFields` in `src/flow/flow-runtime.ts`). 매칭 방식은 **manual 키 이름 == body/param 프로퍼티 이름** 인 경우에만 타입을 부여하고, 못 맞추면 `{name, required:true}`로 graceful degrade 한다.

## 한계 (현재 미지원)
1. **전체 body를 받는 manual 키** — 예: `manual: ["patch"]` + `body: "${manual.patch}"`. `patch`는 스펙의 어떤 프로퍼티 이름도 아니므로 타입이 안 붙는다.
2. **중첩 프로퍼티** — 예: `manual: ["address.city"]`. top-level 프로퍼티(`address`)까지만 보고 그 안의 `city`는 추적하지 않는다.

직접 대응(top-level 이름 일치)이 가장 흔한 케이스라 우선 그것만 구현했고, 위 두 경우는 깨지지 않고 무타입으로 통과한다.

## 해결 방향 (실제 케이스가 나오면)
- 전체-body 키: call의 `body` 템플릿이 `${manual.<key>}` **단독**이면 그 키를 requestBody 스키마 전체(객체)로 타이핑.
- 중첩 경로: `manual: ["a.b.c"]` 같은 dotted path를 스키마 트리를 따라 내려가며 해석.
- 두 경우 모두 enum/required/type을 가능한 만큼 전달.

## 트리거 조건
다루는 실제 API가 patch 방식(부분 업데이트 body 통째) 또는 중첩 body를 많이 쓰기 시작하면 우선순위 상향.

## 관련
- `src/flow/flow-runtime.ts` — `describeManualFields`
- `src/flow/openapi-index.ts` — `extractBodyFields` (top-level properties만 추출)
- `src/flow/__tests__/openapi-index.test.ts` — `describeManualFields` 케이스
- `docs/flow.md` — flow inputs 설명
