# Secret Rotation 체크리스트

Client secret, session key, DB password가 유출됐거나 정기 회전이 필요할 때. Rotate = "이전 값을 즉시 무효화하고 새 값으로 교체".

## 즉시 rotate가 필요한 경우

- Slack/이메일/이슈/PR/대화에 secret 값이 붙여넣어졌을 때 (indexer/캐시가 남음)
- 팀원이 조직에서 나갔을 때
- 노트북 분실
- CI 로그, 오류 메시지에 secret이 노출된 흔적
- 정기 회전 주기 도달 (분기별 권장)

## 절대 하지 말 것

- 유출된 secret을 "그냥 두고" 다른 조치만
- 대화 중 secret 노출 후 "이거 지우겠습니다" — provider에서 rotate가 진짜 조치
- secret을 두 곳(local + Vercel + shared drive)에 저장 후 하나만 갱신

## Provider별 rotation 절차

### Google OAuth Client Secret

1. **Google Cloud Console → APIs & Services → Credentials**
2. 대상 OAuth 2.0 Client ID 클릭
3. `Add Secret` (dual-secret 모드로 잠깐 두 개 유효)
4. 새 secret을 즉시 애플리케이션에 배포 (아래 애플리케이션 절차)
5. 애플리케이션이 새 secret으로 정상 동작 확인
6. Console에서 옛 secret `Delete`
7. 옛 secret으로는 이제 token exchange 불가

**dual-secret이 없는 provider**는 downtime 잠깐 발생. maintenance window에 진행.

### Neon Postgres password

1. **Neon Console → Roles**
2. 대상 role의 `Reset password`
3. 새 password가 담긴 새 URL 확인 (pooled/direct 모두)
4. 애플리케이션 재배포
5. 옛 password는 즉시 무효화됨. 재배포 순간 이전 인스턴스는 DB 연결 실패

Downtime 최소화: 배포 파이프라인이 zero-downtime rolling deploy면 새 password로 새 인스턴스 시작 → 옛 인스턴스 종료.

### JWT SESSION_SECRET

1. 32byte random 생성 — `openssl rand -hex 32` 또는 `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
2. `.env.local`, provider dashboard 갱신
3. 재배포
4. **이전 발급된 모든 JWT는 즉시 무효화** — 모든 사용자가 재로그인
5. 짧은 downtime UX: 로그아웃 후 재로그인 안내 배너

`SESSION_SECRET` rotation은 강제 로그아웃이므로 계획된 유지보수로 공지.

### 일반 API key (Stripe, SendGrid, S3 등)

각 provider의 dashboard에서 rotate.

## 애플리케이션 반영 절차 (공통)

1. **`.env.local` 갱신** — 로컬 개발 환경
2. **Vercel Dashboard → Project → Settings → Environment Variables**
   - **Production** 재입력
   - **Preview** 재입력 (다르면 별도 값)
   - **Development** — 대시보드 값 사용하지 않으면 스킵
3. **재배포** — Vercel: latest deployment redeploy 또는 새 배포
4. **검증**
   - production URL에서 로그인, 세션, DB 접근 정상
   - error log에 secret 관련 에러 없음
5. **팀 공유** — password manager (1Password/Bitwarden) 업데이트

## 대화·이슈·PR 유출 대응

secret 문자열이 chat/GitHub에 노출된 순간:

1. **rotate가 먼저** — 위 절차 즉시 실행
2. 노출된 메시지 삭제 (지연되면 indexer/캐시가 이미 수집)
3. GitHub 유출인 경우 `git filter-branch` 또는 BFG로 history purge — 그러나 이미 clone된 fork에는 남아있음. rotate가 절대적 방어
4. 재발 방지: `git-secrets`, `truffleHog`, GitHub `push protection` 활성화

## 재발 방지

- `.env.local`이 `.gitignore`에 포함 (커밋 절대 금지)
- `.env.example`은 값 없이 이름만
- 개발 툴이 secret을 로그에 자동 출력하지 않는지 확인
- 대화 assistant에게 secret을 보여줘야 할 때는 그 시점에 rotate가 확실해질 때까지 노출 자제
- CI 로그에서 secret이 unmasked 되지 않는지 확인 (`***`로 표시되어야 함)

## Rotation 주기 권장

| 종류 | 주기 | 조기 rotate 조건 |
|---|---|---|
| DB password | 90일 | 팀원 이탈, 유출 의심 |
| OAuth client secret | 180일 | 유출 |
| Session key | 180일 | 유출 (전 사용자 강제 로그아웃) |
| Third-party API key | 90일 | 유출, key 소유자 이탈 |

정기 rotate는 캘린더에 예약. "언젠가" 하지 말고 정해진 날짜.

## Rotation runbook 파일

프로젝트에 `docs/SECRETS.md`:
```md
# Secret Rotation Runbook

각 secret의 위치, rotate 절차, 마지막 rotate 날짜.

## GOOGLE_CLIENT_SECRET
- 위치: `.env.local`, Vercel Dashboard (Prod/Preview)
- Rotate: Google Cloud Console → Credentials
- 마지막 rotate: 2026-07-15

## SESSION_SECRET
- 위치: `.env.local`, Vercel Dashboard (Prod/Preview)
- Rotate: openssl rand -hex 32 → env 갱신 → 재배포 (전 사용자 로그아웃)
- 마지막 rotate: 2026-07-01
```

이 파일 자체에 secret **값**은 절대 넣지 않는다. 이름과 절차만.
