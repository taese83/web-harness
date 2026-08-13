# Protected Core — 하네스가 지켜야 하는 것 (판단 계층의 canonical)

형식 게이트(validate-harness)는 **필요조건**이다. 이 문서는 그 위의 판단 계층이 보호하는
불변식을 서열화하고, 변경 클래스별 판단 질문과 증거 형식을 고정한다. 소비자: 루트 `CLAUDE.md`
판단 게이트(모든 AI 세션에 로드), `harness-change-reviewer` 에이전트, `validate-contract-hygiene.mjs`
(기계 앵커). 이 문서 자체의 부재는 validate가 fail한다.

## 0. 원칙 — 판단은 기계화되지 않는다, 그러나 강제된다

"과적합인가", "2번째 서비스에도 성립하는가"를 grep으로 판정할 수 없다. 기계가 강제하는 것은
**판단이 실제로 일어났고, 반증 가능한 형태로 기록됐는가**다. 진실성 검증은 fixture·CI 증명이
따라와야 완성된다(주장≠증명 — I1).

## 1. 보호 불변식 (서열 — 충돌 시 위가 이긴다)

- **I1 · 증거의 진실성.** green은 실제 실행 근거가 있을 때만 green이다. 로컬에서 서명 증거를
  위조하지 않는다. 증명 없는 `certified`를 주장하지 않는다(tier 정직). "닫았다"와 "닫는 시늉"을
  구분해 보고한다.
- **I2 · 게이트 강도.** 통과율을 위해 검증을 약화하지 않는다. 골든/생성물이 게이트에 막히면
  그 지점이 곧 결함이다 — 게이트가 아니라 모델링을 고친다.
- **I3 · 일반화.** 계약은 부류(class) 역량이다. 특정 서비스의 이름·백엔드·고정 수치·사고모델을
  인코딩하지 않는다. 기준: **서로 다른 서비스 형태 2개 이상**에 성립함을 명시하고, 참조 서비스는
  eval fixture로만 등장한다.
- **I4 · 고정 비용 예산.** always-read·CLAUDE.md·미러 표면(×3 복제)은 예산이다. 추가 전에 제거를
  먼저 검토한다. 예산 갱신은 의식적 행위(baseline 편집 + JUDGMENT 기록)여야 한다.
- **I5 · 프록시 ≠ 품질.** 게이트가 프록시(줄 수·개수·패턴)라면, 프록시를 우회해 "통과"만 만드는
  것은 통과가 아니라 위반이다. 알려진 프록시는 §4에 등록하고, 우회 발견 시 그 사례를 등록부에
  추가한다.
- **I6 · 안전 하한.** 접근성·보안·receipt 게이트는 fast-path에서도 생략 불가. 줄이는 것은
  세리머니뿐이다.

## 2. 변경 클래스별 판단 질문 (커밋 전 — 증거로 답한다)

**모든 변경 공통**: I1(주장/증명 구분), I2(게이트 약화 없음), I5(프록시 우회 없음).

| 클래스 | 추가 질문 | 요구 증거 |
|---|---|---|
| 계약 신설/확장 | I3: 서로 다른 서비스 형태 2개+에 성립하는가? 한 서비스를 역설계하지 않았는가? | 계약 내 `## 일반화 근거` 섹션(형태 2개+ 명명, fixture 검증 여부 명시) — 기계 강제 |
| always-read/SKILL 변경 | I4: 고정 로드가 늘었는가? 조건부로 강등 가능한가? | baseline 대비 증감. 성장 시 baseline 갱신 + JUDGMENT 사유 — 기계 강제 |
| 게이트/validator 변경 | I2: 무엇이 느슨해지는가? G2: 오탐이 정당한 기존 스킬을 잡는가? | 실제 트리에서 오탐 0 실행 로그 + 의도 회귀(seed) 탐지 로그 |
| 스킬/에이전트 신설 | I4: 미러 ×3 유지비 정당한가? 기존과 중복인가? | 기존 대안 검토 1줄 + README 인벤토리 갱신 |
| fast-path/세리머니 축소 | I6: 안전 하한이 남는가? | 유지되는 게이트 목록 명시 |
| tier/supportLevel 변경 | I1: 라벨이 증거와 일치하는가? | 근거 receipt/golden 링크 |

