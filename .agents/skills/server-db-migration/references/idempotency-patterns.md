# Idempotent DDL 패턴

각 DDL이 두 번 실행되어도 오류 없이 no-op가 되게 하는 방법.

## Postgres

### Table
```sql
CREATE TABLE IF NOT EXISTS profiles (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Column add
```sql
ALTER TABLE participations ADD COLUMN IF NOT EXISTS attended BOOLEAN NOT NULL DEFAULT TRUE;
```

### Column drop
```sql
ALTER TABLE participations DROP COLUMN IF EXISTS legacy_flag;
```

### Column rename
```sql
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='profiles' AND column_name='display_name'
  ) THEN
    ALTER TABLE profiles RENAME COLUMN display_name TO name;
  END IF;
END $$;
```

### Column type change
```sql
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='races' AND column_name='year' AND data_type='text'
  ) THEN
    ALTER TABLE races ALTER COLUMN year TYPE INTEGER USING year::INTEGER;
  END IF;
END $$;
```

### Index
```sql
CREATE INDEX IF NOT EXISTS idx_participations_profile ON participations(profile_id);
-- unique
CREATE UNIQUE INDEX IF NOT EXISTS ux_profiles_user_default
  ON profiles(user_id) WHERE is_default = TRUE;
```

### Constraint
```sql
ALTER TABLE participations DROP CONSTRAINT IF EXISTS pk_participations;
ALTER TABLE participations ADD CONSTRAINT pk_participations PRIMARY KEY (profile_id, race_id);

-- foreign key
ALTER TABLE participations DROP CONSTRAINT IF EXISTS fk_participations_profile;
ALTER TABLE participations ADD CONSTRAINT fk_participations_profile
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- check
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'check_rank_range'
  ) THEN
    ALTER TABLE participations ADD CONSTRAINT check_rank_range
      CHECK (rank IS NULL OR (rank >= 1 AND rank <= 999));
  END IF;
END $$;
```

### Enum
```sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'race_type') THEN
    CREATE TYPE race_type AS ENUM ('station', 'world', 'asia');
  END IF;
END $$;

-- enum 값 추가 (Postgres 12+)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum WHERE enumlabel = 'exhibition'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'race_type')
  ) THEN
    ALTER TYPE race_type ADD VALUE 'exhibition';
  END IF;
END $$;
```

### Trigger / Function
```sql
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_profiles_touch ON profiles;
CREATE TRIGGER trg_profiles_touch
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
```

## SQLite

`IF NOT EXISTS`는 지원되지만 `ALTER TABLE`이 제한적:
```sql
CREATE TABLE IF NOT EXISTS profiles (...);
CREATE INDEX IF NOT EXISTS idx_profiles_user ON profiles(user_id);

-- 컬럼 추가 (SQLite 3.35+ 부분 지원)
ALTER TABLE participations ADD COLUMN attended INTEGER NOT NULL DEFAULT 1;
```

컬럼 drop/rename은 SQLite에서 table 재생성 필요. 러너에서 pragma로 판단.

## MySQL

```sql
CREATE TABLE IF NOT EXISTS profiles (...);
CREATE INDEX IF NOT EXISTS idx_...;
-- MySQL 8.0.29+: ADD COLUMN IF NOT EXISTS
ALTER TABLE participations ADD COLUMN IF NOT EXISTS attended TINYINT NOT NULL DEFAULT 1;
```

MySQL 이전 버전은 information_schema로 조건부 실행.

## Anti-patterns

### 두 번 실행 시 실패
```sql
-- ❌
CREATE TABLE profiles (...);  -- 두 번째 실행에서 error

-- ❌
INSERT INTO users (id, email) VALUES ('u1', 'a@b.com');  -- unique violation

-- ✅
INSERT INTO users (id, email) VALUES ('u1', 'a@b.com')
  ON CONFLICT (id) DO NOTHING;
```

### transaction 오용
```sql
-- ❌ DDL과 데이터 이관을 한 transaction으로 묶었는데
-- 중간에 실패하면 어디부터 재실행할지 애매
BEGIN;
CREATE TABLE new_profiles (...);
INSERT INTO new_profiles SELECT ...;
DROP TABLE old_profiles;
COMMIT;

-- ✅ 각 migration을 별도 파일로 분할
-- 002_create_new_profiles.sql
-- 003_migrate_data.sql
-- 004_drop_old_profiles.sql
```

### 조건 없이 UPDATE
```sql
-- ❌ 두 번째 실행 시에도 UPDATE가 실행되어 카운트가 이상해질 수 있음
UPDATE profiles SET display_order = 0;

-- ✅ 조건 명시
UPDATE profiles SET display_order = 0 WHERE display_order IS NULL;
```
