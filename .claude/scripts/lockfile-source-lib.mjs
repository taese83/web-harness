// lockfile-source-lib.mjs — lockfile의 dependency **출처**가 공개 레지스트리인지 판정한다.
//
// 2026-08-27 첫 eval receipt가 결함을 잡았다: 판정이 lockfile **텍스트 전체**에서 URL 모양을
// 찾아, 사람이 읽는 `deprecated:` 안내문 속 URL까지 dependency source로 오인했다. 실제 이웃
// repo lockfile에 들어 있던 URL이 `https://eslint.org/version-support`와
// `https://nextjs.org/blog/CVE-2025-66478`이다 — **보안 권고 URL이 적혔다는 이유로 install을
// 막는 것은 정확히 거꾸로다.** eslint를 쓰는 어떤 프로젝트도 설치할 수 없었다.
//
// 방향 표기(I2): 아래 목록은 **denylist**이며 allowlist가 아니다. pnpm이 새 *출처* 필드를
// 추가하면 그 필드는 여전히 검사된다(fail-closed 방향). 새 *산문* 필드가 URL을 담으면 오탐이
// 나지만 그건 시끄럽게 막히므로 조용한 통과가 아니다. allowlist였다면 반대가 된다.
// pnpm-lock v9 package snapshot에 **실재하는** 산문 필드는 `deprecated` 하나다(실측: 이웃 repo
// lockfile 5종). 목록을 넓히면 이득 없이 "값을 지우는 키" 표면만 커지고, 나중에 pnpm이 그 키로
// fetch 가능한 값을 흘리면 스스로 눈을 가린다(적대 검토 지적). 실재하는 것만 둔다.
const INERT_METADATA_FIELD = /^(\s*)(deprecated)\s*:/i

// 산문 필드의 **값 전체**를 지운다. 키는 남겨 구조를 보존한다.
//
// 값의 범위는 **들여쓰기**로 정한다 — 키보다 더 깊게 들여쓴 줄은 전부 그 값이다. 이 한 규칙이
// YAML의 네 형태를 모두 덮는다: 한 줄 plain · 접힌 plain 다중행 · 따옴표 다중행 · block
// scalar(`>`/`|`, `|2`·`>4` 같은 들여쓰기 지시자 포함). 형태별 특수 처리는 하나를 놓친다 —
// 첫 구현이 `>`/`|` 리터럴만 보다가 나머지 세 형태를 놓쳤고 적대 검토가 잡았다.
//
// **과다 제거가 아닌 이유**: 더 깊게 들여쓴 줄은 YAML도 스칼라 내용으로 읽는다. 거기 `resolution:`을
// 숨겨도 pnpm이 fetch하지 않는다 — 지우는 범위와 pnpm이 무시하는 범위가 같은 의미론을 쓴다.
// 같은 들여쓰기의 줄은 값을 끝내므로 검사 대상으로 남는다.
export const stripInertMetadata = source => {
  const kept = []
  let valueIndent = null
  for (const line of source.split('\n')) {
    if (valueIndent !== null) {
      if (line.trim() === '' || line.match(/^\s*/)[0].length > valueIndent) continue
      valueIndent = null
    }
    const match = INERT_METADATA_FIELD.exec(line)
    if (!match) {
      kept.push(line)
      continue
    }
    valueIndent = match[1].length
    kept.push(`${match[1]}${match[2]}: <metadata elided>`)
  }
  return kept.join('\n')
}

// 출처 위반을 이유와 함께 돌려준다. 빈 배열이면 공개 레지스트리 출처만 쓴 것이다.

