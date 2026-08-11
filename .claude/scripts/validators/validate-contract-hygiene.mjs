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

// "항상 … 읽는다" 코어 문장의 references/*.md 개수 — 한국어 마커 프록시(§4 등록: 성장 ratchet 전용).
const countAlwaysReadRefs = text => {
  const match = text.match(/항상[\s\S]*?읽는다/);
  if (match === null) return 0;
  return new Set(match[0].match(/references\/[^`\s,]+\.md/g) ?? []).size;
};

// `## 일반화 근거` 섹션 + 서로 다른 형태 2개 이상(불릿) — 존재·형태 검사(진실은 리뷰어·fixture 몫)
// 종결 lookahead는 다음 `\n## ` 또는 문서 절대 끝($, m-플래그 없음 — 빈 줄 조기 종결 방지)
const hasGeneralizationEvidence = text => {
  const section = text.match(/(?:^|\n)## 일반화 근거\n([\s\S]*?)(?=\n## |$)/);
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
    if (profile.supportLevel !== 'experimental' && /^##\s+실험(?:\s|$)/m.test(source)) {
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
