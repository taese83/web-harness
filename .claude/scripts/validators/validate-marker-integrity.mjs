// validate-marker-integrity.mjs — 언어 중립 마커 무결성 게이트 (M1, protected-core I2·I3·I5).
//
// 목적: 기계 매칭되는 계약 마커가 번역·리팩터로 조용히 사라지는 것을 막는다.
// contract-hygiene의 MARKER_LOST(always-read 전용)를 전체 마커 레지스트리로 일반화한다.
// 규칙: 각 등록 마커의 현재 출현 수가 baseline **미만**이면 FAIL(부분·전체 손실 모두 포착).
//       의식적 축소는 --update로만 baseline을 낮춘다(CLAUDE.md 판단 게이트를 거친다).
//
// 왜 필요한가(docs/marker-delock-plan.md): 오픈·영어화에서 계약 산문을 번역하면 한국어
// 문자열에 의존하던 매칭이 **매칭 실패 → 마커 0건 → 조용히 통과**로 무력화된다
// (docs/protected-core.md §4). 마커를 언어 중립 앵커로 승격하기 **전에**, 이 게이트가
// "마커가 사라지면 CI가 빨개진다"는 안전망을 먼저 깐다. 앵커화(marker-delock-plan §5-3·4)가
// 진행되면 각 마커의 pattern을 앵커로 교체하고 validate-harness의 인라인 문자열 체크를 이
// 레지스트리로 이관한다 — 중복이 아니라 흩어진 검사의 통합이다(I4).
//
// 스코프: .claude/scripts 하위. (×3 미러는 2026-08-18 제거 — 이 게이트가 지키는 표면은 .claude/ 원본뿐.)

