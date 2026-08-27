# Artifact Sharding Contract

`_workspace` 설계 산출물의 크기 예산과 분할 규칙이다. 하류 에이전트가 자기에게 필요 없는 절까지 통째로 다시 읽는 것을 막는다.

## 왜 필요한가

설계 산출물 하나를 평균 5~13개 소비 스폰이 입력으로 읽는다(2026-08-26 통합 **전** 에이전트 기준 실측 — 통합 후 재측정 전). 단일 파일이 50KB를 넘으면 각 소비자가 자기 담당과 무관한 40KB 이상을 매번 함께 읽는다. 분할은 산출물의 정보량을 줄이는 것이 아니라 **읽는 단위를 담당 범위에 맞추는 것**이다.

## 크기 예산

| 대상 | 예산 | 초과 시 |
|---|---|---|
| 절 파일 1개 | 15KB | 더 작은 축으로 재분할 |
| `INDEX.md` | 5KB | 요약 표만 남기고 서술 제거 |
| 단일 파일 산출물(미분할) | 20KB | 분할 필수 |

`INDEX.md`는 목차이지 요약본이 아니다. 절 본문을 INDEX에 중복 기재하지 않는다.

## 분할 트리거

산출물이 **20KB를 넘거나** 절 개수가 **8개를 넘으면** 분할한다. 그 아래면 단일 파일을 유지한다 — 소형 산출물의 분할은 오히려 파일 열람 횟수만 늘린다.

## 디렉토리 레이아웃

분할하면 단일 파일 대신 같은 이름의 디렉토리를 만든다.

```
_workspace/02_design/api-schema.md          ← 미분할 (20KB 이하)
_workspace/02_design/api-schema/            ← 분할
  INDEX.md
  auth.md
  orders.md
  common-envelope.md
```

디렉토리와 동명의 `.md`를 함께 두지 않는다. 둘 다 있으면 소비자가 어느 쪽이 authoritative인지 알 수 없다.

## 분할 축

산출물의 **소비자가 갈리는 경계**로 자른다. 소비자가 같은 절끼리는 합친다.

**Phase 2 산출물**

| 산출물 | 분할 축 |
|---|---|
| `api-schema` | 엔티티/리소스별 + 공통 envelope·에러 1개 |
| `design-system` | 토큰 / 컴포넌트 인벤토리 / 접근성 |
| `component-spec` | FSD 레이어별(shared / features / widgets·pages) |
| `layout-spec` | 글로벌 레이아웃·라우팅 맵 / 페이지별 |
| `state-contract` | aggregate별 + 공통 persistence·verification 1개 |

**Phase 1 산출물** — 재읽기 규모가 Phase 2보다 **크다**. 실측(당시 96개 agent prompt 전수 집계 — 2026-08-26/27 통합으로 현재는 46개이며 재측정 전이다)에서 `tech-stack`은 18개, `requirements`는 13개 에이전트가 입력으로 읽는데, 초기 계약은 Phase 2만 다뤄 가장 많이 재읽히는 두 파일이 규칙 밖에 있었다.

| 산출물 | 분할 축 | 주요 소비자 경계 |
|---|---|---|
| `planning-context` | Product Frame·Evidence / UX 리스크·상태 / 디자인 방향 intake / 데이터·규모 전략 / 미결정 / Planning Memo | 디자인 방향은 design-system-architect·ux-researcher만, 미결정·Memo는 전체 (실측: search-portal 파일럿 10섹션 발화) |
| `tech-stack` | 의존성·버전 매트릭스 / 아키텍처 결정(ADR) / 배포·provider target / 테스트 전략 | scaffolder는 버전만, designer는 결정만, CI writer는 배포만 |
| `requirements` | 기능 REQ(도메인별) / 비기능 NFR / 상태·엣지 시나리오 | feature-planner는 기능, performance-budget-designer는 NFR, state-contract-designer는 시나리오 |
| `ux-brief` | 화면 인벤토리·상태 matrix / 사용자 플로우 / 디자인 방향 | layout-designer는 인벤토리, design-system-architect는 방향 |
| `feature-plan` | Feature List 표 / slice·command 매핑 / 데이터 모델 | 표만 필요한 소비자가 다수 |
| `decision-log` | **ID 구간별**(`PC-001~050`, `PC-051~100` …) — append는 최신 절에만 | append-only 대장이므로 주제별로 자르면 이력 추적이 깨진다 |

