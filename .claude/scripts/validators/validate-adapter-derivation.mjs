// validate-adapter-derivation.mjs — 어댑터 선언과 형태 도출의 **등가**를 CI에 결박한다.
//
// 배경(2026-08-27 실측): `resolve-commands.mjs`와 `derive-execution-graph.mjs`는 어댑터의
// `commands`·`tasks`를 대체하려고 만들어졌으나 **소비처가 0이었다** — 실행 경로는 여전히
// `compile-execution-plan` → `dag-lib` → `adapter.tasks`였다. 등가를 주장만 하고 결박하지
// 않으면 둘은 조용히 어긋난다.
//
// 이 게이트는 삭제의 **선행 조건**이다. 어댑터 필드를 지우려면 먼저 도출이 같은 것을 낸다는
// 사실이 CI에서 매 실행 확인돼야 한다. 순서를 뒤집으면(먼저 지우고 나중에 검증) 대조 기준이
// 사라진다.
//
// 적용 범위: 내장 프로필 **3종 전부**.
//   같은 날 앞선 판단("Next는 형태 어휘 밖이라 설계상 제외")은 **틀렸다**. `next.*` 22종의
//   실행 명령이 전부 `pnpm run <script>`였다 — 하네스 고유 명령 0건. 프레임워크 지식이 아니라
//   receipt 이름과 script 이름의 이름표이며, `vite.build`가 이미 카탈로그에 있으니 접두가
//   프레임워크스럽다는 것도 논거가 되지 못했다. 없던 것은 어휘가 아니라 **조건 기구**였다:
//   능력 게이팅 · 이름 있는 2차 산출물 · 배포 타깃별 릴리스 노드 · 릴리스 게이팅 여부.
//   넷을 도출 규칙에 넣자 3종이 노드와 **간선까지** 일치했다.
//
// 프록시 표기: `ingestion.validate`는 `external-ingestion` capability 조건부라 형태만으로는
// 나오지 않는다. 등가 비교에서 제외하되 **제외 목록을 여기 명시**한다 — 조용한 차집합 무시는
// 등가 주장을 공허하게 만든다.
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

// 형태 어휘가 덮는 프로필과 그 형태. Next가 없는 것이 이 표의 요점이다.
const SHAPE_COVERED_PROFILES = {
  'react-vite-spa': ['web-app'],
  'vite-serverless-hybrid': ['web-app', 'serverless-functions'],
  'next-app-fullstack': ['ssr-web-app'],
};

// capability 조건부라 형태만으로는 도출되지 않는 검사 — 명시적 제외.
const CAPABILITY_CONDITIONAL = new Set(['ingestion.validate']);

// 어댑터 task는 자기 id 대신 `commandIds[0]`로 검사를 가리키기도 한다(예: vite.production-boundary
// → vite.production-mock-boundary). 비교는 그 정규화 이름으로 한다.
const taskKey = task => task.commandIds?.[0] ?? task.id;