import {existsSync, readdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const validatorsDirectory = dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = join(validatorsDirectory, 'marker-integrity-baseline.json');

// 마커 레지스트리 — 각 항목은 기계 매칭되는 계약 마커 1개.
//   files:   repositoryRoot 기준 상대 경로. 디렉터리면 *.md 재귀, 파일이면 그 파일만.
//   pattern: 전역(/g) 정규식 — 등록 파일 전체에 걸친 출현 수를 센다.
// 새 마커 등록·앵커화는 docs/marker-delock-plan.md §5의 위험-오름차순 순서를 따른다.
export const MARKER_REGISTRY = [
  {
    id: 'consumer-read-protocol',
    label: '소비자 읽기 프로토콜 앵커 (26 agents + 샤딩 계약)',
    // M1 ③(2026-08-18)에서 한국어 문자열(`주 소비자`, baseline 30)을 언어 중립 앵커로 승격.
    // 이제 산문은 자유 번역 가능하고, 이 게이트는 앵커의 존속만 지킨다. 생성물(INDEX.md) 쪽
    // 검사는 validate-artifact-sharding.mjs가 구조 식별(2열 백틱 절 파일) + FAIL로 담당한다.
    pattern: /<!--\s*marker:consumer-read-protocol\s*-->/g,
    files: [
      '.claude/agents',
      '.claude/skills/web-orchestrator/references/artifact-sharding-contract.md',
    ],
    note: '앵커가 곧 계약 배선의 증거 — 에이전트 본문 번역·리팩터에서 이 줄이 사라지면 소비자 프로토콜 배선이 끊긴 것',
  },
  {
    id: 'immediate-write-contract',
    label: '즉시-쓰기 계약 배선 (fit-gate 리마인더 + 예산 계약 규칙 4)',
    // search-portal 파일럿 실측(2026-08-20): 무산출(읽기만 하고 산출물 0) 10건/90스폰.
    // 규칙 4는 프롬프트 산문이라 기계 강제가 불가능하다 — 대신 큰 스폰 직전에 반드시
    // 실행되는 fit-gate 출력에 리마인더를 배치했고, 이 마커는 그 배치의 존속만 지킨다.
    // 앵커가 사라지면 예방이 오케스트레이터 기억에만 의존하는 상태로 회귀한다.
    pattern: /<!--\s*marker:immediate-write-contract\s*-->/g,
    files: [
      '.claude/scripts/validate-spawn-plan.mjs',
      '.claude/skills/web-orchestrator/references/execution-budget-contract.md',
    ],
    note: '무산출 예방은 계약 산문 + 게이트 출력 리마인더의 짝으로만 성립 — 한쪽이 사라지면 배선이 끊긴다',
  },
  {
    id: 'tile-direction-gate',
    label: '방향 승인 선행 게이트 (프리뷰 전 후보 타일)',
    // 실측 배선(2026-08-20): search-portal에서 방향 기각을 프리뷰 라운드로 받아 R1 630k·R2 681k를
    // 태웠다. 타일 단계에서 받으면 후보 3종 전체가 132k다(style-tile-probe receipt). 메커니즘·계약·
    // 프로브는 이미 있었으나 **파이프라인에 배선되지 않아** 오케스트레이터 기억에만 의존했다 —
    // 이 repo의 반복 실패 형상("만들었지만 배선 안 함")이라 앵커로 고정한다.
    pattern: /<!--\s*marker:tile-direction-gate\s*-->/g,
    files: ['.claude/skills/web-orchestrator/references/design-approval-contract.md'],
    note: '앵커가 사라지면 프리뷰 직행으로 회귀 — 방향 기각 1회당 5배 비용',
  },
  {
    id: 'preview-delta-default',
    label: '프리뷰 개정 라운드의 델타 수정 기본값',
    // 실측: 전체 재생성 428k/631k/681k vs 델타 253k/134k(3~5배). 종전 계약은 "재생성만 한다"라
    // 델타를 금지에 가깝게 읽히게 했고, 싼 경로는 오케스트레이터의 임시 지시로만 존재했다.
    pattern: /<!--\s*marker:preview-delta-default\s*-->/g,
    files: ['.claude/agents/design-preview-builder.md'],
    note: '앵커가 사라지면 개정 라운드가 전체 재생성으로 회귀 — 라운드당 3~5배',
  },
  // ── 존재-류 마커 (M1 ④): validate-harness의 한국어 문장 인라인 매칭에서 이관.
  // 배치-류(코드펜스 밖 배치까지 검사하는 detect-timeseries/detect-ai-service)는
  // validate-harness의 instructionPlacementChecks에 남는다 — 이 레지스트리는 존재만 본다.
  {
    id: 'timeseries-historical-only',
    label: 'historical 전용 시계열 허용 규칙 (detection-contract)',
    // 이전: validate-harness가 `realtime은 필수 조건이 아니다` 문장을 인라인 매칭 — 번역이 곧
    // HARD FAIL이었다. 앵커 승격으로 산문 자유화. 규칙 자체가 사라지면 historical 전용
    // 대시보드 요청이 timeseries 모드를 못 받는 회귀다.
    pattern: /<!--\s*marker:timeseries-historical-only\s*-->/g,
    files: ['.claude/skills/timeseries-dashboard/references/detection-contract.md'],
    note: 'realtime을 필수로 오해하는 회귀 방지 — historical 전용도 모드 활성화',
  },
  {
    id: 'timeseries-realtime-build-order',
    label: 'realtime Mock 빌드 순서 규칙 (web-orchestrator)',
    // 이전: validate-harness가 `realtime interface 완료 후` 문장을 인라인 매칭. 규칙이 사라지면
    // TIMESERIES_MODE에서 realtime Mock이 transport interface보다 먼저 돌아가는 회귀다.
    pattern: /<!--\s*marker:timeseries-realtime-build-order\s*-->/g,
    files: ['.claude/skills/web-orchestrator/SKILL.md'],
    note: 'mock-api-builder를 realtime interface 완료 후로 미루는 순서 계약',
  },
];

const collectMarkdown = (root, out = []) => {
  if (!existsSync(root)) return out;
  if (statSync(root).isFile()) {
    // 명시적으로 등록된 **파일**은 확장자와 무관하게 스캔한다(레지스트리 주석의 계약
    // "파일이면 그 파일만" 그대로). 종전에는 `.md`가 아니면 조용히 건너뛰어, 스크립트에
    // 배치한 앵커가 보호되지 않으면서 baseline만 통과하는 침묵 공백이 있었다
    // (2026-08-20 실측: immediate-write-contract 앵커 2곳 중 .mjs 1곳 미집계).
    out.push(root);
    return out;
  }
  // 디렉터리 재귀는 **여전히 `.md`만**이다(의도적 범위 제한 — 무관한 트리·빌드 산출물을
  // 끌어들이지 않기 위함). **남는 공백(정직 표기)**: 디렉터리로 등록된 경로 하위의 비-.md
  // 파일에 앵커를 두면 집계되지 않는다(실측: `.claude/agents`에 .mjs 앵커를 두면 미집계).
  // 스크립트에 앵커를 둘 거면 위처럼 **파일 단위로 명시 등록**해야 보호된다.
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    if (statSync(path).isDirectory()) collectMarkdown(path, out);
    else if (name.endsWith('.md')) out.push(path);
  }
  return out;
};

// 한 마커의 총 출현 수(등록된 모든 파일에 걸쳐). 파일 집합은 중복 제거.
export const countMarker = (repositoryRoot, marker) => {
  const files = new Set();
  for (const relativePath of marker.files) {
    for (const file of collectMarkdown(join(repositoryRoot, relativePath))) files.add(file);
  }
  let count = 0;
  for (const file of files) {
    const matches = readFileSync(file, 'utf8').match(marker.pattern);
    if (matches) count += matches.length;
  }
  return count;
};

