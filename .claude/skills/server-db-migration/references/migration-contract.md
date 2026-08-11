# Migration 계약

## 5가지 원칙

1. **파일은 append-only** — 커밋된 migration은 절대 수정하지 않는다. 문제가 있으면 다음 번호로 fix migration을 추가
2. **번호는 절대 재사용하지 않는다** — merge conflict가 나면 rebase 시 뒷 번호를 밀어서 조정
3. **각 파일은 idempotent** — `IF NOT EXISTS`, `DO $$` 블록 등으로 두 번 실행되어도 오류 없음
4. **DDL은 direct DSN, DML은 pooled DSN** — pooler와 DDL은 궁합이 나쁨
5. **breaking change는 다단계** — 실행 중인 서비스를 죽이지 않도록 nullable 추가 → 백필 → 코드 이전 → 별도 릴리즈에 drop

## 파일 형식

각 SQL 파일 상단에 메타 주석:

```sql
-- Migration: 003_attended_flag
-- Purpose: participations.attended 컬럼 추가 (선정 vs 실참여 분리)
-- Applied at: 2026-07-15
-- Reversible: yes (down: DROP COLUMN)
-- Downtime: none

ALTER TABLE participations
  ADD COLUMN IF NOT EXISTS attended BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN participations.attended IS
  '실제 참여 여부. FALSE면 선정만 되고 실참여 안 함 → 점수 미반영';
```

## 실행 순서 보장

- Migration 파일명의 숫자 순서로 실행
- 러너는 실패 시 stop, 다음 실행 때 실패 지점부터 재개
- 팀원이 pull 받은 뒤 즉시 `pnpm migrate` 관습

## Multi-environment 시나리오

로컬 → staging → prod 각각 상태가 다를 수 있음:
- 로컬: 001~005 적용됨
- staging: 001~004
- prod: 001~003

같은 파일 세트를 각 환경에서 순서대로 실행하면 최종 상태 동일. 러너의 `_migrations` 테이블이 각 환경에서 어디까지 적용됐는지 기록.

## 위험 신호

- 커밋된 migration 파일이 수정됨 → 이미 적용된 환경에서 재실행 시 다른 결과
- 번호 collision (같은 번호 두 개) → 순서 모호
- `DELETE FROM ... WHERE 1=1` — 대량 데이터 손실 가능성. 반드시 리뷰
- `DROP TABLE ... CASCADE` — 관련 데이터 함께 삭제. 리뷰 필수
- `UPDATE ... SET ... WHERE ...` 없이 전체 update — 리뷰 필수

CI에서 이런 위험 신호는 lint로 감지 (별도 script).

## Down migration

기본은 만들지 않는다. 이유:
- 데이터가 이미 새 스키마로 이전됐으면 rollback 시 데이터 손실
- 코드가 새 스키마를 가정하고 있으면 rollback 시 애플리케이션 실패
- Forward-only가 더 안전

Down이 필요한 경우:
- 배포 직후 5분 이내 (아직 실사용 데이터 없음)
- 개발 환경 전용

`_rollback/003_attended_flag.down.sql`:
```sql
-- Down: 003_attended_flag
-- WARNING: attended=FALSE인 참여는 삭제되지 않고 flag만 사라짐

ALTER TABLE participations DROP COLUMN IF EXISTS attended;
```

## 데이터 이관

Migration에서 데이터 변환도 함께:
```sql
-- 002_move_participations_to_profiles
ALTER TABLE participations ADD COLUMN IF NOT EXISTS profile_id BIGINT;

-- 기존 user_id 기반 참여를 default profile로 이전
INSERT INTO profiles (user_id, name, is_default)
SELECT DISTINCT p.user_id, u.name, TRUE
FROM participations p
JOIN users u ON u.id = p.user_id
WHERE NOT EXISTS (
  SELECT 1 FROM profiles WHERE user_id = p.user_id AND is_default = TRUE
);

UPDATE participations p
SET profile_id = (
  SELECT id FROM profiles WHERE user_id = p.user_id AND is_default = TRUE
)
WHERE profile_id IS NULL;

-- user_id는 지금 지우지 말고 다음 migration에서 (다단계)
ALTER TABLE participations ALTER COLUMN user_id DROP NOT NULL;
```

## 대량 데이터 migration

행이 100만 건 이상이면:
- transaction 하나에 담지 말고 batch로 분할
- application을 잠깐 read-only로
- `WITH cte AS (SELECT ... LIMIT 10000) UPDATE ...` 반복

이 skill 범위 밖. `_workspace/03_dev/db-migration-plan.md`에 별도 계획서.
