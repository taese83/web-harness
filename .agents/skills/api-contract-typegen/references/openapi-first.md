# OpenAPI-first typegen

`openapi.yaml`이 authoritative. TypeScript client는 codegen 결과만 사용.

## 파일 배치

- `_workspace/02_design/openapi.yaml` — 스펙 (authoritative)
- `src/shared/api/schema.gen.ts` — 자동 생성 타입 (수정 금지)
- `src/shared/api/client.ts` — typed fetch wrapper

## Setup

```
pnpm add -D openapi-typescript
```

```json
// package.json scripts
{
  "openapi:gen": "openapi-typescript _workspace/02_design/openapi.yaml -o src/shared/api/schema.gen.ts"
}
```

CI에서 `openapi:gen` 실행 후 `git diff --exit-code src/shared/api/schema.gen.ts`로 스펙 변경이 codegen에 반영됐는지 검증.

## Typed fetch

두 가지 선택:

### A) openapi-fetch (경량)

```
pnpm add openapi-fetch
```

```ts
// src/shared/api/client.ts
import createClient from 'openapi-fetch'
import type {paths} from './schema.gen'

export const client = createClient<paths>({baseUrl: '/api'})
```

사용:
```ts
const {data, error} = await client.GET('/profiles', {})
// data는 스펙의 200 response 타입으로 완벽 추론
```

### B) orval (React Query hook까지)

```
pnpm add -D orval
```

`orval.config.ts`:
```ts
export default {
  api: {
    input: './_workspace/02_design/openapi.yaml',
    output: {
      target: './src/shared/api/generated.ts',
      client: 'react-query',
      httpClient: 'fetch',
    },
  },
}
```

hook까지 자동 생성:
```ts
import {useGetProfiles} from '@/shared/api/generated'
const {data} = useGetProfiles()
```

## Runtime 검증 추가

OpenAPI-first는 타입만 있고 runtime 검증은 없음. 두 옵션:

1. **서버 신뢰** — internal API고 서버가 스펙을 강제 → runtime 검증 생략
2. **Zod parse layer 추가** — 외부/불안정 API → Zod schema를 별도 정의하거나 `openapi-zod-client`로 파생

## 서버 codegen

TS 서버라면:
- `openapi-typescript-express`나 `zod-openapi`로 route handler 타입 생성
- 서버가 반환하는 shape이 스펙과 어긋나면 컴파일 실패

Python/Go 서버는 각자 언어의 codegen (`openapi-generator-cli` 등) 사용.

## CI에서 drift 감지

```yaml
- run: pnpm openapi:gen
- run: git diff --exit-code src/shared/api/schema.gen.ts
  # 실패하면 codegen 결과가 committed와 다름 → 스펙 업데이트 후 재커밋 필요
```

## Pitfalls

- **schema.gen.ts 손수정**: 절대 금지. Git ignore 대신 committed → CI에서 재생성 diff로 강제
- **operationId 누락**: orval이 hook 이름을 만들지 못함. 스펙에 필수
- **$ref cycle**: openapi-typescript는 순환 참조에 약함. 필요시 `--immutable` 또는 flatten
- **oneOf/discriminated union**: `openapi-typescript`는 discriminator 지원. 스펙에서 `discriminator.propertyName` 명시
