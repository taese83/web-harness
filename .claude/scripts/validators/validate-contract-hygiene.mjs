// 계약 위생 + 판단 계층 앵커 (프로덕션 하드닝 Pillar C, protected-core I3·I4·I5).
// 판단 자체는 기계화되지 않는다 — 이 validator는 "판단이 일어났고 기록됐는가"를 강제한다:
//   1. 판단 계층 보호     — CLAUDE.md(판단 게이트 마커·≤60줄)와 docs/protected-core.md 실존
//   2. always-read ratchet — 전 스킬 실측 baseline 대비 성장만 fail (G2: 현 상태 오탐 0 by construction)
//   3. 일반화 근거 강제    — baseline 밖 신규 reference 계약은 `## 일반화 근거` + 형태 2개+ 필수
//                           (존재·형태만 검사 — 진실은 미검증. protected-core §4 프록시 등록부 참조)
//   4. orphan reference    — 미참조 계약 정보성 보고 (기존 소급 fail 없음 — G3)
// baseline(contract-hygiene-baseline.json) 갱신은 의식적 행위 — CLAUDE.md 판단 게이트를 거친다.
import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {detectSourceRepository} from './validate-adapter-hygiene.mjs';

const validatorsDirectory = dirname(fileURLToPath(import.meta.url));
const CLAUDE_MD_MAX_LINES = 60;
const DEFAULT_ALWAYS_READ_BUDGET = 8; // baseline 미등록 신규 스킬 기본 상한
const MATURITY_VALUES = new Set(['contract-only', 'eval-covered', 'golden-backed']);

const listMarkdown = (root, out = []) => {
  if (!existsSync(root)) return out;
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    if (statSync(path).isDirectory()) listMarkdown(path, out);
    else if (name.endsWith('.md')) out.push(path);
  }
  return out;
};

// 언어 독립 마커(2026-08-12, 영문화 선행 작업). 계약 본문을 영어로 옮기면 한국어 문자열에
// 의존하던 검사가 **매칭 실패 → 마커 0건 → 조용히 통과**로 무력화된다(번역이 게이트를 끄는데
// CI는 green). 그래서 (a) 한국어·영어·중립 앵커를 모두 인식하고, (b) baseline이 마커 존재를
// 전제하는데 사라지면 통과가 아니라 FAIL(MARKER_LOST)로 잡는다.
// 어순 주의(실측 2회). 한국어는 SOV라 `항상 … 읽는다`가 참조 목록을 **감싼다**. 영어는 SVO라
// "Always read <목록>"으로 동사가 앞에 오므로 앵커 **뒤**를 봐야 한다. seed에서 두 번 틀렸다:
//   1차 lazy 매칭 → "Always read" 11자만 잡아 참조 0건 → MARKER_LOST 오탐
//   2차 문단 단위 전방 윈도우 → 뒤 줄의 참조까지 삼켜 과대계수(3 > baseline 2)
// 그래서 영어는 **같은 줄**로 한정한다. 목록이 여러 줄에 걸치는 번역은 자연어 매칭 대신
// 중립 앵커 `<!-- always-read --> … <!-- /always-read -->`를 쓴다(권장 경로).
const ALWAYS_READ_SENTENCE = /(?:항상[\s\S]*?읽는다|always[^\n]{0,40}?read[^\n]{0,400}|<!--\s*always-read\s*-->[\s\S]*?<!--\s*\/always-read\s*-->)/i;
const GENERALIZATION_HEADING = /(?:^|\n)##\s+(?:일반화 근거|Generalization evidence)\n([\s\S]*?)(?=\n## |$)/i;
const EXPERIMENTAL_HEADING = /^##\s+(?:실험|Experimental)(?:\s|$)/m;