export const inspectAdapterDerivation = async ({repositoryRoot}) => {
  const errors = [];
  const unverified = [];
  const {loadBuiltinAdapter} = await import('../web-core/adapter-lib.mjs');
  const {deriveGraph} = await import('../derive-execution-graph.mjs');
  const {resolveCommands} = await import('../resolve-commands.mjs');
  const catalog = JSON.parse(readFileSync(join(repositoryRoot, '.claude', 'shape-checks.json'), 'utf8'));

  for (const [profileId, shapes] of Object.entries(SHAPE_COVERED_PROFILES)) {
    let adapter;
    try {
      adapter = loadBuiltinAdapter(profileId);
    } catch (error) {
      errors.push(`adapter-derivation: '${profileId}' 어댑터를 읽지 못했다: ${error.message}`);
      continue;
    }
    const derivedChecks = [
      ...(catalog.common?.checks ?? []),
      ...shapes.flatMap(shape => catalog.shapes?.[shape]?.checks ?? []),
    ];

    // 1) 검사 집합 — 선언과 도출이 같은 id를 낸다
    const declaredCheckIds = new Set(adapter.checks.map(check => check.id).filter(id => !CAPABILITY_CONDITIONAL.has(id)));
    const derivedCheckIds = new Set(derivedChecks.map(check => check.id));
    for (const id of declaredCheckIds) {
      if (!derivedCheckIds.has(id)) errors.push(`adapter-derivation: '${profileId}' 선언 검사 '${id}'를 형태 도출이 내지 않는다 — 도출로 전환하면 이 검사가 사라진다(I2)`);
    }
    for (const id of derivedCheckIds) {
      if (!declaredCheckIds.has(id)) errors.push(`adapter-derivation: '${profileId}' 도출 검사 '${id}'가 어댑터 선언에 없다 — 등가가 아니다`);
    }

    // 2) receiptKind — receipt 요구·타임아웃·artifact 인벤토리를 가르는 축이다. 여기가 어긋나면
    //    "같은 검사"라도 게이트 강도가 달라진다(예: build가 runtime이 되면 clean-build 단언이 죽는다).
    const declaredKind = new Map(adapter.checks.map(check => [check.id, check.kind]));
    for (const check of derivedChecks) {
      if (!declaredKind.has(check.id)) continue;
      if (check.receiptKind !== declaredKind.get(check.id)) {
        errors.push(
          `adapter-derivation: '${profileId}' 검사 '${check.id}'의 receiptKind='${check.receiptKind}'가 어댑터 kind='${declaredKind.get(check.id)}'와 다르다 — ` +
            'receipt 요구와 타임아웃이 달라진다(I2)',
        );
      }
    }

    // 3) 실행 그래프 — 노드 집합**과 간선**이 같아야 한다. 첫 구현은 노드 id만 비교해
    //    "등가"라고 보고했으나 재보니 `release.assemble`의 requires/provides가 달랐다
    //    (도출이 evidence.typecheck를 직접 요구하고, 타깃별 release capability를 내지 않았다).
    //    노드가 같아도 간선이 다르면 **무엇이 릴리스를 막는가**가 달라진다 — 그게 게이트다.
    const {tasks: derivedTasks, errors: deriveErrors} = deriveGraph({
      checks: derivedChecks,
      capabilities: adapter.profileDefaults.capabilities,
      deploymentTargets: adapter.deploymentTargets.map(target => target.id),
      defaultTarget: adapter.profileDefaults.deploymentTarget,
    });
    for (const message of deriveErrors) errors.push(`adapter-derivation: '${profileId}' 도출 실패: ${message}`);
    const declaredTasks = new Map(adapter.tasks.map(task => [taskKey(task), task]));
    const derivedTaskMap = new Map(derivedTasks.map(task => [taskKey(task), task]));
    const sameEdges = (left, right) => [...left].sort().join(',') === [...right].sort().join(',');
    for (const [id, declared] of declaredTasks) {
      if (CAPABILITY_CONDITIONAL.has(id)) continue;
      if (!derivedTaskMap.has(id)) {
        errors.push(`adapter-derivation: '${profileId}' 선언 task '${id}'가 도출 그래프에 없다(I2)`);
      }
    }
    for (const [id, derived] of derivedTaskMap) {
      const declared = declaredTasks.get(id);
      if (!declared) {
        errors.push(`adapter-derivation: '${profileId}' 도출 task '${id}'가 어댑터 선언에 없다`);
        continue;
      }
      if (!sameEdges(declared.requires, derived.requires)) {
        errors.push(
          `adapter-derivation: '${profileId}' task '${id}' requires 불일치 — 선언 [${[...declared.requires].sort().join(', ')}] vs 도출 [${[...derived.requires].sort().join(', ')}] — 무엇이 릴리스를 막는가가 달라진다(I2)`,
        );
      }
      if (!sameEdges(declared.provides, derived.provides)) {
        errors.push(
          `adapter-derivation: '${profileId}' task '${id}' provides 불일치 — 선언 [${[...declared.provides].sort().join(', ')}] vs 도출 [${[...derived.provides].sort().join(', ')}]`,
        );
      }
    }

    // 4) 명령 해석 — `resolve-commands`가 이 repo의 golden 프로젝트에서 선언 command와 같은
    //    argv를 고르는지. golden이 없거나 해석이 0건이면 **미판정을 통과로 바꾸지 않는다**
    //    (첫 구현이 반환 형상을 `{checkId: command}`로 오해해 루프가 공회전했다 — 공허한 PASS였다).
    const goldenRoot = join(repositoryRoot, 'golden', profileId);
    if (!existsSync(goldenRoot)) {
      // golden이 없으면 명령 해석을 대조할 실물이 없다. **미판정이며 통과가 아니다** —
      // 그래프 등가(1~3)는 이미 검증됐고, 이 축만 증거가 없다는 사실을 이름으로 남긴다.
      unverified.push(`${profileId}: 명령 해석 대조 미판정 — golden/${profileId}/가 없다`);
      continue;
    }
    const {resolved, missing} = resolveCommands({projectRoot: goldenRoot, checkIds: [...derivedCheckIds]});
    if (resolved.length === 0) {
      errors.push(
        `adapter-derivation: '${profileId}' golden이 있는데 해석된 명령이 0건이다(missing ${missing.length}) — ` +
          '대조가 공회전했다. 미판정을 통과로 바꾸지 않는다',
      );
      continue;
    }
    const declaredCommand = new Map(adapter.commands.map(command => [command.id, command]));
    let compared = 0;
    for (const command of resolved) {
      const binding = adapter.checks.find(check => check.id === command.id);
      const declared = binding && declaredCommand.get(binding.commandId);
      if (!declared) continue;
      compared += 1;
      // `--ignore-scripts`는 도출에서 의도적으로 뺐다(프로젝트 script 실행이 목적이므로).
      const declaredArgv = [declared.executable, ...(declared.args ?? [])].filter(value => value !== '--ignore-scripts').join(' ');
      const resolvedArgv = [command.executable, ...(command.args ?? [])].join(' ');
      if (declaredArgv !== resolvedArgv) {
        errors.push(`adapter-derivation: '${profileId}' 검사 '${command.id}' 명령 불일치 — 선언 '${declaredArgv}' vs 해석 '${resolvedArgv}'`);
      }
    }
    if (compared === 0) {
      errors.push(`adapter-derivation: '${profileId}' 선언 command와 짝지어진 해석이 0건이다 — 대조가 공회전했다`);
    }
  }
  return {errors, unverified};
};

export const validateAdapterDerivation = async ({repositoryRoot, pass, fail}) => {
  const {errors, unverified} = await inspectAdapterDerivation({repositoryRoot});
  for (const message of errors) fail(message);
  if (errors.length === 0) {
    const suffix = unverified.length > 0 ? `; 미판정 ${unverified.length}건 — ${unverified.join(' / ')}` : '';
    pass(
      `adapter derivation equivalence checked (${Object.keys(SHAPE_COVERED_PROFILES).length} built-in profiles: 검사 집합·receiptKind·그래프 노드와 간선${suffix})`,
    );
  }
};
