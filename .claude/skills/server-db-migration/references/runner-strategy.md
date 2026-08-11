# 러너 전략

프로젝트 규모에 따라 세 가지 옵션.

## Option A — 수동 붙여넣기

**언제**: 프로젝트 초기, 1인 개발, migration 파일 5개 이하

- 각 SQL 파일을 provider 웹 콘솔(Neon Console, Supabase SQL Editor)에 순서대로 실행
- `docs/DB.md`에 적용 이력 기록
- `_migrations` 테이블 불필요

**단점**: 팀원 간 상태 drift, 실수 (파일 스킵/중복 실행) 감지 어려움. 5개 이상이면 Option B로 이동.

## Option B — 얇은 러너 script (권장)

**언제**: 대부분의 프로젝트

`scripts/migrate.ts` (또는 `migrate.mjs`):

```ts
import {neon} from '@neondatabase/serverless'
import {readFileSync, readdirSync} from 'fs'
import {join} from 'path'

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL_DIRECT 미설정')
const sql = neon(url)

const dir = process.argv[2] ?? 'migrations'

async function main() {
  // 1. _migrations 테이블 자체를 idempotent하게 생성
  await sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  // 2. 이미 적용된 목록 조회
  const applied = new Set(
    (await sql`SELECT name FROM _migrations` as any[]).map(r => r.name)
  )
  // 3. 파일 목록을 순서대로 정렬
  const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
  for (const f of files) {
    if (applied.has(f)) {
      console.log(`  skip  ${f}`)
      continue
    }
    console.log(`apply   ${f}`)
    const raw = readFileSync(join(dir, f), 'utf-8')
    // neon HTTP driver는 statement 하나만 지원 → 세미콜론 분리
    for (const stmt of splitStatements(raw)) {
      if (!stmt.trim()) continue
      await sql.unsafe(stmt)
    }
    await sql`INSERT INTO _migrations (name) VALUES (${f})`
    console.log(`  done  ${f}`)
  }
  console.log('all migrations applied')
}

function splitStatements(sql: string): string[] {
  // 단순 세미콜론 split. DO $$ ... $$; 안의 세미콜론을 보호하기 위해 상태 머신 필요
  // 실용적으로는 postgres.js의 unsafe나 pg의 query를 그대로 사용 (여러 statement 지원)
  // 여기 예제는 단일 statement migration을 가정
  return [sql]
}

main().catch(err => { console.error(err); process.exit(1) })
```

**Neon HTTP driver는 여러 statement를 한 번에 지원하지 않는다.** 실용적으로는:
1. `pg` 패키지 사용 (여러 statement 지원)
2. 또는 파일당 statement 하나만 담기 (권장)

`pg` 기반 러너:

```ts
import {Client} from 'pg'

const client = new Client({connectionString: process.env.DATABASE_URL_DIRECT})
await client.connect()
try {
  await client.query('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())')
  const {rows: applied} = await client.query('SELECT name FROM _migrations')
  const done = new Set(applied.map(r => r.name))
  for (const f of files) {
    if (done.has(f)) continue
    const raw = readFileSync(join(dir, f), 'utf-8')
    await client.query('BEGIN')
    try {
      await client.query(raw)
      await client.query('INSERT INTO _migrations (name) VALUES ($1)', [f])
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    }
  }
} finally {
  await client.end()
}
```

`pg`는 dev-only이므로 `devDependencies`.

package.json:
```json
{
  "scripts": {
    "migrate": "tsx scripts/migrate.ts",
    "migrate:status": "tsx scripts/migrate.ts --status"
  },
  "devDependencies": {
    "pg": "^8",
    "tsx": "^4"
  }
}
```

## Option C — 전용 라이브러리

**언제**: multi-team, 프로덕션 급 요구사항

- `node-pg-migrate` — Postgres 전용, JS/TS migration
- `dbmate` — Go 바이너리, DB agnostic
- `sqlx-cli` — Rust, sqlx 사용자
- `flyway`, `liquibase` — 엔터프라이즈

이 skill 범위 밖. 도입 시 러너 옵션은 그 도구를 따르되 이 skill의 idempotency/DSN 분리 원칙은 유지.

## Rollback runner

기본으로 만들지 않음. 필요하면:

```ts
// scripts/rollback.ts
import {readFileSync} from 'fs'
import {Client} from 'pg'

const target = process.argv[2] // "003_attended_flag"
const client = new Client({connectionString: process.env.DATABASE_URL_DIRECT})
await client.connect()
try {
  const raw = readFileSync(`migrations/_rollback/${target}.down.sql`, 'utf-8')
  await client.query('BEGIN')
  try {
    await client.query(raw)
    await client.query('DELETE FROM _migrations WHERE name = $1', [`${target}.sql`])
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  }
} finally {
  await client.end()
}
```

**절대 자동화하지 않는다.** 사용자가 명시적으로 대상 migration 이름을 넘겨야 실행.

## CI 통합

프로덕션 배포 파이프라인에서:
1. Build 성공 후 migration 실행
2. Migration 성공 후 새 코드 배포

Vercel의 경우 build hook에서 실행:
```json
{
  "buildCommand": "pnpm migrate && pnpm --filter client build"
}
```

**주의**: preview 배포에서도 migration이 실행됨. Preview branch가 prod DB에 붙지 않도록 `DATABASE_URL_DIRECT`를 preview 전용으로 설정.