// 선행 로드 범위 확정 — **명시 앵커가 산문 휴리스틱을 이긴다**(2026-08-20). 종전에는
// 알터네이션 순서상 `항상…읽는다` 문장이 먼저 걸려, 앵커가 그보다 뒤에 있으면 무관한
// 문장이 범위가 됐다(실측: web-orchestrator에서 129행 "plan-reviewer를 항상 실행하고…"가
// 잡혀 실제 목록 전체가 미집계, baseline 2가 그 오집계와 self-consistent). protected-core
// §4 "always-read 카운터" 행의 미해결 TODO였다.
const ALWAYS_READ_ANCHOR = /<!--\s*always-read\s*-->([\s\S]*?)<!--\s*\/always-read\s*-->/i;
const alwaysReadScope = text => text.match(ALWAYS_READ_ANCHOR)?.[1] ?? text.match(ALWAYS_READ_SENTENCE)?.[0] ?? null;

export const countAlwaysReadRefs = text => {
  const scope = alwaysReadScope(text);
  if (scope === null) return 0;
  return new Set(scope.match(/references\/[^`\s,]+\.md/g) ?? []).size;
};

// 선행 로드의 **바이트 실측**(고정 진입 비용). 참조 수만으로는 "파일 하나가 5배로 커지는"
// 성장을 못 잡는다(§4: "총 로드비용의 진실은 미보장"). 바이트는 결정론적이라 ratchet 단위로
// 쓰고, 사람이 읽는 토큰 근사치는 bytes/3으로 별도 표기한다(근사임을 숨기지 않는다).
// 참조를 못 찾으면 0이 아니라 `missing`으로 보고한다 — 경로 오타가 "비용 0"으로 보이면 안 된다.
// 진입 비용 = SKILL.md 본문 + 선행 로드 참조. 종전에는 **참조만** 셌다(2026-08-26 발견).
// web-orchestrator에서 SKILL.md가 38KB로 참조 합계(28KB)보다 크므로, 공표된 진입 비용이
// 실제의 43%만 말하고 있었다 — 예산 게이트가 가장 큰 항목을 보지 않았다.
export const measureAlwaysReadBytes = (text, skillDirectory) => {
  const scope = alwaysReadScope(text);
  if (scope === null) return {bytes: 0, files: 0, missing: []};
  const skillBodyBytes = Buffer.byteLength(text, 'utf8');
  const refs = new Set(scope.match(/(?:\.\.\/[\w\-]+\/)?references\/[^`\s,]+\.md/g) ?? []);
  let bytes = 0;
  let files = 0;
  const missing = [];
  for (const ref of refs) {
    const path = join(skillDirectory, ref);
    if (!existsSync(path)) {
      missing.push(ref);
      continue;
    }
    bytes += statSync(path).size;
    files += 1;
  }
  return {bytes: bytes + skillBodyBytes, files: files + 1, missing};
};

// `## 일반화 근거` / `## Generalization evidence` + 서로 다른 형태 2개 이상(불릿)
// — 존재·형태 검사(진실은 리뷰어·fixture 몫)
// 종결 lookahead는 다음 `\n## ` 또는 문서 절대 끝($, m-플래그 없음 — 빈 줄 조기 종결 방지)
const hasGeneralizationEvidence = text => {
  const section = text.match(GENERALIZATION_HEADING);
  if (section === null) return false;
  const bullets = section[1].match(/^- .+/gm) ?? [];
  return new Set(bullets.map(line => line.trim())).size >= 2;
};

