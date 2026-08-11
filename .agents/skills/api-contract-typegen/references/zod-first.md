# Zod-first typegen

TypeScript monorepo에서 최소 오버헤드로 계약을 강제하는 방식.

## 파일 구조

```
src/shared/schemas/
  index.ts                # re-export
  profile.ts              # ProfileSchema, CreateProfileBodySchema, ...
  participation.ts
  scores.ts
  common.ts               # ErrorEnvelope, PaginatedList, ...
```

## Schema 작성 규칙

각 endpoint는 3개 schema를 만든다:
- `<Name>ParamsSchema` — path/query 파라미터
- `<Name>BodySchema` — request body (POST/PUT/PATCH)
- `<Name>ResponseSchema` — response

```ts
// src/shared/schemas/profile.ts
import {z} from 'zod'

export const ProfileSchema = z.object({
  id: z.number().int().positive(),
  user_id: z.string().min(1),
  name: z.string().min(1).max(50),
  is_default: z.boolean(),
})
export type Profile = z.infer<typeof ProfileSchema>

export const CreateProfileBodySchema = z.object({
  name: z.string().min(1).max(50),
})
export type CreateProfileBody = z.infer<typeof CreateProfileBodySchema>

export const ListProfilesResponseSchema = z.array(ProfileSchema)
```

## 서버 handler

```ts
// api/profiles/index.ts (Vercel serverless)
import {CreateProfileBodySchema, ProfileSchema} from '@/shared/schemas/profile'

export default async function handler(req, res) {
  if (req.method === 'POST') {
    const parsed = CreateProfileBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({error: parsed.error.message})
    }
    const created = await db.createProfile(parsed.data)
    // 반환도 schema로 검증 — server가 계약을 어기지 않는지 자체 감시
    return res.status(200).json(ProfileSchema.parse(created))
  }
}
```

`ProfileSchema.parse(created)` — 서버 스스로도 자기가 계약을 지키는지 확인. 이게 있으면 handler 버그로 계약 어긋난 응답 나가는 순간 서버가 즉시 throw.

## Client fetch

```ts
// src/features/profile/api/queries.ts
import {ListProfilesResponseSchema, type Profile} from '@/shared/schemas/profile'

export const fetchProfiles = async (): Promise<Profile[]> => {
  const res = await fetch('/api/profiles', {credentials: 'include'})
  if (!res.ok) throw new Error(`profiles fetch: ${res.status}`)
  const raw = await res.json()
  return ListProfilesResponseSchema.parse(raw)
}
```

**중요**: `as Profile[]` 캐스팅 금지. `.parse()`로 runtime 검증.

## MSW handler

```ts
// src/mocks/handlers/profile.ts
import {ProfileSchema} from '@/shared/schemas/profile'
import {HttpResponse, http} from 'msw'

export const profileHandlers = [
  http.get('/api/profiles', () => {
    const profiles = [
      ProfileSchema.parse({id: 1, user_id: 'u1', name: 'Default', is_default: true}),
    ]
    return HttpResponse.json(profiles)
  }),
]
```
handler가 schema를 통과시키므로 mock↔real drift 원천 차단.

## Common schema

```ts
// src/shared/schemas/common.ts
export const ErrorEnvelopeSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
})
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>

export const PaginatedSchema = <T extends z.ZodTypeAny>(item: T) => z.object({
  items: z.array(item),
  nextCursor: z.string().nullable(),
})
```

## OpenAPI 파생 (선택)

외부 문서화가 필요해지면:

```
pnpm add -D @asteasolutions/zod-to-openapi
```

```ts
// scripts/generate-openapi.ts
import {OpenAPIRegistry, OpenApiGeneratorV3} from '@asteasolutions/zod-to-openapi'
import {ProfileSchema} from '@/shared/schemas/profile'

const registry = new OpenAPIRegistry()
registry.register('Profile', ProfileSchema)
registry.registerPath({
  method: 'get',
  path: '/api/profiles',
  responses: {200: {description: '', content: {'application/json': {schema: z.array(ProfileSchema)}}}},
})
const generator = new OpenApiGeneratorV3(registry.definitions)
const doc = generator.generateDocument({openapi: '3.0.0', info: {title: 'API', version: '1.0.0'}})
// write to file
```

문서가 코드에서 파생 → 자동으로 drift 없음.

## Pitfalls

- **Zod 버전 mixing**: `zod@3`과 `zod@4`가 workspace에 섞이면 type merge가 깨진다. lockfile 고정
- **`.transform()` 남용**: response schema에 `.transform()`이 있으면 output type이 input과 달라져 handler에서 재사용 어려움. `.transform()`은 client-side에서만 사용
- **Optional vs Nullable 혼동**: `.optional()`은 key 누락 허용, `.nullable()`은 `null` 허용. 서버·클라이언트 계약을 명확히
- **datetime**: `z.string().datetime()`인지 `z.coerce.date()`인지 프로젝트 전체에서 하나로 통일