`project-brief`는 이미 다른 산출물의 요약·연결 문서다. 20KB를 넘으면 분할하기보다 **원본을 가리키고 본문을 줄인다** — 요약이 원본만큼 커지면 요약이 아니다.

## 코드 블록 분리

Phase 2 산출물의 코드 블록은 Phase 3 builder 전용 재료이고 설계 판단에는 쓰이지 않는다. **80줄을 넘는 코드 블록은 절 본문에 두지 않고 형제 파일로 분리한다.**

```
_workspace/02_design/design-system/
  tokens.md            ← 토큰 표 + "구현 코드: theme.code.ts"
  theme.code.ts        ← MUI createTheme 코드 전문
```

- 파일명은 `{목적}.code.{확장자}`
- 절 본문에는 파일 경로와 한 줄 용도만 남긴다
- 이 파일은 설계 문서이지 소스가 아니다. Phase 3의 담당 builder가 `src/`의 실제 경로로 옮겨 생성한다
- 80줄 이하 코드는 분리하지 않고 절 본문에 둔다 — 분리 비용이 절감보다 크다

## INDEX.md 형식

```markdown
# {산출물명} — {서비스명}

## 절 목록
| 절 | 파일 | 담당 범위 | 주 소비자 |
|---|---|---|---|
| 공통 envelope | `common-envelope.md` | 응답 형식, 에러 코드, 페이지네이션 | 전체 |
| 주문 | `orders.md` | `/api/orders/*` 5개 엔드포인트 | developer, developer |

## 전역 결정
절 하나에 귀속되지 않는 결정만 3~5줄로 기재한다.

## Assumptions and Blockers
```

`주 소비자` 열은 소비자가 자기 절을 고르는 근거다. 비워 두지 않는다. 값은 **에이전트
이름 그대로**(한정어가 필요하면 괄호로 — 예: `developer (shared layer)`) 또는
전체-소비 sentinel(`전체` / 중립 표기 `*` / `all`)이다. 검증기는 절 행을 **구조**(2열의
백틱 절 파일)로 식별하므로 표 헤더 표기는 언어 자유다(`주 소비자`든 `Primary consumer`든).

## 소비자 읽기 프로토콜 <!-- marker:consumer-read-protocol -->

산출물을 입력으로 읽는 모든 에이전트는 다음 순서를 따른다.

1. `{name}/INDEX.md`가 있으면 **INDEX를 먼저 읽는다**
2. INDEX의 `주 소비자`와 `담당 범위`로 자기에게 필요한 절을 고른다
3. 고른 절 파일 + `담당 범위: 전체`인 공통 절만 읽는다
4. `{name}/`이 없으면 기존 `{name}.md` 단일 파일을 읽는다 — 분할 이전 산출물과의 하위호환

절을 고르기 애매하면 더 읽는 쪽을 택한다. 설계 정보 누락은 토큰 절감보다 비용이 크다.

## 검증 (기계 강제)

```bash
node .claude/scripts/validate-artifact-sharding.mjs --project {project-root}
```

exit 1이면 계약 위반이다. 이 검사는 아래 4항목을 측정한다 — **KB 예산을 산문으로만 두면 지켜지지 않는다**(도입 초기에 이 측정기가 없어 실제 생성물의 `component-spec.md`가 58KB, `design-system.md`가 58KB까지 분할 없이 자랐다).

- 절 파일·INDEX·미분할 단일 파일이 예산을 넘지 않는가 (절 개수 트리거 포함 — 단
  project-brief는 분할 금지 문서라 절 개수 트리거를 적용하지 않고, KB 초과 시 "분할"이
  아니라 "축소" 지시를 낸다)
- `INDEX.md`의 모든 절 파일이 실제로 존재하는가 (역도 성립)
- 디렉토리와 동명 `.md`가 공존하지 않는가
- 각 절의 소비자 열이 실제 에이전트 이름 또는 sentinel(`전체`/`*`/`all`)인가 — 빈 칸·미상
  이름·절 행 0건(형식 이탈)은 **위반**이다(warn에서 승격, M1 ③ — warning은 게이트가 아니라
  장식이었고, 영어 헤더 INDEX에서 헤더를 값으로 오인하는 마커 락인도 함께 제거)

`INDEX.md`가 없는 디렉토리는 분할 산출물이 아니라 **토픽 폴더**(기능별로 독립 산출물을 묶은 것)로 취급하고 그 안의 파일을 각각 검사한다.

Wave 완료 시 이 명령을 실행하고, 위반이 있으면 해당 designer를 다시 실행해 분할한 뒤 다음 Phase로 넘어간다.