// Built-in profile의 adapter 상태, skill 서술, eval 기대가 서로 다른 시대의 값을 주장하는지 검사한다.
// 특정 profile 이름에 의존하지 않고 adapter inventory 전체에 적용한다.
export const inspectProfileNarrativeConsistency = ({profiles, skillSources, scenarios}) => {
  const errors = [];
  const knownProfileIds = new Set(profiles.map(profile => profile.id));

  for (const [skill, source] of skillSources) {
    for (const match of source.matchAll(/WEB_PROFILE:\s*([A-Za-z0-9_-]+)/g)) {
      if (!knownProfileIds.has(match[1])) {
        errors.push({
          code: 'UNKNOWN_PROFILE_ID',
          message: `${skill}: unknown WEB_PROFILE marker ${match[1]}`,
        });
      }
    }
  }

  for (const profile of profiles) {
    const source = skillSources.get(profile.id);
    if (!source) continue;
    const declaredSupport = source.match(/`SUPPORT_STATUS:\s*([a-z-]+)`/)?.[1];
    if (declaredSupport && declaredSupport !== profile.supportLevel) {
      errors.push({
        code: 'SUPPORT_LEVEL_MISMATCH',
        message: `${profile.id}: skill declares ${declaredSupport}, adapter declares ${profile.supportLevel}`,
      });
    }
    if (profile.supportLevel !== 'experimental' && EXPERIMENTAL_HEADING.test(source)) {
      errors.push({
        code: 'STALE_EXPERIMENTAL_HEADING',
        message: `${profile.id}: non-experimental adapter retains an experimental normative heading`,
      });
    }
    const profileScenarios = scenarios.filter(scenario => scenario.entrySkill === `/${profile.id}`);
    if (
      profile.supportLevel !== 'experimental' &&
      profileScenarios.some(scenario => (scenario.assertions ?? []).some(assertion => /experimental profile/i.test(assertion)))
    ) {
      errors.push({
        code: 'STALE_EXPERIMENTAL_EVAL',
        message: `${profile.id}: non-experimental adapter has an eval assertion that still calls it experimental`,
      });
    }
  }
  return errors;
};