// ── 워크스페이스 내부 링크 ────────────────────────────────────────────────────
// pnpm 모노레포는 `workspace:<name>` 명세를 lockfile에 `link:<상대경로>`로 해석해 적는다.
// 따라서 **모든 pnpm 워크스페이스 lockfile은 필연적으로 `link:`를 포함한다** — 프로토콜만 보고
// 막으면 모노레포는 install이 불가능하다(2026-08-27 실측: optimize-web 차단).
//
// 원래 `link:`/`file:`을 막은 이유는 **프로젝트 밖의 코드**를 끌어와 install script를 실행할 수
// 있어서다. 그러니 판정 기준은 프로토콜이 아니라 **대상이 루트 안인가**여야 한다.
//   `link:../common`(packages/ab-ui 기준) → packages/common  → 내부, 허용
//   `link:../../../../evil`               → 루트 밖          → 차단 유지
//
// `workspace:<name>`은 경로가 아니라 이름이며 pnpm이 선언된 워크스페이스 안에서만 해석한다 —
// 워크스페이스 밖을 가리킬 수 없으므로 허용한다.
//
// importer 문맥이 필요하다: 같은 `link:../common`도 어느 importer 아래냐에 따라 대상이 다르다.
// lockfile의 `importers:` 절을 훑어 현재 importer를 추적하고, 그 디렉터리 기준으로 해석한다.
// **문맥을 모르면 루트 기준으로 본다** — 가장 보수적이라 `../` 하나로도 밖이 된다.
// 상대경로는 `../x`·`./x`·`x` 세 형태 전부다 — pnpm은 루트 importer의 워크스페이스 의존을
// `link:packages/common`처럼 **접두 없이** 적는다(실측). `/`나 `~`로 시작하면 절대경로다.
const LINK_LIKE = /(?<![A-Za-z0-9])(file|link|portal):([^\s'",}\]]+)/g
const isRelativePath = target => target !== '' && !target.startsWith('/') && !target.startsWith('~')

const resolvesInsideRoot = (importer, target) => {
  const base = importer === '.' ? [] : importer.split('/').filter(Boolean)
  const segments = [...base]
  for (const part of target.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (segments.length === 0) return false // 루트 위로 올라갔다
      segments.pop()
      continue
    }
    segments.push(part)
  }
  return true
}

// lockfile을 훑어 importer 문맥과 함께 링크형 출처를 낸다.
export const collectLinkSources = source => {
  const found = []
  let inImporters = false
  let importer = '.'
  for (const line of source.split('\n')) {
    if (/^[A-Za-z_$][\w$]*\s*:/.test(line)) {
      inImporters = /^importers\s*:/.test(line)
      importer = '.'
    } else if (inImporters) {
      const key = /^ {2}(\S[^:]*)\s*:\s*$/.exec(line)
      if (key) importer = key[1].trim().replace(/^['"]|['"]$/g, '')
    }
    for (const match of line.matchAll(LINK_LIKE)) {
      const target = match[2]
      found.push({
        protocol: match[1],
        target,
        importer,
        relative: isRelativePath(target),
        // 절대경로는 문맥과 무관하게 밖이다.
        inside: isRelativePath(target) && resolvesInsideRoot(importer, target),
      })
    }
  }
  return found
}

// **호출 계약**: 이 함수는 출처만 판정한다. YAML anchor/alias/merge(`<<`) 같은 모호성 거부는
// 호출자가 **원문에** 선행해서 걸어야 한다(`rejectAmbiguousYaml`). strip은 alias를 해석하지
// 않으므로, 선행 거부 없이 이 함수만 쓰면 alias로 출처를 숨길 수 있다.
export const inspectLockfileSource = rawSource => {
  const source = stripInertMetadata(rawSource)
  const violations = []
  for (const value of source.match(/[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s,'"}]+/g) ?? []) {
    let parsed
    try {
      parsed = new URL(value)
    } catch {
      violations.push(`unparseable URL: ${value}`)
      continue
    }
    if (
      parsed.protocol !== 'https:' ||
      parsed.hostname !== 'registry.npmjs.org' ||
      parsed.port ||
      parsed.username ||
      parsed.password
    ) violations.push(`non-registry URL: ${value}`)
  }
  // 식별자 일부(`excludeLinksFromLockfile:`)나 metadata 값(`engines: {npm: '>=6'}`)이 아니라
  // 실제 dependency source protocol일 때만 잡는다: 앞은 비식별자 경계, 뒤는 값이 붙어 있어야 한다
  // `workspace:`는 이름이지 경로다 — pnpm이 선언된 워크스페이스 안에서만 해석하므로 제외한다.
  // `file:`/`link:`/`portal:`의 **상대경로 형태**는 아래에서 루트 포함 여부로 따로 판정한다.
  if (/(?:git\+|(?<![A-Za-z0-9])(?:github|gitlab|bitbucket|npm):(?=['"]?[^\s'"])|\.pnpmfile)/i.test(source)) {
    violations.push('local or VCS dependency source protocol')
  }
  for (const link of collectLinkSources(source)) {
    if (link.inside) continue
    violations.push(
      link.relative
        ? `dependency source escapes the project root: ${link.protocol}:${link.target} (importer ${link.importer})`
        : `absolute local dependency source: ${link.protocol}:${link.target}`,
    )
  }
  // `patch:`는 경로 판정 대상이 아니다 — pnpm patch 파일은 프로젝트 안의 `patches/`를 가리키며
  // 형태가 다르다. 별도 판단으로 남기고 여기서는 다루지 않는다.
  if (/(?<![A-Za-z0-9])patch:(?=['"]?[^\s'"])/i.test(source)) violations.push('patch protocol dependency source')
  // 비-https scheme을 출처 자리에서 잡는다. **전용 규칙이 따로 보는 둘은 제외한다** —
  // `workspace:`(이름 기반, 워크스페이스 안에서만 해석)와 상대경로 `file:`/`link:`/`portal:`
  // (위에서 루트 포함 여부로 판정). 제외하지 않으면 모노레포가 여기서 다시 막힌다.
  if (/(?:^|[\s,[{])['"]?(?!https:\/\/)(?!workspace:)(?!(?:file|link|portal):)[A-Za-z][A-Za-z0-9+.-]*:[^\s'"}]/im.test(source)) {
    violations.push('non-https scheme in a dependency source position')
  }
  if (/(?:^|[\s,[{])['"]?\/\/[^\s]/m.test(source)) violations.push('protocol-relative dependency source')
  return violations
}
