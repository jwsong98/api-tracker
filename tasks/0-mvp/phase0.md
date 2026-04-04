# Phase 0: 프로젝트 초기화

## 사전 준비

먼저 아래 문서들을 반드시 읽고 프로젝트의 전체 아키텍처와 설계 의도를 완전히 이해하라:

- `docs/prd.md` — 제품 요구사항
- `docs/code-architecture.md` — 모듈 구조 및 설계 원칙

## 작업 내용

### 1. package.json 생성

프로젝트 루트에 `package.json`을 생성한다.

```json
{
  "name": "api-tracker",
  "version": "0.1.0",
  "type": "module",
  "bin": { "api-tracker": "./dist/cli/index.js" }
}
```

의존성:
- `commander` — CLI 프레임워크
- `yaml` — config.yaml 파싱
- `deep-diff` — 응답 비교

devDependencies:
- `typescript`
- `vitest` — 테스트 러너
- `nock` — HTTP mocking
- `@types/node`
- `@types/deep-diff`

scripts:
- `build`: `tsc`
- `test`: `vitest run`
- `dev`: `tsc --watch`

### 2. tsconfig.json 생성

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

### 3. 디렉토리 구조 생성

아래 구조에 맞춰 빈 디렉토리와 placeholder `index.ts` 파일을 생성한다. 각 index.ts는 해당 모듈의 public export를 담당할 배럴 파일이다. 아직 내용은 빈 export만 둔다.

```
src/
  cli/
    commands/
    index.ts
  core/
    index.ts
  storage/
    index.ts
  output/
    index.ts
  detection/
    index.ts
```

### 4. .gitignore

프로젝트 루트에 `.gitignore`를 생성한다:

```
node_modules/
dist/
.api-tracker/
```

### 5. 의존성 설치 및 빌드 확인

`npm install`을 실행하여 의존성을 설치하고, `npm run build`로 빈 프로젝트가 정상 컴파일되는지 확인한다.

## Acceptance Criteria

```bash
npm run build # 컴파일 에러 없음, dist/ 디렉토리 생성
```

## AC 검증 방법

위 AC 커맨드를 실행하라. 모두 통과하면 `/tasks/0-mvp/index.json`의 phase 0 status를 `"completed"`로 변경하라.
수정 3회 이상 시도해도 실패하면 status를 `"error"`로 변경하고, 에러 내용을 index.json의 해당 phase에 `"error_message"` 필드로 기록하라.

## 주의사항

- `"type": "module"`을 반드시 설정하라. 이 프로젝트는 ESM 기반이다.
- 불필요한 설정 파일(eslint, prettier 등)을 추가하지 마라. MVP에서는 빌드와 테스트만 필요하다.
- `vitest`는 ESM과 TypeScript를 기본 지원하므로 별도 설정 파일이 필요 없다.
