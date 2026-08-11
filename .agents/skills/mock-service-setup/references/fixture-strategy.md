# Fixture 전략

Handler는 재현 가능한 상태에서 실행되어야 한다. Fixture 선택은 상태의 종류에 따라 다르다.

## 3가지 fixture 유형

### 1. Factory (권장 기본값)
파라미터로 shape을 만들어내는 순수 함수. 대부분의 경우 이걸 쓴다.

```ts
// src/mocks/fixtures/profile.ts
export const makeProfile = (overrides: Partial<Profile> = {}): Profile => ({
  id: 1,
  user_id: 'user_default',
  name: 'Default Player',
  is_default: true,
  ...overrides,
})
export const makeProfiles = (n: number): Profile[] =>
  Array.from({length: n}, (_, i) => makeProfile({id: i + 1, name: `Player ${i + 1}`}))
```

**장점**: 테스트에서 정확히 필요한 변형만 생성 가능. Snapshot 잡음 없음.

### 2. Snapshot JSON
크고 정적인 응답 (예: 크롤링된 race 목록). 실서비스의 shape을 그대로 반영해야 검증 가치 있는 데이터.

```
src/mocks/fixtures/data/
  races.json
  events.json
```

**규칙**:
- 반드시 schema를 통과해야 함: import 시점에 `parseArray(RaceSchema, raw)`
- 개인정보/PII 없음
- 5MB 초과하면 요약된 sample로 대체

### 3. Runtime-generated
handler 실행 시 랜덤/시간 기반 생성. 시계열, feed에 필요.

```ts
http.get('/api/events/stream', () => {
  const events = generateEvents({from: Date.now() - 3600_000, to: Date.now(), interval: 1000})
  return HttpResponse.json(events)
})
```

**주의**: 테스트에서 안정적 재현이 필요하면 seed 파라미터를 주고 `Math.random`은 seeded PRNG로 대체.

## 실제 데이터 캡처 → fixture 흐름

real API에서 응답을 캡처해 fixture로 만들 때:
1. `curl -s <endpoint> > raw.json`
2. 개인정보/토큰/식별자 손으로 **삭제 또는 마스킹**
3. schema로 parse해서 통과하는지 확인
4. `src/mocks/fixtures/data/`에 넣기 전에 반드시 diff 검토 (leak 예방)

**금지**: 실제 응답을 그대로 커밋. 이메일·id·session 값이 새어나갈 위험.

## 결정론 (Determinism)

테스트/스토리에서 fixture는 결정론적이어야 한다:
- `new Date()` / `Date.now()` — handler 안에서 직접 호출하지 않고, fixture 함수 파라미터로 받는다
- `Math.random()` — seeded PRNG
- id 자동 증분 — 카운터 대신 index 기반

## 갱신 시점

fixture는 3가지 시점에 갱신한다:
1. **API 계약 변경 시** — schema 변경 → fixture parse 실패 → 즉시 수정
2. **UI 요구 변화 시** — 새 상태 (empty, error, extreme size) 커버 확대
3. **버그 재현 시** — 특정 조합에서 발생한 버그를 fixture로 복제 후 회귀 테스트

fixture는 시간이 지나며 성장한다. `_workspace/03_dev/change-journal/{agent-name}.md`에 fixture 변경 이유를 기록한다 (existing-change 모드일 때만).
