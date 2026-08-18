// 프로그레시브 섹션 로딩 검증 — read-skill-section.mjs가 카탈로그 3종의 대표 섹션을
// 정확히(경계 보존·다음 섹션 미누출) 해석하는지 실행으로 확인한다.
//
// 유래: validate-harness.mjs 인라인 블록에서 추출(2026-08-18, UI 레인 이원화로 400줄 한도
// 초과 시점). §4 "스크립트 400줄 제한" 행의 지시("병합으로 줄이지 말 것. 실질 해소는
// validator 모듈 추출")를 따른 첫 실제 추출이다.
//
// UI 레인 검사는 대칭이 계약이다: mui와 tailwind-shadcn 스니펫이 같은 방식으로 해석되지
// 않으면 한 레인만 조용히 열화된다(library-setup 키맵은 하드코딩이라 섹션 추가 시 키맵
// 누락이 12키 전체를 exit 2로 죽인다 — 이 검사가 그 함정을 CI에서 잡는다).

import {spawnSync} from 'node:child_process'
import {join} from 'node:path'

export function validateSectionReaders({claudeDirectory, repositoryRoot, read, pass, fail}) {
  const projectInitSkill = read('.claude/skills/project-init/SKILL.md')
  const sectionReaderPath = join(claudeDirectory, 'scripts', 'read-skill-section.mjs')

  if (!projectInitSkill.includes('read-skill-section.mjs --catalog project-templates --section')) {
    fail('project-init does not use progressive template section loading')
  }

  const runSection = (catalog, section) =>
    spawnSync(process.execPath, [sectionReaderPath, '--catalog', catalog, '--section', section], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    })

  const templateSectionRun = runSection('project-templates', 'PR_TEMPLATE')
  if (templateSectionRun.status !== 0 || !templateSectionRun.stdout.includes('## 작업 내용')) {
    fail('template section reader does not preserve fenced nested headings')
  }
  if (templateSectionRun.stdout.includes('## CODEOWNERS')) fail('template section reader leaks the next section')

  // UI 레인 2종 대칭 검사(M4 UI 다양화) — 각 레인 스니펫이 동일 규약으로 해석돼야 한다.
  for (const [section, expected] of [
    ['mui', 'MUI (Material UI)'],
    ['tailwind-shadcn', 'Tailwind CSS + shadcn/ui'],
  ]) {
    const run = runSection('library-setup', section)
    if (run.status !== 0 || !run.stdout.includes(expected)) {
      fail(`library setup section reader cannot resolve the ${section} snippet`)
    }
    if (run.stdout.includes('## Recharts')) fail(`${section} section reader leaks the next section`)
  }

  pass('progressive template and setup snippet loading checked (both UI lanes)')
}
