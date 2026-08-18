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
// 스코프: .claude/scripts 하위라 미러(build-adapters MIRROR_SET) 밖 — adapter 재생성 불필요.

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
    id: 'index-consumer-column',
    label: '샤딩 INDEX 소비자 열 (주 소비자)',
    // 현재는 한국어 문자열. 앵커화(§5-3) 시 /<!--\s*marker:index-consumer-column\s*-->/g 로 교체.
    pattern: /주 소비자/g,
    files: [
      '.claude/agents',
      '.claude/skills/web-orchestrator/references/artifact-sharding-contract.md',
    ],
    note: 'validate-artifact-sharding.mjs는 생성 INDEX.md만 매칭(warning-only) — 소스 마커는 이 게이트가 보호',
  },
];

const collectMarkdown = (root, out = []) => {
  if (!existsSync(root)) return out;
  if (statSync(root).isFile()) {
    if (root.endsWith('.md')) out.push(root);
    return out;
  }
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
