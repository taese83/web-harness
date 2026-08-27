// orchestration-surface.mjs — "web 오케스트레이션 표면"의 단일 정의.
//
// 2026-08-27 이전에는 표면 = `web-orchestrator/SKILL.md` 한 파일이었고, 검사 8곳이 각자 그
// 경로를 하드코딩했다. Phase 2/3/4 본문을 시점 로드 참조로 강등하자(진입 비용 63,653→45,512B)
// 그 8곳이 전부 조용히 눈이 멀었다 — 게이트가 15건 FAIL로 잡아냈다.
//
// 경로를 다시 하드코딩하면 다음 강등에서 같은 일이 반복된다. 그래서 표면을 **glob으로** 정의한다:
// SKILL.md + `references/phase-*.md` 전부. 새 Phase 파일이 생겨도 검사가 자동으로 따라간다.
//
// 프록시 표기: 이것은 "오케스트레이터가 이 문장을 읽는다"가 아니라 "표면에 이 문장이 있다"만
// 본다. 시점 로드는 모델이 실제로 읽어야 발화하므로, 산문 존재가 실행을 보장하지는 않는다
// (기계 게이트 — receipt·release gate — 는 이 층에 의존하지 않는다).
import {existsSync, readdirSync, readFileSync} from 'node:fs'
import {join} from 'node:path'

const SKILL_DIRECTORY = '.claude/skills/web-orchestrator'

export const orchestrationSurfaceFiles = repositoryRoot => {
  const files = [`${SKILL_DIRECTORY}/SKILL.md`]
  const referencesDirectory = join(repositoryRoot, SKILL_DIRECTORY, 'references')
  if (existsSync(referencesDirectory)) {
    for (const name of readdirSync(referencesDirectory).sort()) {
      if (/^phase-.+\.md$/.test(name)) files.push(`${SKILL_DIRECTORY}/references/${name}`)
    }
  }
  return files
}

export const orchestrationSurface = repositoryRoot =>
  orchestrationSurfaceFiles(repositoryRoot)
    .map(relativePath => readFileSync(join(repositoryRoot, relativePath), 'utf8'))
    .join('\n')
