// validate-certified-evidence.mjs — certified 라벨 ↔ 증거 바인딩 게이트 (M3, protected-core I1·I2·I5).
//
// 배경(2026-08-18 M3 정찰): "증명 없는 tier 승격 금지"는 산문(CLAUDE.md 비협상·protected-core I1)
// 뿐이었고, 기계는 라벨의 **상호 일관성**만 검사했다 — adapter.json 한 줄 편집으로 certified가
// 성립하는 상태. 실제로 유일한 certified(react-vite-spa)가 증거로는 최약체(골든 validator 미커버·
// locked profile 없음·receipt 0·5/7 로컬)였고, compatible인 hybrid가 최강(골든 완비·QA 7/7·
// T1 validator)인 **라벨 역전**이 있었다. 이 게이트가 라벨을 증거에 묶는다:
//
//   supportLevel === 'certified' 인 모든 adapter는 다음을 커밋된 트리에서 갖춰야 한다.
//     1. golden/{id}/ 골든 레퍼런스 존재
//     2. golden/{id}/_workspace/01_plan/project-profile.json — locked profile이 존재하고
//        profileId 일치 + supportLevel 'certified' 일치(라벨 lockstep이 아니라 증거 트리 안에서)
//     3. golden/{id}/_workspace/04_qa/t1-summary.json — 격리 CI 폐곡선 receipt,
//        status === 'ISOLATED_VERIFIED' (release-tier-contract T1. T2 attestation은 별도 추적)
//     4. golden/{id}/_workspace/04_qa/qa-*.md 가 있으면 전부 `## Result` PASS
//
// certified adapter가 0개면 루프는 공회전한다 — 그 vacuous 상태에서도 게이트가 무장돼 있음을
// 증명하기 위해 매 실행에서 합성 seed(양성 1·음성 3)를 임시 트리로 구동한다(contract-hygiene의
// seed 관례). 한계는 §4 등록: t1-summary.json 자체의 진위(위조된 JSON)는 이 게이트가 아니라
// validate-isolated-cohort + 서명 attestation(T2)의 몫이다 — 이 게이트는 "증거 없이 라벨만"을
// 차단하는 1차 방벽이다.

