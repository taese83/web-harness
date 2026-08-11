# Design Principles — Interaction & Controls (인터랙션·입력 컨트롤)

입력 컨트롤 선택, 폼 설계, 피드백, 로딩 상태, 모달/드로어, 모션, 드래그앤드롭, hover/focus의 규칙이다.

## 입력 컨트롤 선택 매트릭스

**Slider vs Number Input vs Stepper**
- 정확한 값이 목표면 **slider 금지 → number input** — 정밀 slider 조작은 높은 motor skill을 요구하고 터치에서는 현실적으로 불가능 (NN/g). slider는 "대략적 값이면 충분"할 때만(볼륨·밝기).
- slider를 쓸 때는 **항상 편집 가능한 숫자 입력 병기** (slider + editable number). 예: 가격 필터 = range slider + min/max input.
- **stepper는 작은 범위(±10 이내) 1~2 단위 미세 조정에만** — 큰 범위를 stepper로 이동시키면 클릭 지옥. 예: 수량(1~99).

**Radio vs Select vs Segmented**
- **2~5개 = radio(또는 segmented), 6개+ = select, 15개+ = 검색형 combobox** — 5개 미만은 전부 노출하는 것이 스캔·비교가 빠르다 (NN/g).
- segmented control은 상호 배타적 view/모드 전환에, 최대 5개, 짧고 균등한 라벨 (HIG).

**Checkbox vs Toggle Switch**
- **즉시 적용이면 switch, Save/Submit 폼이면 checkbox** — switch는 물리 스위치 은유라 즉시 효과를 기대한다. switch를 Save 버튼과 같이 쓰지 말 것 (NN/g). 다중 선택은 항상 checkbox.

**Date Picker**
- **달력 picker를 쓰더라도 항상 직접 타이핑 허용** — 먼 과거/미래(생년월일)는 달력 내비가 타이핑보다 훨씬 느리다. 달력은 "1년 이내 가까운 날짜"와 "범위 선택(체크인~체크아웃, 두 달 나란히)"에서만 우위 (NN/g).

## 폼 설계

- **단일 컬럼** — 다중 컬럼 대비 평균 15.4초 빠른 완료 (CXL), 시선 분산으로 필드 건너뜀 유발 (Baymard). 예외: 도시/우편번호처럼 논리적 한 묶음의 짧은 필드.
- **라벨은 top-aligned** — 시선이 위→아래 한 줄로 흐르고 모바일·번역에 안전.
- **placeholder를 라벨 대신 쓰지 않는다** — 입력 시작하면 사라져 단기기억 부담, 에러 검토 불가, "이미 채워진 것"으로 오인 (NN/g). 형식 힌트는 필드 밖 helper text로.
- **validation은 blur 후 실행, 입력 도중 에러 표시 금지** — "완료 후" 인라인 검증이 성공률 22%↑, 완료 시간 42%↓ (Wroblewski). 단, 에러 상태에서 재입력 중에는 실시간으로 해소를 표시 (reward early, punish late).
- **에러 메시지**: ① 해당 필드 옆 인라인 ② 무엇이 왜 잘못됐는지 ③ 어떻게 고치는지. "Invalid input" 금지. 제출 시 에러 요약 + 첫 에러 필드로 포커스 이동. 입력값은 절대 지우지 않는다. 예: "비밀번호는 8자 이상, 숫자 1개를 포함해야 합니다".
- **필수 필드는 라벨에 * 표시** (+ 상단에 의미 설명). 대부분 필수인 폼은 반전 — "(선택)"만 표기. `required`/aria 병행.

## 피드백

- **모든 클릭/탭에 100ms 이내 시각 반응** (pressed 상태) — 서버 응답과 무관한 UI 반응. 넘기면 직접 조작감이 깨지고 재클릭(중복 제출)을 유발한다 (Nielsen response times).
- **optimistic update는 성공 확률 높고 복구 쉬운 작업에만** — 좋아요·팔로우·순서 변경·이름 수정. 결제·삭제·복잡한 서버 검증은 honest loading. 실패 시 반드시 롤백 + 명시적 알림(조용한 되돌림 금지).
- **알림 채널 선택**: 확인만 하면 되는 성공 = toast(3~5초 소멸) / 반드시 보고 행동해야 함 = 인라인 메시지·배너(지속) / 즉시 결정 필요한 차단 질문 = dialog. **폼 검증 실패·치명적 에러를 toast로 흘리지 않는다.**
- **되돌릴 수 있는 액션은 confirm 대신 undo** — confirm 남발은 습관적 확인 클릭을 만든다. 예: 보관 처리 = 즉시 실행 + "실행 취소" toast(Gmail), 영구 삭제 = 이름 입력 confirm.

## 로딩 상태

