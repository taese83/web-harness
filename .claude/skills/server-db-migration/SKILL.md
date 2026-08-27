---
name: server-db-migration
description: Establishes a repeatable, idempotent SQL migration workflow for web-harness projects using serverless-friendly databases (Neon Postgres, Supabase, PlanetScale, SQLite). Enforces file naming, idempotency patterns (IF NOT EXISTS, DO blocks), pooled vs direct DSN separation, forward-only migrations with recorded rollback SQL, and a lightweight runner that tracks applied migrations without introducing a heavyweight ORM. Use whenever a project needs schema evolution beyond a one-shot init.sql.
argument-hint: "[db provider or migration requirements]"
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Write, Edit, Bash, Agent, AskUserQuestion
metadata:
  version: 1.2.0
  maturity: contract-only
  updated: 2026-08-04
  changelog: seeding-contract 신설 — reference seed/dev seed/test fixture 3종 구분, dev seed의 production DSN 실행 차단, idempotent·스키마 동기화 규칙. 신규 합류 흐름은 pnpm migrate && pnpm seed:dev 두 명령으로 고정.
---

# Server DB Migration

Serverless 친화 DB(Neon Postgres 등)를 사용하는 프로젝트에서 schema evolution을 안전하게 반복 가능하게 만든다.

Read `references/migration-contract.md` before writing any migration. `references/runner-strategy.md`는 실행기 선택, `references/idempotency-patterns.md`는 각 DDL의 idempotent 패턴을 다룬다. 시드 데이터가 필요하면 `references/seeding-contract.md`를 읽는다 — reference seed(스키마의 일부)/dev seed(production 실행 차단)/test fixture(계약 밖)의 3종 구분과 idempotent 규칙을 따른다.

`vite-serverless-hybrid`나 `auth-setup`으로 DB 사용이 도입된 프로젝트에서 자연스럽게 이어진다. Heavyweight ORM (Prisma, Drizzle) 대신 SQL first 원칙을 유지하되, 원한다면 그 위에 얹을 수 있는 형태.

## 언제 사용

- Postgres/SQLite/MySQL schema를 여러 번 변경 예정
- 로컬·staging·prod 각각 DB 상태를 동기화해야 함
- 팀원이 pull 받고 `pnpm migrate`로 최신 schema 반영해야 함
- 실수로 migration을 두 번 돌려도 깨지지 않아야 함

**적합하지 않은 경우**:
- 단일 `init.sql`로 끝나는 학습용 프로젝트
- Prisma/Drizzle의 자체 migration tool을 이미 사용 중 (그건 그 도구의 방식대로)

## Start

`/server-db-migration`을 호출하면:

> DB provider와 migration 요구사항을 알려주세요.

intake:
1. **DB provider** — Neon Postgres / Supabase / PlanetScale / SQLite / self-hosted
2. **연결 방식** — HTTP driver (`@neondatabase/serverless`) / pg pool / SQLite file
3. **마이그레이션 위치** — `client/migrations/` (기존 관습) / `migrations/` (root) / 커스텀
4. **적용 시점** — 수동 (`pnpm migrate`) / CI에서 자동 / provider 웹 콘솔 붙여넣기
5. **rollback 필요 여부** — up만 / up+down 모두

## Workflow

파일 작성은 **`environment-scaffolder`** subagent에게 위임한다 — migration SQL(`migrations/**`), 러너(`scripts/migrate.ts`), 이력 문서(`docs/DB.md`)가 소유 경로다. subagent 실행이 불가능한 환경에서만 현재 에이전트가 직접 작성한다. **migration 실행은 어떤 경우에도 사용자 승인 후 사용자 또는 CI가 수행한다.**

### 1. 디렉토리 구조

```
<project>/
  migrations/                 # 또는 client/migrations/
    001_initial_schema.sql
    002_add_profiles.sql
    003_attended_flag.sql
    004_manual_score_counts.sql
    _rollback/                # 선택
      003_attended_flag.down.sql
  scripts/
    migrate.ts                # 러너 (선택)
  docs/
    DB.md                     # migration 이력 문서
```

### 2. 파일 이름 규칙

`NNN_<description>.sql`
- `NNN` — zero-padded 3자리, 순서 유지
- description — snake_case, 목적 요약
- 절대 커밋 후 이름 변경 금지 (기록된 상태 깨짐)
- 이름 collision 방지: PR merge 시 rebase로 번호 조정 (또는 tool로 검증)

### 3. Idempotency 필수

모든 migration은 두 번 실행해도 안전해야 한다. `references/idempotency-patterns.md`:

```sql
-- ✅ 테이블 생성
CREATE TABLE IF NOT EXISTS profiles (...);

-- ✅ 컬럼 추가 (Postgres 9.6+)
ALTER TABLE participations ADD COLUMN IF NOT EXISTS attended BOOLEAN NOT NULL DEFAULT TRUE;

-- ✅ 인덱스
CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON profiles(user_id);

-- ✅ 조건부 로직 (Postgres DO block)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'race_type') THEN
    CREATE TYPE race_type AS ENUM ('station', 'world', 'asia');
  END IF;
END $$;

-- ✅ constraint 추가/삭제
ALTER TABLE participations DROP CONSTRAINT IF EXISTS pk_participations;
ALTER TABLE participations ADD CONSTRAINT pk_participations PRIMARY KEY (profile_id, race_id);
```

