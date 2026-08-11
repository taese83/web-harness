#!/usr/bin/env node
// record-verification.mjs — brownfield(기존 프로젝트) 개발용 경량 검증 receipt 래퍼.
//
// 배경: 하네스의 quality-gates/receipt 체계는 자체 생성 프로젝트 구조를 전제한다.
// 기존 모노레포에서 기능을 개발할 때는 "검증했다"는 산문 대신, 실제 실행한 명령과
// exit code, 실행 위치(cwd)를 기계 기록으로 남긴다 — 잘못된 cwd/스코프에서 나온
// 가짜 green(false verification)을 receipt 자체가 드러내게 하는 것이 목적이다.
//
// 사용법:
//   node .claude/scripts/record-verification.mjs --project <dir> --label <name> -- <command...>
//   예) node .claude/scripts/record-verification.mjs --project workspace/my-app --label typecheck \
//       -- pnpm --filter my-app typecheck
//
// ⚠️ subagent에서 호출할 때: global Bash 정책이 감싼 명령을 **허용된 pnpm script 실행으로 제한**한다
// (래퍼 하나로 정책 전체가 우회되는 것을 막기 위함 — `pnpm exec <bin>`·임의 명령은 거부된다).
// main 세션은 정책 면제이므로 사람이 직접 쓰는 경로에는 제한이 없다.
//
// 기록: <project>/_workspace/03_dev/verification-receipts.jsonl 에 append
//   {"label","command","cwd","exitCode","durationMs","timestamp"}
// 종료코드: 감싼 명령의 exit code를 그대로 전달한다 (기록 실패 시에만 2).
// Node 14 호환 유지 — 세션 기본 Node가 낮아도 receipt 기록은 항상 동작해야 한다.

import {spawnSync} from 'node:child_process';
import {appendFileSync, mkdirSync, realpathSync} from 'node:fs';
import {join, resolve} from 'node:path';

const argv = process.argv.slice(2);
const separatorIndex = argv.indexOf('--');
if (separatorIndex === -1) {
  console.error('사용법: record-verification.mjs --project <dir> --label <name> -- <command...>');
  process.exit(2);
}
const options = argv.slice(0, separatorIndex);
const command = argv.slice(separatorIndex + 1);
const valueOf = flag => {
  const index = options.indexOf(flag);
  return index === -1 ? undefined : options[index + 1];
};
const projectDir = valueOf('--project');
const label = valueOf('--label');
if (!projectDir || !label || command.length === 0) {
  console.error('--project, --label, `--` 뒤의 명령이 모두 필요하다.');
  process.exit(2);
}

let projectRoot;
try {
  projectRoot = realpathSync(resolve(projectDir));
} catch (error) {
  console.error(`project 디렉터리가 없다: ${projectDir}`);
  process.exit(2);
}

const startedAt = Date.now();
const result = spawnSync(command[0], command.slice(1), {
  cwd: projectRoot,
  stdio: 'inherit',
  env: process.env,
});
const exitCode = typeof result.status === 'number' ? result.status : 1;

const receipt = {
  label,
  command: command.join(' '),
  cwd: projectRoot,
  exitCode,
  durationMs: Date.now() - startedAt,
  timestamp: new Date().toISOString(),
};

try {
  const receiptDir = join(projectRoot, '_workspace', '03_dev');
  mkdirSync(receiptDir, {recursive: true});
  appendFileSync(join(receiptDir, 'verification-receipts.jsonl'), JSON.stringify(receipt) + '\n');
  console.log(`[receipt] ${label} exit=${exitCode} cwd=${projectRoot}`);
} catch (error) {
  console.error(`receipt 기록 실패: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

process.exit(exitCode);