export const snapshotMarkers = repositoryRoot =>
  Object.fromEntries(MARKER_REGISTRY.map(marker => [marker.id, countMarker(repositoryRoot, marker)]));

// validate-harness 통합점 — {repositoryRoot, pass, fail} 규약을 따른다.
export function validateMarkerIntegrity({repositoryRoot, pass, fail}) {
  if (!existsSync(BASELINE_PATH)) {
    fail(
      'marker-integrity: baseline(marker-integrity-baseline.json)이 없다 — ' +
        '`node .claude/scripts/validators/validate-marker-integrity.mjs --update`로 스냅샷하라',
    );
    return;
  }
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')).markers ?? {};
  const registered = new Set();

  for (const marker of MARKER_REGISTRY) {
    registered.add(marker.id);
    const current = countMarker(repositoryRoot, marker);
    if (!Object.hasOwn(baseline, marker.id)) {
      fail(
        `marker-integrity: '${marker.id}' (${marker.label})가 baseline에 없다 — ` +
          '신규 마커는 --update로 의식적으로 스냅샷하라(JUDGMENT 기록)',
      );
      continue;
    }
    const expected = baseline[marker.id];
    if (current === 0 && expected > 0) {
      fail(
        `marker-integrity: '${marker.id}' 마커가 사라졌다(baseline ${expected} → 검출 0) — ` +
          '번역·리팩터로 마커가 없어졌는지 확인하라. 앵커로 승격했다면 pattern을 앵커로 바꾸고 ' +
          '--update하라(MARKER_LOST, I2/I5)',
      );
    } else if (current < expected) {
      fail(
        `marker-integrity: '${marker.id}' 마커 ${current} < baseline ${expected} — 일부 출현이 ` +
          '사라졌다(부분 손실). 의도한 축소면 --update로 baseline을 낮춰라(JUDGMENT 기록, I2)',
      );
    }
  }

  const stale = Object.keys(baseline).filter(id => !registered.has(id));
  if (stale.length > 0) {
    pass(`marker integrity: baseline에 레지스트리 밖 항목 ${stale.length}개 [정보성] — ${stale.join(', ')}`);
  }
  pass(`marker integrity checked (${MARKER_REGISTRY.length} marker(s) protected)`);
}

// --update / --json CLI — validate-harness 밖에서 baseline 스냅샷·조회.
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const repositoryRoot = resolve(validatorsDirectory, '..', '..', '..');
  const args = process.argv.slice(2);

  if (args.includes('--update')) {
    const markers = snapshotMarkers(repositoryRoot);
    // before/after diff 출력 — 손실을 --update로 조용히 정규화(launder)하지 못하게 리뷰
    // 가시성을 확보한다(harness-change-reviewer 권고, 2026-08-18). 최종 숫자만 커밋에 남으면
    // "왜 줄었는가"가 안 보인다.
    const previous = existsSync(BASELINE_PATH)
      ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8')).markers ?? {}
      : {};
    for (const [id, count] of Object.entries(markers)) {
      const before = Object.hasOwn(previous, id) ? previous[id] : '(신규)';
      const delta = typeof before === 'number' && before !== count ? (count > before ? ' ↑' : ' ↓ 손실 — 사유를 JUDGMENT에 기록하라') : '';
      console.log(`  ${id}: ${before} → ${count}${delta}`);
    }
    const payload = {
      comment:
        '언어 중립 마커 무결성 baseline — current < baseline이면 fail(마커 손실). ' +
        '갱신은 의식적 행위이며 CLAUDE.md 판단 게이트를 거친다(JUDGMENT 기록).',
      markers,
    };
    writeFileSync(BASELINE_PATH, `${JSON.stringify(payload, null, 1)}\n`);
    console.log(`marker-integrity baseline 갱신 완료`);
    process.exit(0);
  }

  if (args.includes('--json')) {
    const current = snapshotMarkers(repositoryRoot);
    const baseline = existsSync(BASELINE_PATH)
      ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8')).markers ?? {}
      : {};
    console.log(JSON.stringify({current, baseline}, null, 1));
    process.exit(0);
  }

  const errors = [];
  validateMarkerIntegrity({
    repositoryRoot,
    pass: message => console.log(`- ${message}`),
    fail: message => errors.push(message),
  });
  if (errors.length) {
    console.error(`marker-integrity FAIL (${errors.length}):`);
    for (const message of errors) console.error(`- ${message}`);
    process.exit(1);
  }
  console.log('marker-integrity OK');
}