### 4. Pooled vs Direct DSN

Neon/Supabase는 두 종류 URL:
- **Pooled** — 서버 handler의 짧은 쿼리 (application 실행 시)
- **Direct/Non-pooling** — DDL, schema 변경 (migration 실행 시)

Migration은 반드시 direct DSN 사용. Pooled로 DDL 돌리면 transaction 상태가 pooler와 충돌.

`.env.local`에 두 값 모두:
```
DATABASE_URL=postgres://user:pass@ep-xxx-pooler.region.neon.tech/dbname?sslmode=require
DATABASE_URL_DIRECT=postgres://user:pass@ep-xxx.region.neon.tech/dbname?sslmode=require
```

Migration runner는 `DATABASE_URL_DIRECT`를 쓴다.

#### DSN 시크릿 위생 (생략 불가)

DSN은 **사용자명·비밀번호·호스트가 한 문자열에 들어 있는 완전한 credential**이다. 파일에 적는 순간 시크릿 파일이 된다.

- `.env`와 `.env.*` 전체를 `.gitignore`로 차단하고 `.env.example`(키 이름만, 값 없음)만 커밋한다:
  ```gitignore
  .env
  .env.*
  !.env.example
  ```
  이미 만들어진 프로젝트에 migration을 추가하는 경우, **DSN을 적기 전에** 현재 `.gitignore`가 이 파일들을 실제로 차단하는지 확인한다. "공개 값만 담는다"는 관행으로 `.env.development`·`.env.production`을 커밋하던 프로젝트라면 DSN 도입과 함께 차단으로 전환한다(실사고: 서버 시크릿이 생긴 뒤에도 env 파일이 추적된 상태로 남아 보안 리뷰 finding이 됐다).
- DSN을 대화·이슈·PR·커밋 메시지·로그에 붙여넣지 않는다. 에러 로그에 DSN이 그대로 찍히는 드라이버 예외는 마스킹한다.
- 프로덕션 DSN의 유일한 출처는 provider 대시보드다. `.env.production`류 파일에 실제 값을 두지 않는다.
- 이미 커밋됐다면 순서를 지킨다: **provider console에서 rotate → 새 값 재입력 → 배포 재설정 → 히스토리 제거**. 히스토리 제거만으로는 이미 노출된 credential이 무효화되지 않는다.
- CI/CD에서 migration을 실행한다면 DSN은 repository secret으로만 주입하고 workflow 로그에 echo하지 않는다.

### 5. 러너 옵션

`references/runner-strategy.md`:

**Option A: 수동 붙여넣기** — 프로젝트 초기, 팀 1인
- 각 migration을 provider 웹 콘솔에 순서대로 실행
- `docs/DB.md`에 적용 이력 기록
- 함정: 팀원 간 상태 drift 발생

**Option B: 얇은 러너 script** — 권장
- `scripts/migrate.ts`가 `_migrations` 테이블로 적용 이력 추적
- `pnpm migrate` — 미적용 migration만 순서대로 실행
- 실패 시 stop, 다음 실행 때 실패한 것부터 재시도

**Option C: 라이브러리** — 대규모 팀
- `node-pg-migrate`, `dbmate`, `sqlx-cli` 등
- 학습 곡선과 편의성 트레이드오프

### 6. 문서화

`docs/DB.md` 또는 `_workspace/03_dev/db-changelog.md`:
```md
# DB Changelog

## 001 (2026-07-01) — initial schema
users, participations 테이블 생성

## 002 (2026-07-08) — profiles 도입
profiles 테이블, participations.user_id → profile_id 이전

## 003 (2026-07-15) — attended flag
participations.attended BOOLEAN NOT NULL DEFAULT TRUE 추가
```

각 migration의 목적, 영향 범위, 예상 downtime을 기록. existing-change이면 실행 owner의 `_workspace/03_dev/change-journal/{agent-name}.md`와 연동.

### 7. Breaking migration 계약

Column drop/type change는 다단계:
1. 새 column/state 추가 (nullable)
2. 코드에서 both를 읽고 새 것부터 쓰기
3. 데이터 백필
4. 옛 column을 `NOT NULL` 제거 후 무시
5. 별도 릴리즈에서 drop

프로덕션에서 데이터 있는 채로 `DROP COLUMN` / `ALTER TYPE`을 한 번에 하지 않는다.

### 8. Rollback 정책

기본: **forward-only**. 문제가 생기면 새 migration으로 fix.

Rollback이 필요하면:
- `_rollback/NNN_...down.sql`을 함께 커밋
- 그러나 자동 실행하지 않음 (수동 검토 후 적용)
- 데이터 손실 가능성이 있는 rollback은 반드시 문서로 경고

## 완료 조건

- `migrations/*.sql` 파일이 순번대로 존재
- 각 migration이 두 번 실행해도 안전 (idempotent)
- `DATABASE_URL_DIRECT`로 실행되며 pooled URL과 명확히 분리
- (러너 사용 시) `_migrations` 테이블이 적용 이력을 기록
- `docs/DB.md`에 각 migration의 목적 기록
- `pnpm migrate` 두 번 실행 시 두 번째는 no-op
- `.env`·`.env.*`가 `.gitignore`로 차단되고 DSN이 저장소·로그·workflow 출력에 없다 (§DSN 시크릿 위생)
