# Seeding Contract

시드 데이터의 계약이다. migration(스키마)과 seed(데이터)를 섞으면 환경마다 다른 데이터가 스키마 이력에 끼어들므로 분리한다.

## 3종 시드의 구분

| 종류 | 위치 | 실행 환경 | 성격 |
|---|---|---|---|
| reference seed (필수 정적 데이터 — 국가 코드·역할·기본 설정) | `migrations/` 안에 idempotent INSERT (`ON CONFLICT DO NOTHING`) | 모든 환경 | 스키마의 일부로 취급 — 이것 없이는 앱이 동작 불가 |
| dev seed (개발용 예시 데이터) | `seeds/dev.sql` (+ `pnpm seed:dev`) | 로컬·스테이징만 | 반복 실행 안전(idempotent), **production 실행 차단** |
| test fixture (테스트 전용) | 테스트 코드/MSW fixture 소유 | 테스트 러너 | 이 계약 밖 — DB seed로 만들지 않는다 |

## 규칙

1. **dev seed는 production에서 실행 불가**해야 한다 — seed 러너가 `NODE_ENV`/DSN 호스트를 검사해 production DSN이면 거부한다. "실수로 스테이징 시드가 운영에" 사고를 러너 수준에서 차단.
2. **idempotent**: 모든 seed는 두 번 실행해도 같은 결과 (`ON CONFLICT`, 고정 id). 랜덤 생성 데이터는 고정 시드(seed 값)로 재현 가능하게.
3. **현실적 데이터**: dev seed는 도메인에 맞는 현실적 예시 + 경계 사례(빈 값·최장 문자열·과거/미래 날짜)를 포함한다 — design-preview·QA의 seed 데이터 원칙과 동일. 실제 PII 복사 금지.
4. **스키마 변경 시 seed 동기화**: migration이 컬럼을 바꾸면 같은 PR에서 seed도 갱신한다 — 깨진 seed는 신규 합류자의 첫 30분을 잡아먹는 대표 사고다. seed 실행을 CI의 clean-clone 검증에 포함하면 기계로 잡힌다.
5. **양은 목적에 맞게**: dev seed는 화면이 채워져 보일 만큼(목록 10~30행)이며 성능 테스트용 대량 데이터가 아니다 — 대량은 별도 스크립트(`seeds/perf.sql`)로 분리하고 기본 흐름에 넣지 않는다.

## 러너

`pnpm seed:dev` 하나로 끝나야 한다 — migration 러너와 같은 원칙(순서 보장·트랜잭션·실패 시 명확한 에러). 신규 합류 흐름은 `pnpm migrate && pnpm seed:dev` 두 명령이 전부다.