**기록 형식**: 커밋 본문에 `JUDGMENT:` 블록으로 해당 질문의 답을 1–3줄로 남긴다. 실질 변경
(계약·게이트·스킬/에이전트)은 read-only `harness-change-reviewer`를 먼저 실행하고 결과를 반영한다.

## 3. 예산 (기계 강제 — contract-hygiene)

- 루트 `CLAUDE.md` ≤ 60줄(판단 게이트 마커 `harness-judgment-gate` 필수·삭제 시 fail).
- 스킬별 always-read: `contract-hygiene-baseline.json`의 실측이 상한(ratchet — 성장만 fail).
  미등록 신규 스킬 기본 상한 8.
- baseline 밖 신규 reference 계약: `## 일반화 근거` + 형태 2개+ 필수.

## 4. 알려진 프록시 등록부 (I5 — 정직한 한계 명세)

| 프록시 | 한계 | 우회 사례(실제) | 대응 |
|---|---|---|---|
| 스크립트 400줄 제한 | 줄 수 ≠ 복잡도 | import 세미콜론-병합으로 399줄 맞춤(기존 관행 + 2026-08 세션도 동일 우회) | 병합으로 줄이지 말 것. 실질 해소는 validator 모듈 추출 — 미해결 TODO |
| always-read 카운터 | `항상…읽는다` 한국어 마커의 첫 문장만 집계 — 영어 서술("Read X before…")·조건부 읽기는 미집계 | — | 성장 ratchet 용도로만 사용. 총 로드비용의 진실은 미보장 |
| 일반화 근거 섹션 | 존재·형태만 검사, **진실은 미검증** | — | fixture/2번째 서비스 검증 전까지 해당 계약은 "명명 수준" — 계약에 자기 표기 |
| 골든 5/7 로컬 green | e2e·서명 attestation 없는 로컬 증명은 폐곡선 아님 | — | CI 활성화 전 "certified(증명)" 주장 금지 |
| maturity의 eval-언급 검사 | 시나리오 파일 내 스킬명 **언급**은 커버의 필요조건일 뿐 — 형식적 시나리오로 라벨만 승격 가능 | — | 승격용 시나리오는 신설 계약의 실질 assertion을 담아야 하며, 최종 진실은 시나리오 *실행* 결과다 |
| anchorReceipt(live-delta 승인) | 존재·형식(한 줄 ≤300자)만 검사 — 자유 텍스트 self-attestation이며 라이브 서버·앵커 실검증을 자동 보장하지 않음 | — | receipt에 매칭 수·확인 URL·시점을 기록할 의무는 계약 몫. 실검증 자동화(브라우저 앵커 카운트 수집)는 미해결 TODO |
| preview render-source 마커 스캔 | 파일 내 **문자열 포함**만 검사 — 해당 파일이 실제 로드·실행되는지 미보장(decoy 파일로 우회 가능) | — | .mjs 포함은 delta 모드에 한정. 실질 진실은 브라우저에서의 앵커 렌더 확인(TC 검증) 몫 |
| 콘솔 frame-src loopback 와일드카드 | 열거식 CSP는 동적 프록시 포트가 문서 로드 후 배정되는 구조적 경합이 있어 `127.0.0.1:*`로 완화(2026-08-10) — DOM-XSS에 대한 심층방어 폭이 loopback 전 포트로 넓어짐 | — | iframe src는 서버 계산 값만, 신뢰 경계는 postMessage origin 엄격 검증 + 프록시 대상은 launch.json 포트 allowlist. script-src 'self'·frame-ancestors 'none' 유지 |
| targetless 승인의 구조화 범위 self-report | 대상 없는 CR(기획 초안) 승인의 affectedFeatureIds는 apply 결과의 자기보고 — "그 FEAT를 정말 이번 apply가 신설했는가"는 미검증(승격 후 canonical 존재만 확인) | 파일럿(2026-08-11): apply가 기존 plan 재작성으로 승인 TC 파괴 — 존재 검사로는 미탐 | **2026-08-12 부분 해소**: `validate-plan-delta.mjs`가 변경 전 안정 ID 인벤토리를 기계로 뜨고(자기선언 아님) 적용 후 선언과 대조해 `UNDECLARED_REMOVAL`로 잡는다 — 실제 파일럿 데이터에서 TC 3건 소멸을 재현·검출 확인. `modified` 선언으로 소멸을 덮을 수 없다. 순서 우회(사고 후 스냅샷으로 before 오염)는 승인 레코드의 `affectedTestCaseIds`를 바닥값으로 삼아 `LATE_SNAPSHOT`으로 차단하고, **delta 파일 삭제 후 재스냅샷**은 delta 바깥 append-only 원장(`.plan-snapshots.jsonl`)의 최초 digest와 대조해 `RESNAPSHOT`으로 거부(exit 2) — 둘 다 실측 확인. 이 우회는 resume-manifest planLock에서 이미 겪은 것과 **같은 클래스**였고(리뷰 지적), 같은 해법(증거를 변경 대상 바깥으로)을 재적용했다. **남는 한계**: 원장까지 지우면 초기화된다(tamper-evident이지 tamper-proof 아님). **스냅샷이 정말 변경 *전*에 찍혔는지는 기계가 알 수 없다** — mtime·git 경계 어느 것도 검증하지 않으며, 승인 레코드가 있는 경우에만 `LATE_SNAPSHOT` 바닥값이 작동한다. 즉 이 게이트는 선언 *내용*의 자기진술은 풀었으나 선언 *시점*의 자기진술은 부분적으로만 풀었다. 선언 자체가 옳은지는 미검증이고, ID가 유지된 채 **내용만** 파괴되는 경우는 못 잡는다 — 그건 여전히 인간의 절 보존 확인 몫(runbook 2단계). 라인 diff 렌더(후속 8)로 확인 비용 축소 예정 |
| 구현 검증 증거(implementation receipt) | 존재·형식(승인 TC 부분집합·한 줄 ≤300자)만 검사 — 자유 텍스트 self-attestation이며 테스트가 실제로 실행·통과했는지 자동 보장하지 않음 | — | 증거에 명령·통과 요약·시점 기록 의무는 계약 몫(runbook). 테스트 러너 연동 자동 수집은 미해결 TODO |
| 완결성 게이트 무산출 가드 | "owned 범위에 파일 0개=미완성"은 실제 신호이나, "파일 있음=완성"은 truncation/의미결함까지 보장 못 함. `--allow-no-output`은 self-attestation opt-in(오케스트레이터가 오탐 회피용으로 남용 가능) | 초기 구현이 scannable(.ts/.js) 확장자만 세어 비-code 산출물(.md/.json/.yml) 스폰을 오탐 FAIL — anyFilePresent(확장자 무관)로 수정(2026-08-11) | 무산출은 anyFilePresent로 판정, truncation은 별도 스캔, 의미결함은 typecheck 몫. --allow-no-output 남용은 리뷰에서 확인 |
| tech-advisor 버전 pin | 이전엔 install 전까지 자기진술 프록시(§ 위 "일반화 근거"와 성격 유사) — "웹 리서치 교차확인" 주장이 실재 registry와 불일치 가능 | seminar-booking 실증: TS 6.0.0(존재하지 않는 버전) + typescript-eslint↔TS7 peer 비호환(install/lockfile은 WARN만) | **기계검사로 승격(2026-08-11)**: `validate-dependency-pins.mjs`가 존재성+peer 호환을 install 전 검사(Tessl 착안). 단 registry 없는 환경이면 self-attestation으로 강등(install 시점 검증에 위임), 파싱 불가 범위는 미검사 |
| 재개 매니페스트 outputs 자기선언 | `resume-manifest.mjs`의 remaining은 "선언된 outputs의 존재+비-truncation"만 본다 — **선언 자체가 완결 범위를 다 담았는지는 미보장**. 2026-08-12 부분 해소: **사후 축소**(빌더 사망 후 매니페스트를 실제 쓰인 파일에 맞춰 줄여 COMPLETE 위조)는 계획 잠금으로 차단됐고, **선언 밖 산출물**은 owned 교차검증으로 보고된다. **그러나 처음부터 적게 선언한 경우(초기 과소 선언)는 여전히 미탐** — "무엇이 필요했는가"의 진실은 스펙에 있지 파일시스템에도 digest에도 없다 | 실측 재현(2026-08-12): 잠금 전에는 outputs 3→1 축소가 `COMPLETE exit=0`으로 통과, 잠금 후 `INVALID exit=1`. **잠금을 매니페스트 안에만 두자 두 우회가 실측으로 뚫림** — `planLock` 삭제(→unlocked, exit 0) · 축소 후 재잠금(→새 digest, exit 0). 증거를 매니페스트 바깥 append-only 원장으로 옮겨 둘 다 차단(최초 항목과 대조, 재잠금은 `relocked`로 노출) | `validate-spawn-plan --lock`이 FITS일 때만 계획 digest를 박고(REFUSE된 계획은 잠그지 않음), `resume-manifest`가 대조해 TAMPERED면 remaining이 비어도 exit 1(fail-closed). 잠금 없으면 "검증되지 않은 자기선언"으로 정직 보고. 증거는 매니페스트 바깥 append-only 원장(`.plan-locks.jsonl`)에 두어 파일 내 잠금의 두 우회를 차단하고, `--lock`은 다른 digest의 잠금이 있으면 **재잠금을 거부**(exit 2, 사전 차단). 단 **원장과 planLock을 둘 다 지운 뒤 재잠금하면 위조가 성립하며, 그 결과는 정직한 `unlocked`가 아니라 위조된 `locked`다**(증거 전부 파기 시 최초 잠금과 기계적 구분 불가 — 리뷰 지적으로 정밀화). tamper-evident이지 tamper-proof 아님; 이 경로는 CLAUDE.md 비협상 규칙이 금지한다. **초기 과소 선언은 계약 몫으로 남음**. 의미결함은 여전히 typecheck 몫 |
| 산출물 언어 검사 | `validate-output-language.mjs`는 **마크다운 헤딩만** 본다 — 본문·표·코드펜스는 검사하지 않는다(샘플 데이터·고유명사로 한글이 정당하게 들어가 오탐이 크기 때문). 즉 헤딩만 영어이고 본문이 한국어여도 PASS가 난다. 검사는 **단방향**(en 선언에 한글 헤딩 금지)이라 ko 선언의 품질은 보장하지 않는다. `outputLanguage` 자체는 오케스트레이터의 자기선언이며, 요청 언어를 옳게 판별했는지는 미검증 | 실측(2026-08-12): seminar-booking을 `outputLanguage: en`으로 선언하면 한글 헤딩 **236건** 검출 — 게이트가 실제 산출물에서 작동함을 확인 | **미선언은 통과가 아니라 `UNDECLARED`(검사 미수행)로 보고**해 "영어 지원"이 조용한 통과로 성립하지 않게 한다. 헤딩 밖 본문 언어까지 보는 것은 오탐 비용이 커서 미해결 TODO — 실질 품질은 산출물을 읽는 사람 몫 |
| 계약 마커의 자연어 의존 | validator 다수가 **한국어 문자열 자체**를 마커로 썼다(`항상…읽는다`, `## 일반화 근거`, `미구현`, `대상 화면/기능` 등). 본문을 영어로 옮기면 매칭 실패 → 마커 0건 → **조용히 통과**로 게이트가 장식이 된다(번역이 게이트를 끄는데 CI는 green) | 실측(2026-08-12): 한국어는 SOV라 `항상 … 읽는다`가 always-read 목록을 감싸 조건부 읽기와 구분되지만, 영어는 SVO라 그 경계가 없다 — seed에서 lazy 매칭은 참조 0건(MARKER_LOST 오탐), 전방 윈도우는 조건부 참조까지 삼켜 과대계수(3 > baseline 2) | 한국어·영어·중립 앵커를 모두 인식하되, **baseline이 마커 존재를 전제하는데 사라지면 MARKER_LOST로 FAIL**(vacuous pass 차단). 번역 시 정확한 경계가 필요한 곳은 자연어가 아니라 중립 앵커 `<!-- always-read --> … <!-- /always-read -->`를 **필수**로 쓴다. 영어 자연어 매칭은 best-effort이며 틀릴 때 과대계수(FAIL) 쪽으로 틀리므로 저자가 앵커로 옮기게 된다 |
| fit 게이트 임계 완화 옵션 | `--max-outputs`/`--max-read-tokens`는 게이트 자신을 느슨하게 만드는 통로다 — 계약은 "완화는 의식적 행위, 사유를 남긴다"고 요구하지만 **사유 기록을 기계로 강제하지 않는다**(산문 의무) | 초기 등록 시 상한이 없어 `--max-outputs 9999999`로 게이트를 사실상 무력화 가능했음 — 리뷰 지적으로 bash 정책에 상한 도입(2026-08-11) | bash 정책이 상한 강제(outputs ≤32, read ≤200k tokens)로 **완전 무력화는 차단**. 그 아래 구간의 완화는 여전히 자기진술 — 남용은 리뷰에서 확인. 매니페스트 `overrideReason` 필드 강제는 미해결 TODO |
| fit 게이트 readMode(injected) | `"readMode": "injected"`는 "발췌를 주입했고 재독을 금지했다"는 **자기진술**이다 — 실제로 주입했는지 게이트가 확인하지 않는다. injected면 reads를 문자 그대로 재므로 측정치가 8배 가까이 작아진다(seminar-booking 실측: 23.4k→2.8k) — 즉 이 한 필드로 게이트를 크게 느슨하게 만들 수 있다. 또한 이 하네스에서 **최초로 CLI 인자가 아닌 파일 내용에 사는 self-attestation**이라, 호출 명령줄만으로는 injected 여부가 안 보인다(실행 출력에는 `readMode=`로 항상 노출됨) | 재구성 실험(2026-08-11, seminar-booking): 좁은 선언 4건 중 1건만 REFUSE / 넓은 선언 4건 전부 REFUSE — **선언 방식이 효능을 지배함이 실측됨** | 미지정·오타는 `browse`로 fail-safe(느슨한 쪽으로 기울지 않음, 테스트로 고정). browse는 파일 선언을 상위 디렉터리로 전개해 측정을 약 8배 조인다. **단 그 조인 값도 임계 미만이라 실측 4건은 여전히 미탐** — 아래 행의 결과 수준 진실 참조. injected 사용 시 발췌 근거 포인터(주입 절 제목·해시)를 매니페스트에 요구하는 강화는 `overrideReason`과 묶어 미해결 TODO |
| 스폰 사전 fit 게이트 reads 선언 | `validate-spawn-plan.mjs`는 **선언된 `reads` 범위**의 바이트만 잰다 — 선언에서 누락한 스펙은 계산되지 않고, 빌더가 선언 밖을 읽으면 FITS를 받고도 runaway가 난다. 토큰 수는 바이트 기반 **추정**(ASCII/4 + 비-ASCII/3)이지 토크나이저 실측이 아니다. 임계(8 outputs · 60k tokens)는 단일 서비스 실측에서 뽑은 값이라 형태가 다른 서비스에서 재교정 필요 | — | 산문 규칙(자기진술) 대비 강화점: 선언이 아티팩트로 남고, `reads`에 디렉터리를 적으면 하위 전체가 전개돼 과소 신고가 어렵고, 사후 `resume-manifest`와 **같은 매니페스트**를 공유해 교차 확인이 가능하다. 교정 근거: 실측 폭주(seminar-booking client-domain-state-builder)를 넣으면 162k 추정 → REFUSE(실측 소비 168k, telemetry 원본). **미실증: 이 게이트가 실제 runaway 발생률을 낮추는지는 Phase 3 재실행으로 측정 전이다** — 지금 있는 것은 교정 증거이지 효능 증거가 아니다. **결과 수준 진실(2026-08-11 재구성 실측 / 빈도는 2026-08-12 telemetry로 정정 — 실제 미완은 22스폰 중 3건, 토큰 15%): 재구성한 베이스라인 계획 6건 중 선언과 무관하게 걸리는 것은 OUTPUT_FANOUT 2건뿐이고, 나머지 4건은 browse 기본값 적용 후에도 10.9k~23.4k로 임계 60k 미만이라 미탐이다** — 잡으려면 사람이 정직하게 넓은 reads를 선언해야 한다. 오탐은 반대로 확인됨(정당하게 좁은 스폰 5건 전부 FITS, 오탐 0). 또한 browse의 상위 디렉터리 전개는 **산출물 디렉터리 단위**라 artifact-sharding의 소비자 경계와 어긋날 수 있다(단일 aggregate만 필요한 빌더도 같은 산출물의 다른 샤드까지 합산) — 현 규모에선 오탐 0이나 샤드가 훨씬 큰 프로젝트에선 재확인 필요 |

## 5. 이 문서의 갱신

판단 질문·예산·프록시 등록부의 변경 자체가 "게이트/validator 변경" 클래스다 — 같은 게이트를
거친다. 등록부에서 행을 지우려면 해당 프록시가 실질 검증으로 대체됐다는 증거가 필요하다.
