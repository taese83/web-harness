// 문서 위생 검증. (adapter drift 검사는 2026-08-18 ×3 미러 제거로 소멸 — M4 판정:
// 소비자 0 실증. 파일명의 "adapter"는 이제 .claude/adapters 문서를 포함한 문서 위생을 가리킨다.)
// 검사 항목:
//   1. 잘못된 경로 접두어    — .Codex/ 참조 (canonical은 .claude/, 대소문자 오류 포함)
//   2. 저장소 경로 참조 실존 — .claude/... 형태로 참조된 .md/.mjs/.json 파일이 실존하는지
//   3. 하드코딩 잔재         — 타 프로젝트 이식 잔재 (KartApi 등). 예외는 라인에 lint-allow
//   4. README inventory     — <!-- inventory:skills|agents --> 마커 수치가 실제 개수와 일치
//   5. 스킬 버저닝           — 모든 SKILL.md frontmatter에 metadata.version 존재

import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs'
import {join} from 'node:path'

const DENYLIST = [
  [/KartApi/, '타 프로젝트 API 클래스 잔재 (KartApi)'],
  [/apps\/web-harness/, '스캐폴딩 예시에 harness repo 경로 하드코딩'],
]

const walkMarkdown = (root, out = []) => {
  if (!existsSync(root)) return out
  for (const name of readdirSync(root)) {
    const path = join(root, name)
    if (statSync(path).isDirectory()) walkMarkdown(path, out)
    else if (name.endsWith('.md')) out.push(path)
  }
  return out
}

// source repo 판별 — harness source에서만 존재하는 것(adapter 사본, inventory 마커, 판단 계층)은
// deploy-harness로 배포된 control plane(target 재검증 컨텍스트)에서는 검사하지 않는다.
//   1. deploy-harness가 배포 시 `.claude/deployment.json` 마커를 남긴다.
//   2. 배포본은 settings.project.json이 settings.json으로 복사되므로 두 파일이 byte 동일하다.
// 어느 쪽에도 해당하지 않으면 source repo로 취급해 엄격 검사한다 (fail-closed).
// 단일 소유: 이 판별의 canonical은 이 함수다 — contract-hygiene 등 다른 validator도 import한다.
export const detectSourceRepository = repositoryRoot => {
  const readIfExists = path => (existsSync(path) ? readFileSync(path, 'utf8') : null)
  const settingsSource = readIfExists(join(repositoryRoot, '.claude', 'settings.json'))
  const projectSettingsSource = readIfExists(join(repositoryRoot, '.claude', 'settings.project.json'))
  const isDeployedControlPlane =
    existsSync(join(repositoryRoot, '.claude', 'deployment.json')) ||
    (settingsSource !== null && settingsSource === projectSettingsSource)
  return !isDeployedControlPlane
}

export const validateAdapterHygiene = ({repositoryRoot, pass, fail}) => {
  const isSourceRepository = detectSourceRepository(repositoryRoot)

  const documentFiles = [
    ...walkMarkdown(join(repositoryRoot, '.claude', 'skills')),
    ...walkMarkdown(join(repositoryRoot, '.claude', 'agents')),
  ]

  let pathReferenceCount = 0
  let scannedLines = 0
  for (const file of documentFiles) {
    const relFile = file.slice(repositoryRoot.length + 1)
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, index) => {
      scannedLines += 1
      if (line.includes('lint-allow')) return

      // 1. 잘못된 접두어
      if (/\.Codex\//.test(line)) fail(`${relFile}:${index + 1} — .Codex/ 경로 참조 (canonical은 .claude/)`)

      // 2. 저장소 경로 참조 실존
      for (const match of line.matchAll(/\.claude\/[\w@./-]+\.(?:md|mjs|json)\b/g)) {
        pathReferenceCount += 1
        if (!existsSync(join(repositoryRoot, match[0]))) {
          fail(`${relFile}:${index + 1} — 깨진 저장소 경로 참조: ${match[0]}`)
        }
      }

      // 3. 하드코딩 잔재
      for (const [pattern, reason] of DENYLIST) {
        if (pattern.test(line)) fail(`${relFile}:${index + 1} — ${reason}`)
      }
    })
  }
  pass(`document hygiene scanned (${documentFiles.length} files, ${pathReferenceCount} repo-path references verified)`)

  // 4. README inventory 마커 (source repo 전용 — 배포 target의 README는 하네스 소유가 아님)
  const skillCount = readdirSync(join(repositoryRoot, '.claude', 'skills'), {withFileTypes: true}).filter(e => e.isDirectory()).length
  const agentCount = readdirSync(join(repositoryRoot, '.claude', 'agents')).filter(name => name.endsWith('.md')).length
  if (isSourceRepository) {
    const readme = readFileSync(join(repositoryRoot, 'README.md'), 'utf8')
    for (const [marker, actual, label] of [
      ['inventory:skills', skillCount, 'skill'],
      ['inventory:agents', agentCount, 'agent'],
    ]) {
      // 언어 독립(영문화 선행): "30개 skill" / "30 skills" 둘 다 인식한다. 마커 자체가 없으면
      // 여전히 FAIL이다(조용한 통과 없음).
      const match = readme.match(new RegExp(`(\\d+)\\s*(?:개\\s*)?${label}s?\\s*<!-- ${marker} -->`))
      if (!match) fail(`README.md에 <!-- ${marker} --> 마커 라인이 없다 ("N개 ${label} <!-- ${marker} -->" 또는 "N ${label}s <!-- ${marker} -->" 형태여야 함)`)
      else if (Number(match[1]) !== actual) fail(`README.md ${label} 수치(${match[1]})가 실제(${actual})와 불일치`)
    }
    pass(`README inventory matches reality (${skillCount} skills, ${agentCount} agents)`)
  }

  // 5. 스킬 버저닝
  const skillsDirectory = join(repositoryRoot, '.claude', 'skills')
  const unversioned = []
  for (const name of readdirSync(skillsDirectory, {withFileTypes: true}).filter(e => e.isDirectory()).map(e => e.name)) {
    const skillPath = join(skillsDirectory, name, 'SKILL.md')
    if (!existsSync(skillPath)) continue
    const frontmatter = readFileSync(skillPath, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/)
    if (!frontmatter || !/^metadata:[\s\S]*?^\s+version:\s*\S+/m.test(frontmatter[1])) unversioned.push(name)
  }
  if (unversioned.length) fail(`metadata.version 없는 스킬: ${unversioned.join(', ')}`)
  else pass(`all ${skillCount} skills carry metadata.version`)
}
