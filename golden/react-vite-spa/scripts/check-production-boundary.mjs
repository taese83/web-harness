#!/usr/bin/env node
// production mock-boundary 게이트 — 프로덕션 번들에 mock/dev 전용 아티팩트가 새지 않는지 검사한다.
// 이 골든은 mock을 쓰지 않으므로 dist에 금지 문자열이 없어야 한다(있으면 게이트 실패).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const distDir = 'dist';
const FORBIDDEN = ['mockServiceWorker', 'msw/browser', 'setupWorker', '__MOCK__'];

if (!existsSync(distDir)) {
  console.error('production-boundary: dist/ 없음 — build를 먼저 실행해야 한다');
  process.exit(1);
}

const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(js|mjs|css|html)$/.test(name)) out.push(p);
  }
  return out;
};

const offenders = [];
for (const file of walk(distDir)) {
  const text = readFileSync(file, 'utf8');
  for (const needle of FORBIDDEN) {
    if (text.includes(needle)) offenders.push(`${file}: ${needle}`);
  }
}

if (offenders.length > 0) {
  console.error('production-boundary FAIL — 금지 아티팩트가 프로덕션 번들에 존재:');
  for (const o of offenders) console.error(`  - ${o}`);
  process.exit(1);
}

console.log('production-boundary PASS — mock/dev 아티팩트 누출 없음');
