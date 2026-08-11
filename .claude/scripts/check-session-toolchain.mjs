#!/usr/bin/env node
// check-session-toolchain.mjs — SessionStart preflight: 세션의 Node가 하네스 pin과 맞는지 조기 경보.
//
// 배경: 세션 기본 Node가 pin(22.x)보다 낮으면 hook·스크립트·빌드가 나중에 이해하기 어려운
// 방식으로 실패한다 (실사고: Node 14에서 hook crash → fail-closed 전면 잠금).
// 이 스크립트는 차단하지 않고 경고만 출력한다 (exit 0) — SessionStart 출력은 세션 컨텍스트에 추가된다.
// Node 14 호환 필수 — 낮은 버전에서야말로 동작해야 하는 스크립트다.

var major = parseInt(process.versions.node.split('.')[0], 10);
var REQUIRED_MAJOR = 22;

if (major < REQUIRED_MAJOR) {
  console.log(
    '[toolchain 경고] 이 세션의 Node는 v' + process.versions.node + ' 인데 web-harness는 Node ' +
    REQUIRED_MAJOR + '+ 를 전제한다 (.nvmrc 참조). pnpm/vite/validate 스크립트가 실패할 수 있으니 ' +
    '명령 실행 시 PATH에 Node ' + REQUIRED_MAJOR + '를 앞세우거나(nvm), 세션을 Node ' +
    REQUIRED_MAJOR + ' 환경에서 재시작할 것.'
  );
}
process.exit(0);
