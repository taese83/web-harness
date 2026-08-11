# Drift 감지 규칙

Client가 기대한 shape과 실제 서버 응답이 어긋나는 순간을 조기 발견.

## 3-way drift

계약 참여자:
1. **Server handler** — 실제 응답 shape
2. **Client fetch** — 기대하는 shape
3. **MSW handler** (선택) — dev/test mock shape

이 3자가 동일 schema를 참조하지 않으면 drift 발생 가능.

## 감지 계층

### Compile-time
- `tsc --noEmit` — schema 변경이 사용처에 영향
- `pnpm typecheck` CI job에 필수
- Zod-first: `z.infer<typeof Schema>`로 파생된 타입 사용 강제
- OpenAPI-first: `git diff schema.gen.ts` 검사

### Runtime — dev
- Zod `.parse()` 실패 → console에 상세 에러
- MSW handler에서도 `.parse()` — mock이 계약 어기면 즉시 실패

### Runtime — production
- Zod `.safeParse()` + Sentry log — 사용자 세션은 죽이지 않고 원인 파악
- 특히 external API에서 반드시 (upstream 계약 변경 감지)

### Test-time
- MSW handler는 real API에서 캡처한 fixture를 통과해야 함
- vitest에서 `onUnhandledRequest: 'error'` — 계약 안 된 요청은 실패

## `api-contract-verifier` agent 활용

이 skill이 완료된 프로젝트에서 verifier는 다음을 grep으로 확인:

```
# client fetch에서 캐스팅 남발
grep -rn "as Promise<" src/features/ src/entities/
grep -rn "as .*\[\]>" src/features/ src/entities/
# .parse()로 대체되어야 함

# handler와 client가 서로 다른 schema module 참조
grep -rn "from '@/shared/schemas" src/ api/
```

Verifier 출력 `qa-api-contract.md`에 drift 후보 목록.

## Anti-patterns

### 1. Client-only type

```ts
// ❌ client만 알고 있는 type. 서버가 안 지킨다
interface Profile { id: number; name: string }
const res = await fetch('/api/profiles')
return res.json() as Profile[]
```

이걸 발견하면 즉시 shared schema로 옮긴다.

### 2. `any` 반환

```ts
// ❌ 타입도 없고 검증도 없음
const res = await fetch('/api/scores')
return res.json()  // any
```

runtime 방어 없음. `.parse()`로 강제.

### 3. Response envelope 즉흥 변경

```ts
// server v1
res.status(200).json({data: profiles})
// server v2 (몰래 바뀜)
res.status(200).json({items: profiles, total: 10})
```

client가 `data`를 참조하고 있으면 조용히 undefined. Zod가 있으면 즉시 실패.

## 계약 evolution

계약이 변할 때 무너지지 않게:

- **backward compatible add**: 새 optional field. schema에 `.optional()` 추가. 배포 순서 무관
- **breaking rename**: 새 필드 추가 → 서버가 둘 다 채워보냄 → client가 새 필드로 이동 → 서버가 옛 필드 제거. 4단계
- **breaking remove**: 절대 하지 말고 deprecated로 표시. 최소 한 릴리즈 병행

`_workspace/02_design/api-schema.md` 또는 changelog에 breaking change 표시.

## Nested drift 예방

response의 일부 필드만 접근할 때도 전체 응답을 schema로 parse. 부분 destructure는 안전하지 않음:

```ts
// ❌ 다른 필드가 어긋나도 감지 못 함
const {name} = await res.json()

// ✅ 전체 검증
const parsed = ProfileSchema.parse(await res.json())
const {name} = parsed
```