import {existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const QA_RESULT_PASS = /^##\s*Result\b[^\n]*\n+\s*PASS\b/m;

// 한 repo 루트에 대해 certified 증거를 검사한다 — 순수(fs 접근은 인자 루트 하위만).
export function inspectCertifiedEvidence(repositoryRoot) {
  const errors = [];
  let certifiedCount = 0;
  const adaptersDir = join(repositoryRoot, '.claude', 'adapters');
  if (!existsSync(adaptersDir)) return {errors, certifiedCount};

  for (const entry of readdirSync(adaptersDir, {withFileTypes: true})) {
    if (!entry.isDirectory()) continue;
    const adapterPath = join(adaptersDir, entry.name, 'adapter.json');
    if (!existsSync(adapterPath)) continue;
    let adapter;
    try {
      adapter = JSON.parse(readFileSync(adapterPath, 'utf8'));
    } catch {
      continue; // 형식 오류는 adapter-lib 검사의 몫
    }
    if (adapter.supportLevel !== 'certified') continue;
    certifiedCount += 1;
    const id = adapter.id ?? entry.name;
    const goldenRoot = join(repositoryRoot, 'golden', id);

    if (!existsSync(goldenRoot)) {
      errors.push(
        `certified-evidence: '${id}'가 certified를 주장하지만 golden/${id}/ 골든 레퍼런스가 없다 — ` +
          '라벨은 증거를 요구한다(CERTIFIED_WITHOUT_GOLDEN, I1)',
      );
      continue;
    }

    const lockedPath = join(goldenRoot, '_workspace', '01_plan', 'project-profile.json');
    if (!existsSync(lockedPath)) {
      errors.push(
        `certified-evidence: '${id}' 골든에 locked profile(_workspace/01_plan/project-profile.json)이 없다(CERTIFIED_WITHOUT_LOCK, I1)`,
      );
    } else {
      try {
        const locked = JSON.parse(readFileSync(lockedPath, 'utf8'));
        const lockedId = locked.profileId ?? locked.id;
        if (lockedId !== id || locked.supportLevel !== 'certified') {
          errors.push(
            `certified-evidence: '${id}' locked profile이 라벨과 어긋난다(id=${lockedId}, supportLevel=${locked.supportLevel}) — ` +
              '증거 트리 안에서 certified가 재현돼야 한다(CERTIFIED_LOCK_MISMATCH, I1)',
          );
        }
      } catch {
        errors.push(`certified-evidence: '${id}' locked profile 파싱 실패(CERTIFIED_LOCK_MISMATCH, I1)`);
      }
    }

    const t1Path = join(goldenRoot, '_workspace', '04_qa', 't1-summary.json');
    if (!existsSync(t1Path)) {
      errors.push(
        `certified-evidence: '${id}'에 격리 CI 폐곡선 receipt(_workspace/04_qa/t1-summary.json)가 없다 — ` +
          '로컬 green은 폐곡선이 아니다(CERTIFIED_WITHOUT_T1, I1/I2 — protected-core §4 "골든 5/7 로컬" 행)',
      );
    } else {
      try {
        const summary = JSON.parse(readFileSync(t1Path, 'utf8'));
        if (summary.status !== 'ISOLATED_VERIFIED') {
          errors.push(
            `certified-evidence: '${id}' t1-summary.status='${summary.status}' ≠ 'ISOLATED_VERIFIED'(CERTIFIED_T1_NOT_VERIFIED, I1)`,
          );
        }
      } catch {
        errors.push(`certified-evidence: '${id}' t1-summary.json 파싱 실패(CERTIFIED_T1_NOT_VERIFIED, I1)`);
      }
    }

    const qaDir = join(goldenRoot, '_workspace', '04_qa');
    if (existsSync(qaDir)) {
      for (const name of readdirSync(qaDir).filter(value => value.startsWith('qa-') && value.endsWith('.md'))) {
        if (!QA_RESULT_PASS.test(readFileSync(join(qaDir, name), 'utf8'))) {
          errors.push(`certified-evidence: '${id}' ${name}의 '## Result'가 PASS가 아니다(CERTIFIED_QA_NOT_PASS, I1)`);
        }
      }
    }
  }
  return {errors, certifiedCount};
}

// seed — certified 0개인 현재 상태에서 게이트가 공회전-장식이 되지 않도록, 매 실행마다 합성
// 트리로 무장 상태를 증명한다(양성 1·음성 3). contract-hygiene의 seed 회귀와 같은 관례.
const buildSeedTree = ({withGolden, withLock, t1Status, qaPass}) => {
  const root = mkdtempSync(join(tmpdir(), 'certified-seed-'));
  const adapterDir = join(root, '.claude', 'adapters', 'seed-profile');
  mkdirSync(adapterDir, {recursive: true});
  writeFileSync(join(adapterDir, 'adapter.json'), JSON.stringify({id: 'seed-profile', supportLevel: 'certified'}));
  if (withGolden) {
    const qaDir = join(root, 'golden', 'seed-profile', '_workspace', '04_qa');
    mkdirSync(join(root, 'golden', 'seed-profile', '_workspace', '01_plan'), {recursive: true});
    mkdirSync(qaDir, {recursive: true});
    if (withLock) {
      writeFileSync(
        join(root, 'golden', 'seed-profile', '_workspace', '01_plan', 'project-profile.json'),
        JSON.stringify({profileId: 'seed-profile', supportLevel: 'certified'}),
      );
    }
    if (t1Status !== null) {
      writeFileSync(join(qaDir, 't1-summary.json'), JSON.stringify({status: t1Status}));
    }
    writeFileSync(join(qaDir, 'qa-test.md'), `## Result\n\n${qaPass ? 'PASS' : 'FAIL'}\n`);
  }
  return root;
};

export function validateCertifiedEvidence({repositoryRoot, pass, fail}) {
  // 1) seed 무장 검증 — 게이트 자체의 침묵 회귀 차단
  const seeds = [
    {label: 'positive', tree: {withGolden: true, withLock: true, t1Status: 'ISOLATED_VERIFIED', qaPass: true}, expectErrors: false},
    {label: 'no-golden', tree: {withGolden: false, withLock: false, t1Status: null, qaPass: true}, expectErrors: true},
    {label: 'no-t1', tree: {withGolden: true, withLock: true, t1Status: null, qaPass: true}, expectErrors: true},
    {label: 'qa-fail', tree: {withGolden: true, withLock: true, t1Status: 'ISOLATED_VERIFIED', qaPass: false}, expectErrors: true},
  ];
  for (const seed of seeds) {
    const root = buildSeedTree(seed.tree);
    try {
      const {errors} = inspectCertifiedEvidence(root);
      if (seed.expectErrors && errors.length === 0) {
        fail(`certified-evidence: seed '${seed.label}'의 결함이 탐지되지 않았다 — 게이트 침묵 회귀(I2)`);
      } else if (!seed.expectErrors && errors.length > 0) {
        fail(`certified-evidence: seed '${seed.label}'(완전 증거)가 오탐됐다: ${errors[0]}`);
      }
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  }

  // 2) 실제 트리 검사
  const {errors, certifiedCount} = inspectCertifiedEvidence(repositoryRoot);
  for (const message of errors) fail(message);
  pass(
    `certified evidence binding checked (certified adapters: ${certifiedCount}, seeds armed: ${seeds.length})`,
  );
}