export function validateContractHygiene({repositoryRoot, pass, fail}) {
  const skillsDir = join(repositoryRoot, '.claude', 'skills');
  const agentsDir = join(repositoryRoot, '.claude', 'agents');
  if (!existsSync(skillsDir)) return;

  const baseline = JSON.parse(
    readFileSync(join(validatorsDirectory, 'contract-hygiene-baseline.json'), 'utf8'),
  );
  const baselineReferences = new Set(baseline.references);

  const isSourceRepository = detectSourceRepository(repositoryRoot);

  const positiveSeedErrors = inspectProfileNarrativeConsistency({
    profiles: [{id: 'example-profile', supportLevel: 'compatible'}],
    skillSources: new Map([['example-profile', '`SUPPORT_STATUS: compatible`\nWEB_PROFILE: example-profile\n## 완료 조건\n']]),
    scenarios: [{entrySkill: '/example-profile', assertions: ['compatible evidence remains honestly labeled']}],
  });
  if (positiveSeedErrors.length > 0) fail('contract-hygiene: profile narrative positive seed was rejected');
  const negativeSeedCodes = new Set(inspectProfileNarrativeConsistency({
    profiles: [{id: 'example-profile', supportLevel: 'compatible'}],
    skillSources: new Map([['example-profile', '`SUPPORT_STATUS: experimental`\nWEB_PROFILE: old-profile\n## 실험 완료 조건\n']]),
    scenarios: [{entrySkill: '/example-profile', assertions: ['release stays blocked for this experimental profile']}],
  }).map(error => error.code));
  for (const code of ['UNKNOWN_PROFILE_ID', 'SUPPORT_LEVEL_MISMATCH', 'STALE_EXPERIMENTAL_HEADING', 'STALE_EXPERIMENTAL_EVAL']) {
    if (!negativeSeedCodes.has(code)) fail(`contract-hygiene: profile narrative negative seed was not detected: ${code}`);
  }

  // 1) 판단 계층 자체 보호 — source repo 전용. 배포된 control plane(target 재검증)에는 루트
  // CLAUDE.md 판단 게이트·docs/protected-core.md가 존재하지 않는 것이 정상이다(governance는
  // 하네스 개발의 관심사). 가드 누락 시 deploy-harness의 target 재검증 전체가 깨진다.
  if (isSourceRepository) {
    const claudeMdPath = join(repositoryRoot, 'CLAUDE.md');
    if (!existsSync(claudeMdPath)) {
      fail('contract-hygiene: 루트 CLAUDE.md(판단 게이트) 부재 — protected-core 판단 계층이 세션에 로드되지 않는다');
    } else {
      const claudeMd = readFileSync(claudeMdPath, 'utf8');
      if (!claudeMd.includes('harness-judgment-gate')) {
        fail('contract-hygiene: CLAUDE.md에 판단 게이트 마커(harness-judgment-gate)가 없다');
      }
      const lineCount = claudeMd.split('\n').length;
      if (lineCount > CLAUDE_MD_MAX_LINES) {
        fail(`contract-hygiene: CLAUDE.md ${lineCount}줄 > ${CLAUDE_MD_MAX_LINES} — 고정 로드 예산(I4). 상세는 protected-core로 옮겨라`);
      }
    }
    if (!existsSync(join(repositoryRoot, 'docs', 'protected-core.md'))) {
      fail('contract-hygiene: docs/protected-core.md 부재 — 판단 기준 canonical이 없다');
    }
  }

  // maturity 정직성 검사용 — eval 파일에서의 언급은 커버리지의 **필요조건**일 뿐이다(§4 프록시 등록).
  const evalSource = ['evals/scenarios.json', 'evals/ai-scenarios.json']
    .map(rel => join(repositoryRoot, '.claude', rel))
    .filter(existsSync)
    .map(path => readFileSync(path, 'utf8'))
    .join('\n');
  const goldenSource = listMarkdown(join(repositoryRoot, 'golden'))
    .map(path => readFileSync(path, 'utf8'))
    .join('\n');

  const consumerTexts = existsSync(agentsDir)
    ? readdirSync(agentsDir)
        .filter(name => name.endsWith('.md'))
        .map(name => readFileSync(join(agentsDir, name), 'utf8'))
    : [];

  const adaptersDir = join(repositoryRoot, '.claude', 'adapters');
  const profiles = existsSync(adaptersDir)
    ? readdirSync(adaptersDir, {withFileTypes: true})
        .filter(entry => entry.isDirectory() && existsSync(join(adaptersDir, entry.name, 'adapter.json')))
        .map(entry => JSON.parse(readFileSync(join(adaptersDir, entry.name, 'adapter.json'), 'utf8')))
    : [];
  const skillSources = new Map(
    readdirSync(skillsDir, {withFileTypes: true})
      .filter(entry => entry.isDirectory() && existsSync(join(skillsDir, entry.name, 'SKILL.md')))
      .map(entry => [entry.name, readFileSync(join(skillsDir, entry.name, 'SKILL.md'), 'utf8')]),
  );
  const scenarioPath = join(repositoryRoot, '.claude', 'evals', 'scenarios.json');
  const scenarios = existsSync(scenarioPath) ? JSON.parse(readFileSync(scenarioPath, 'utf8')) : [];
  for (const error of inspectProfileNarrativeConsistency({profiles, skillSources, scenarios})) {
    fail(`contract-hygiene: ${error.message} [${error.code}]`);
  }
  pass('profile narrative consistency and seed regressions checked');

  const orphans = [];
  let newContracts = 0;

  for (const entry of readdirSync(skillsDir, {withFileTypes: true})) {
    if (!entry.isDirectory()) continue;
    const skill = entry.name;
    const skillMdPath = join(skillsDir, skill, 'SKILL.md');
    if (!existsSync(skillMdPath)) continue;
    const skillMd = readFileSync(skillMdPath, 'utf8');

    // 2) maturity 정직성 — 모든 스킬은 성숙도를 자기 선언하고, 상위 tier 주장은 증거를 요구한다.
    // 라벨은 기능이 아니라 정직성이다(G6) — eval 언급은 필요조건일 뿐 충분조건이 아니다(§4 프록시).
    const maturity = skillMd.match(/^\s+maturity:\s*(\S+)/m)?.[1];
    if (maturity === undefined) {
      fail(`contract-hygiene: '${skill}' SKILL.md에 metadata.maturity가 없다 — contract-only | eval-covered | golden-backed 중 정직하게 선언하라(I1)`);
    } else if (!MATURITY_VALUES.has(maturity)) {
      fail(`contract-hygiene: '${skill}' maturity '${maturity}'는 유효값이 아니다(contract-only | eval-covered | golden-backed)`);
    } else {
      if ((maturity === 'eval-covered' || maturity === 'golden-backed') && !evalSource.includes(skill)) {
        fail(`contract-hygiene: '${skill}'이 ${maturity}를 주장하지만 eval 시나리오 어디에도 언급이 없다 — contract-only로 정직하게 내리거나 시나리오를 추가하라(I1)`);
      }
      // golden/ 증거는 source repo에만 존재한다(deploy-harness는 .claude 하위만 복사) — 배포
      // target에서 이 검사를 돌리면 golden-backed 스킬이 생기는 순간 구조적으로 fail한다
      // (harness-change-reviewer HIGH finding, 2026-08). 라벨은 source에서 검증된 뒤 verbatim
      // 배포되므로 target에서는 skip이 의도된 동작이다.
      if (maturity === 'golden-backed' && isSourceRepository && !goldenSource.includes(skill)) {
        fail(`contract-hygiene: '${skill}'이 golden-backed를 주장하지만 golden/ 어디에도 근거가 없다(I1)`);
      }
    }

    // 3-b) 고정 진입 비용(바이트) ratchet — 참조 **수**가 그대로여도 계약 파일이 커지면
    // 진입 비용은 커진다. 채택 비용의 실제 단위라 별도 차원으로 확정한다(2026-08-20 신설).
    // baseline에 없는 스킬은 미측정으로 두고 fail하지 않는다(소급 fail 금지 — G2/G3 관례).
    if (Object.hasOwn(baseline.alwaysReadBytes ?? {}, skill)) {
      const {bytes, missing} = measureAlwaysReadBytes(skillMd, join(skillsDir, skill));
      if (missing.length > 0) {
        fail(
          `contract-hygiene: '${skill}' 선행 로드 참조를 찾을 수 없다: ${missing.join(', ')} — 경로 오타가 "비용 0"으로 집계되면 안 된다(I1)`,
        );
      }
      const byteBudget = baseline.alwaysReadBytes[skill];
      if (bytes > byteBudget) {
        fail(
          `contract-hygiene: '${skill}' 선행 로드 ${bytes.toLocaleString()}B > baseline ${byteBudget.toLocaleString()}B(≈${Math.round(bytes / 3).toLocaleString()} tok) — 시점 로드로 강등하거나 baseline을 의식적으로 갱신하라(JUDGMENT 기록, I4)`,
        );
      }
    }

    // 3-c) README 공표 대조 — 채택 판단에 쓰이는 고정 진입 비용을 README가 공표하고, 그 숫자가
    // 실측과 어긋나면 FAIL한다(2026-08-20). 채택 비용을 "읽어보면 안다"에서 "게시된 검증 숫자"로
    // 바꾸는 것이 목적이라, 숫자가 조용히 낡으면 목적 자체가 무너진다.
    // 번역본도 같은 게이트를 받는다 — README.ko.md가 "더 상세한 현재 정본"이라고 스스로 밝히는데
    // 영문만 검사하면 한국어 독자가 보는 숫자가 조용히 낡는다(적대 검토 MEDIUM, 2026-08-20).
    if (skill === 'web-orchestrator' && isSourceRepository) {
      const {bytes} = measureAlwaysReadBytes(skillMd, join(skillsDir, skill));
      for (const readmeName of ['README.md', 'README.ko.md']) {
        const readmePath = join(repositoryRoot, readmeName);
        if (!existsSync(readmePath)) continue;
        const published = readFileSync(readmePath, 'utf8').match(/([\d,]+)\s*bytes\s*<!--\s*inventory:entry-cost\s*-->/);
        if (!published) {
          fail(`contract-hygiene: ${readmeName}에 <!-- inventory:entry-cost --> 마커가 없다 — 고정 진입 비용 공표는 채택 비용 계약이다("N bytes <!-- inventory:entry-cost -->" 형태)`);
        } else if (Number(published[1].replace(/,/g, '')) !== bytes) {
          fail(`contract-hygiene: ${readmeName} 진입 비용 공표(${published[1]}B)가 실측(${bytes.toLocaleString()}B)과 불일치 — 공표 숫자를 갱신하라(I1)`);
        }
      }
    }

    // 3) always-read ratchet — 실측 baseline이 상한. 성장은 의식적 baseline 갱신을 요구한다.
    const count = countAlwaysReadRefs(skillMd);
    const budget = Object.hasOwn(baseline.alwaysRead, skill)
      ? baseline.alwaysRead[skill]
      : DEFAULT_ALWAYS_READ_BUDGET;
    if (count > budget) {
      fail(
        `contract-hygiene: '${skill}' always-read ${count} > baseline ${budget} — 조건부 읽기로 강등하거나 baseline을 의식적으로 갱신하라(JUDGMENT 기록, I4)`,
      );
    }
    // MARKER_LOST 가드 — baseline이 always-read를 전제하는 스킬(>0)에서 마커가 0으로
    // 떨어지면 "줄었으니 통과"가 아니라 FAIL이다. 번역·리팩터로 마커 문장이 사라지면
    // ratchet이 조용히 장식이 되기 때문이다(vacuous pass 차단). 정말 줄였다면 baseline을
    // 의식적으로 낮춰 이 검사를 통과시킨다.
    if (Object.hasOwn(baseline.alwaysRead, skill) && baseline.alwaysRead[skill] > 0 && count === 0) {
      fail(
        `contract-hygiene: '${skill}' always-read 마커가 사라졌다(baseline ${budget} → 검출 0) — 번역·리팩터로 마커 문장이 없어졌는지 확인하고, 실제로 줄였다면 baseline을 낮춰라(MARKER_LOST, I2/I5)`,
      );
    }

    const refDir = join(skillsDir, skill, 'references');
    const refFiles = listMarkdown(refDir);
    const siblingTexts = refFiles.map(path => readFileSync(path, 'utf8'));
    const haystack = [skillMd, ...consumerTexts, ...siblingTexts].join('\n');

    for (const path of refFiles) {
      const relativeToRefs = path.split('/references/')[1];
      const repoRelative = `.claude/skills/${skill}/references/${relativeToRefs}`;
      const text = readFileSync(path, 'utf8');

      // 3) baseline 밖 신규 계약 — 일반화 근거 필수(I3의 기록 강제)
      if (!baselineReferences.has(repoRelative)) {
        newContracts++;
        if (!hasGeneralizationEvidence(text)) {
          fail(
            `contract-hygiene: ${repoRelative} — 신규 계약에 '## 일반화 근거'(서로 다른 서비스 형태 2개+ 불릿)가 없다(I3). 진실 검증 전이면 "명명 수준" 표기를 포함하라`,
          );
        }
      }

      // 4) orphan — 정보성
      const base = relativeToRefs.split('/').pop();
      if (!haystack.includes(relativeToRefs) && !haystack.includes(base)) {
        orphans.push(repoRelative);
      }
    }
  }

  if (orphans.length > 0) {
    pass(`contract hygiene: ${orphans.length} orphan reference(s) [정보성] — ${orphans.join(', ')}`);
  }
  pass(
    `contract hygiene checked (judgment layer guarded, always-read ratchet: ${Object.keys(baseline.alwaysRead).length} skills, new contracts: ${newContracts}, orphans: ${orphans.length})`,
  );
}