- **~1초 미만 = 인디케이터 없음**(100ms 지연 후 표시 시작 — 깜빡임 방지) / **1~10초 = 스켈레톤·스피너** / **10초+ = 진행률 + 취소 수단** (Nielsen 0.1/1/10초).
- **콘텐츠 영역은 스켈레톤 우선, 스피너는 구조를 예측할 수 없는 짧은 작업(버튼 내 로딩)에** — 스켈레톤은 올 콘텐츠에 주의를 돌려 체감 대기 감소.
- **스켈레톤은 실제 콘텐츠와 동일한 크기/위치 → layout shift(CLS) 제로** — 이미지에 고정 aspect-ratio 예약.

## 모달 vs 인라인 vs 드로어

- **기본값은 인라인. 원래 화면을 참조해야 하는 작업 = drawer. 완전히 멈춰 세워야 하는 짧고 집중된 작업만 modal** — modal은 컨텍스트를 가리는 가장 남용되는 패턴 (NN/g). 예: 필터 상세 = drawer(결과를 보면서 조정), 셀 편집 = 인라인, 삭제 확인 = modal.
- **중첩 modal 금지** — 필요해졌다면 그 작업은 modal에 담기에 너무 크다는 신호 → 전용 페이지나 drawer로 승격.
- **modal 닫기 수단 3종**: X 버튼, Esc, (파괴적 확인이 아니면) 바깥 클릭. 열릴 때 포커스를 modal 안으로, 닫힐 때 트리거로 복귀 (focus trap).

## 모션/애니메이션

- **지속시간**: 소형(버튼·토글·fade) 100~200ms / 중형(dropdown·toast) 200~300ms / 대형(modal·페이지 전환) 250~400ms. 500ms부터 "느리다", 100ms 미만은 인지 불가 (NN/g, M3 duration 토큰).
- **easing**: 진입 = ease-out(decelerate), 퇴장 = ease-in(accelerate), 화면 내 이동 = ease-in-out. linear는 색/투명도 변화 외 금지. 등장(300ms)이 퇴장(200~250ms)보다 약간 길게.
- **모션은 기능이다** — ① 공간 관계 설명(drawer가 옆에서 미끄러져 들어옴) ② 상태 변화 연결(삭제 시 collapse) ③ 주의 유도. 셋에 해당하지 않는 모션은 삭제 후보.
- **`prefers-reduced-motion: reduce`에서 이동·확대·시차 모션 제거** (opacity fade로 대체) — WCAG 2.3.3, 전정기관 장애 대응.
- 예: `transition: transform 250ms cubic-bezier(0, 0, 0.2, 1)` (진입).

## 드래그앤드롭

- **드래그 가능함을 명시적으로 표시** — 핸들 아이콘(⠿) + `cursor: grab`. "시험해보게" 만들지 않는다.
- **드래그 중 상태 전부 시각화** — 들린 항목(그림자/반투명), 유효한 드롭 대상(하이라이트), 삽입 위치(placeholder 라인).
- **키보드 대체 수단 필수** — 핸들 Tab 포커스, Space/Enter 집기·놓기, 화살표 이동, Esc 취소 + 스크린리더 위치 안내. 또는 "위로/아래로 이동" 메뉴 병행.
- **드롭 직후 결과 확정 표시**(하이라이트 플래시) + undo. 실패 시 원위치 애니메이션 복귀.

## Hover / Focus 상태

- **hover에는 보조 정보만** — 필수 정보·핵심 액션을 hover 뒤에 숨기지 않는다. 터치에는 hover가 없다. `@media (hover: hover)` 분기.
- **hover로 뜨는 콘텐츠(WCAG 1.4.13)**: dismissable(Esc) · hoverable(콘텐츠 위로 이동 가능) · persistent.
- **포커스 링은 `:focus-visible`에** — 키보드 탐색 시만 표시. `outline: none` 후 대체 없음 금지. 인접 색과 3:1 대비, 2px 두께 권장. 예: `:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }`.
- **모든 인터랙티브 요소는 5개 상태 정의**: default / hover / active / focus-visible / disabled.

## 빠른 결정 요약표

| 상황 | 선택 |
|---|---|
| 정확한 숫자 필요 | number input (slider 금지) |
| 옵션 2~5 / 6+ / 15+ | radio·segmented / select / 검색 combobox |
| 즉시 적용 / 폼 제출 | switch / checkbox |
| 먼 날짜 / 가까운 날짜·범위 | 타이핑 / calendar + 타이핑 병행 |
| <1s / 1~10s / >10s 로딩 | 없음 / 스켈레톤·스피너 / progress + 취소 |
| 되돌릴 수 있음 / 없음 | 즉시 실행 + undo / confirm dialog |
| 컨텍스트 참조 / 완전 차단 | drawer·인라인 / modal (중첩 금지) |
| 모션 소형 / 대형 | 100~200ms / 250~400ms, 진입 ease-out·퇴장 ease-in |

## 출처

NN/g (slider, listbox vs dropdown, toggle switch, date input, placeholder, required fields, response times, error messages, confirmation dialog, modal/nonmodal, animation duration, drag-and-drop) · Wroblewski inline validation (A List Apart) · CXL/Baymard 폼 연구 · Material 3 easing/duration · Apple HIG segmented controls · WCAG 1.4.13/2.3.3/2.4.7
