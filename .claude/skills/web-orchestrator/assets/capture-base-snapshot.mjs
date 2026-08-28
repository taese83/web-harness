#!/usr/bin/env node
// capture-base-snapshot.mjs — 실행 중인 앱의 화면을 **정적 DOM 스냅샷**으로 뜬다.
//
// 왜 이것이 있는가: 프리뷰가 없는 기존 서비스에도 기획 확인 표면이 필요하다. 종전에는
// 실행 중인 앱에 프록시로 오버레이를 주입하는 라이브 델타가 그 역할을 했으나, 런타임 주입이
// CSP·SSR·Shadow DOM에 걸리고 신원 대조·anchorReceipt 같은 부수 기제를 끌고 왔다(2026-08-28
// 제거). 스냅샷은 **이미 렌더된 결과**를 가져오므로 그 클래스가 원리적으로 사라진다.
//
// **이 스크립트는 대상 프로젝트에서 실행한다.** 하네스는 의존성이 0이고 Playwright가 없다 —
// 반면 UI를 가진 프로젝트는 `testLayers.e2e`가 요구하므로 Playwright를 갖고 있다. 하네스는
// 계약과 스크립트를 소유하고, 실행은 프로젝트가 한다(quality gate와 같은 구조).
//
// 사용법(프로젝트 루트에서, dev 서버가 떠 있는 상태로):
//   node capture-base-snapshot.mjs --base http://127.0.0.1:5173 --route / --route /orders \
//     --source src --anchor-map _workspace/02_design/preview/anchor-map.json \
//     --out _workspace/02_design/preview/base
//
// `--source`는 보존 어휘의 출처, `--anchor-map`은 **기획이 어느 요소에 붙는지**의 정본이다.
// 둘 다 없어도 캡처는 되지만, 앵커가 없으면 바탕은 열람 전용이고 배지가 붙지 않는다.
//
// **캡처는 시드/테스트 데이터 상태에서만 한다.** 실사용 데이터가 화면에 있으면 스냅샷이
// 커밋되면서 PII가 git 히스토리에 들어간다. 아래 치환은 안전망이지 면허가 아니다 —
// 이미지·바이너리는 치환 대상이 아니므로 시드 데이터가 근본 방어다.
//
// 산출물:
//   <out>/<slug>.html   — 앱 script 없는 정적 스냅샷(+ 앵커가 있으면 오버레이 부트스트랩 1개)
//   <out>/meta.json     — 캡처 시각·URL·스타일 수집 모드·치환/앵커 통계(스스로를 검증하는 숫자)

import {existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs'
import {join, resolve} from 'node:path'

const parseArguments = argv => {
  const values = {base: null, routes: [], out: null, copySource: null, anchorMap: null, viewport: {width: 1280, height: 900}}
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (key === '--base') values.base = argv[++index]
    else if (key === '--route') values.routes.push(argv[++index])
    else if (key === '--out') values.out = argv[++index]
    else if (key === '--source') values.copySource = argv[++index]
    else if (key === '--anchor-map') values.anchorMap = argv[++index]
    else if (key === '--width') values.viewport.width = Number(argv[++index])
    else if (key === '--height') values.viewport.height = Number(argv[++index])
    else throw new Error(`Unknown argument: ${key}`)
  }
  if (!values.base) throw new Error('--base <dev server origin> is required')
  if (!/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(values.base.replace(/\/+$/, ''))) {
    throw new Error('--base must be a loopback origin (http://127.0.0.1:<port>)')
  }
  if (values.routes.length === 0) values.routes.push('/')
  if (!values.out) throw new Error('--out <directory> is required')
  return values
}

export const normalizeRoute = route => (String(route).startsWith('/') ? String(route) : `/${route}`)

export const slugFor = route => {
  const cleaned = route.replace(/^[#/]+/, '').replace(/[^a-zA-Z0-9/_-]/g, '-').replace(/\//g, '-')
  return cleaned === '' ? 'index' : cleaned.slice(0, 60)
}

// slug가 겹치면 뒤 캡처가 앞을 덮어써 한 화면이 조용히 사라진다(`/a/b`와 `/a-b`가 같은 slug).
export const findSlugCollisions = routes => {
  const bySlug = new Map()
  for (const route of routes) {
    const slug = slugFor(route)
    bySlug.set(slug, [...(bySlug.get(slug) ?? []), route])
  }
  return [...bySlug.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([slug, group]) => `${slug}.html ← ${group.join(', ')}`)
}

// ── 보존 어휘(allowlist) ────────────────────────────────────────────────────
// **극성이 중요하다.** "PII 패턴을 찾아 지운다"는 열린 집합이라 놓치면 샌다(fail-open).
// 여기서는 반대로 **컴포넌트 문구를 찾아 보존하고 나머지를 치환한다** — 닫힌 집합이라
// 놓치면 멀쩡한 문구가 치환될 뿐 유출되지 않는다(fail-closed).
//
// 보존 어휘의 출처는 프로젝트 소스다: i18n 카탈로그가 있으면 정확하고, 없으면 문자열
// 리터럴을 긁는다.
const SOURCE_FILE_PATTERN = /\.(?:ts|tsx|js|jsx|mjs|cjs|json|vue|svelte|astro|html)$/

export const collectPreservedStrings = sourceRoot => {
  const preserved = new Set()
  if (!sourceRoot || !existsSync(sourceRoot)) return preserved
  const stack = [sourceRoot]
  const seen = new Set()
  while (stack.length > 0) {
    const current = stack.pop()
    let entries
    try { entries = readdirSync(current, {withFileTypes: true}) } catch { continue }
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
        if (seen.has(full)) continue
        seen.add(full)
        stack.push(full)
        continue
      }
      if (!SOURCE_FILE_PATTERN.test(entry.name)) continue
      let text
      try { text = readFileSync(full, 'utf8') } catch { continue }
      for (const match of text.matchAll(/(['"`])((?:(?!\1)[^\\\r\n]|\\.){2,120})\1/g)) {
        const value = match[2].trim()
        if (value.length >= 2) preserved.add(value)
      }
      // 템플릿 텍스트 노드: >텍스트<  (JSX·Vue·Svelte·Astro·HTML 공통 형태)
      for (const match of text.matchAll(/>\s*([^<>{}\n]{2,120}?)\s*</g)) {
        const value = match[1].trim()
        if (value.length >= 2) preserved.add(value)
      }
    }
  }
  return preserved
}

// 형태 보존 치환 — 레이아웃이 검토 대상이므로 길이·모양을 유지한다.
// `***`로 바꾸면 긴 이름이 줄바꿈되는 문제 같은 것을 못 본다.
//
// 문자 클래스는 **유니코드 속성**으로 나눈다. 종전에는 `[가-힣]`·`[A-Za-z]`·`\d`만 다뤄서
// 일본어·한자·키릴·악센트 라틴·전각 숫자가 identity로 통과하면서 substitutedCount만
// 올랐다 — "치환 200"이 실제 마스킹 0을 뜻할 수 있었다(적대 리뷰 HIGH). 이제 글자·숫자가
// 스크립트와 무관하게 덮이고, `[가-힣]` 하드코딩도 사라진다(I3).
//
// 이메일 전용 분기는 두지 않는다: `@example.test`로 바꿔도 뒤의 일반 규칙이 다시 뭉개
// 마커가 남지 않고, 도메인만 고정 길이가 돼 길이 보존이 깨졌다(실측 `a@b.kr` 6→14,
// 41자 주소 41→25). `@`·`.`는 어차피 통과하므로 일반 규칙만으로 길이가 정확히 남는다.
export const substituteValue = value => value
  .replace(/\p{Nd}/gu, '0')
  .replace(/[\p{Lu}\p{Lt}]/gu, 'X')
  .replace(/[\p{Ll}\p{Lm}]/gu, 'x')
  .replace(/\p{Lo}/gu, '○')

// 소스 리터럴이 렌더 결과에 **부분**으로 나타날 때 얼마나 길어야 보존 구간으로 인정하는가.
// 짧을수록 우연 일치로 실데이터 조각이 살아남는다.
const MIN_PRESERVED_SPAN = 6

export const shouldPreserve = (value, preserved) => {
  const trimmed = value.trim()
  return trimmed === '' || preserved.has(trimmed)
}

// 보존은 **구간 단위**다. 종전에는 소스 리터럴이 6자 이상이고 렌더 결과에 포함되기만 하면
// 문자열 **전체**를 보존했다 — `'Signed in as ' + email`처럼 접두 리터럴이 있으면
// `Signed in as jane@corp.com` 전체가 그대로 남아 이메일이 커밋됐다(적대 리뷰 HIGH,
// fail-open). 이제 매칭된 구간만 보존하고 나머지는 치환하므로, 템플릿 조합의 고정부는
// 읽히고 변수부는 마스킹된다.
export const maskValue = (value, preserved) => {
  if (shouldPreserve(value, preserved)) return value
  const keep = new Array(value.length).fill(false)
  for (const candidate of preserved) {
    if (candidate.length < MIN_PRESERVED_SPAN) continue
    let from = value.indexOf(candidate)
    while (from !== -1) {
      for (let index = from; index < from + candidate.length; index += 1) keep[index] = true
      from = value.indexOf(candidate, from + 1)
    }
  }
  // 코드포인트 단위로 걷는다 — surrogate pair를 반쪽씩 다루면 astral 문자가 그대로 샌다.
  let masked = ''
  let index = 0
  while (index < value.length) {
    const point = String.fromCodePoint(value.codePointAt(index))
    masked += keep[index] ? point : substituteValue(point)
    index += point.length
  }
  return masked
}

// 앵커 맵 — **기획이 어느 요소에 붙는지는 사람이 말한다.** 추측하지 않는다.
//   {"anchors": [{"anchorId": "wh-feat-021-list", "featureId": "FEAT-021",
//                 "route": "/orders", "selector": "#rows"}]}
//
// 오버레이는 **traceability에 있는 앵커만 배지**한다(브라운필드 바탕의 과거 스탬프가
// 빈 패널을 띄우던 실측 때문). 그래서 이 맵이 곧 "무엇에 배지가 붙는가"의 정본이다.
export const readAnchorMap = path => {
  if (!path) return []
  const parsed = JSON.parse(readFileSync(path, 'utf8'))
  const anchors = Array.isArray(parsed?.anchors) ? parsed.anchors : []
  for (const anchor of anchors) {
    for (const field of ['anchorId', 'featureId', 'route', 'selector']) {
      if (typeof anchor?.[field] !== 'string' || anchor[field].trim() === '') {
        throw new Error(`anchor-map 항목에 ${field}가 없다: ${JSON.stringify(anchor)}`)
      }
    }
  }
  return anchors
}

// 선언됐지만 어느 route에서도 확인되지 않을 앵커. 조용히 사라지면 배지가 빠진 채 승인이 난다.
export const findOrphanedAnchors = (anchorMap, routes) => {
  const captured = new Set(routes.map(normalizeRoute))
  return anchorMap
    .filter(anchor => !captured.has(normalizeRoute(anchor.route)))
    .map(anchor => `${anchor.anchorId}(${anchor.route})`)
}

// 오버레이 부트스트랩 — 프리뷰 산출물의 자기완결 원칙을 따른다(외부 로드 없음).
// 바탕은 `preview/base/`에 놓이므로 `preview/`의 오버레이·traceability를 한 단계 위에서 읽는다.
// Console이 프리뷰를 iframe으로 감싸므로 변경요청 채널은 부모 postMessage로 성립한다 —
// consoleOrigin·projectId를 여기에 굽지 않는다(그것이 델타 킷이 하던 신원 결속이다).
export const OVERLAY_BOOTSTRAP = [
  '<script type="module" data-wh-overlay-bootstrap>',
  "import {initWhOverlay} from '../wh-overlay.mjs'",
  "initWhOverlay({traceabilityUrl: '../traceability.json'})",
  '</script>',
].join('\n')

const injectBeforeBodyEnd = (html, snippet) =>
  html.includes('</body>') ? html.replace('</body>', () => `${snippet}\n</body>`) : `${html}\n${snippet}`

// 실데이터를 자주 나르면서 텍스트 노드 치환이 닿지 않는 속성들.
const SENSITIVE_ATTRIBUTES = /\s(value|title|alt|placeholder|aria-label)="([^"]*)"/gi

// 브라우저에서 걷어온 결과를 **파일로 쓸 문서**로 만든다. Playwright 없이 검증할 수 있도록
// 순수 함수로 뗀다 — 종전에는 미매칭 throw와 치환이 main() 안에 있어서 `if (false)`로
// 바꿔도 CI가 green이었다(적대 리뷰 MEDIUM: 배선 미결박).
export const finalizeCapture = ({captured, route, url, preserved}) => {
  // 매칭 실패를 경고로 흘리지 않는다 — 셀렉터가 낡았다는 뜻이고, 조용히 넘기면
  // 기획 연관 요소에 배지가 없는 채로 승인이 진행된다. **쓰기 전에** 죽어서
  // 앵커 없는 반쪽 바탕이 디스크에 남지 않게 한다(실측: 종전 순서는 남겼다).
  if (captured.unmatched.length > 0) {
    throw new Error(`앵커 셀렉터가 ${route}에서 매칭되지 않았다: ${captured.unmatched.join(', ')} — anchor-map을 고치거나 해당 route를 확인하라`)
  }
  // 한 셀렉터가 여러 요소에 걸리면 의도 밖 요소에 배지가 붙는데 아무 신호가 없다.
  if (captured.ambiguous.length > 0) {
    throw new Error(`앵커 셀렉터가 ${route}에서 여러 요소에 걸린다: ${captured.ambiguous.join(', ')} — 셀렉터를 유일하게 좁혀라`)
  }

  let preservedCount = 0
  let substitutedCount = 0
  const mask = text => {
    const masked = maskValue(text, preserved)
    if (masked === text) preservedCount += 1
    else substitutedCount += 1
    return masked
  }
  // 1자 텍스트 노드도 대상이다 — `<span>김</span><span>철수</span>`처럼 인라인 태그로
  // 쪼개진 이름이 하한 때문에 통째로 남던 구멍을 막는다.
  const sanitized = captured.html
    .replace(/>([^<>]+)</g, (whole, text) => `>${mask(text)}<`)
    .replace(SENSITIVE_ATTRIBUTES, (whole, name, text) => ` ${name}="${mask(text)}"`)

  const withStyles = sanitized.replace('</head>', () => `<style>${captured.css}</style></head>`)
  // 오버레이는 **치환 뒤에** 넣는다. 치환 정규식이 `>본문<`을 잡으므로 먼저 넣으면
  // 스크립트 본문이 통째로 치환돼 import 문이 깨진다.
  const withOverlay = captured.stamped.length > 0 ? injectBeforeBodyEnd(withStyles, OVERLAY_BOOTSTRAP) : withStyles

  return {
    html: `${['<!doctype html>', `<!-- web-harness base snapshot — ${url} -->`, withOverlay].join('\n')}\n`,
    // title도 마스킹한다 — 종전에는 원문이 meta.json에 그대로 커밋됐다(적대 리뷰 HIGH).
    title: maskValue(captured.title ?? '', preserved),
    preservedCount,
    substitutedCount,
    overlayBootstrapped: captured.stamped.length > 0,
  }
}

const main = async () => {
  const options = parseArguments(process.argv.slice(2))
  const {chromium} = await import('@playwright/test').catch(() => {
    throw new Error('@playwright/test를 찾을 수 없다 — 이 스크립트는 대상 프로젝트에서 실행한다(하네스에는 Playwright가 없다).')
  })

  const preserved = collectPreservedStrings(options.copySource ? resolve(options.copySource) : null)
  const anchorMap = readAnchorMap(options.anchorMap ? resolve(options.anchorMap) : null)

  // 순수 정적 검사이므로 **브라우저를 띄우기 전에** 죽는다.
  const collisions = findSlugCollisions(options.routes)
  if (collisions.length > 0) {
    throw new Error(`route가 같은 파일명으로 떨어진다: ${collisions.join(' / ')} — route를 줄이거나 이름을 바꿔라`)
  }
  const orphaned = findOrphanedAnchors(anchorMap, options.routes)
  if (orphaned.length > 0) {
    throw new Error(`anchor-map이 캡처하지 않은 route를 가리킨다: ${orphaned.join(', ')} — --route를 추가하거나 맵에서 빼라`)
  }
  const outDirectory = resolve(options.out)
  mkdirSync(outDirectory, {recursive: true})

  const browser = await chromium.launch()
  const context = await browser.newContext({viewport: options.viewport})
  const page = await context.newPage()
  const captures = []

  for (const route of options.routes) {
    const url = `${options.base.replace(/\/+$/, '')}${normalizeRoute(route)}`
    await page.goto(url, {waitUntil: 'networkidle'})

    const routeAnchors = anchorMap.filter(anchor => normalizeRoute(anchor.route) === normalizeRoute(route))
    const captured = await page.evaluate(anchors => {
      // 스타일 수집: 반응형이 살아 있다. cross-origin 시트는 읽을 수 없으므로 그때만
      // computed 인라인으로 떨어진다 — 어느 모드였는지 메타에 남긴다.
      let styleMode = 'stylesheets'
      const sheets = []
      for (const sheet of document.styleSheets) {
        try {
          sheets.push([...sheet.cssRules].map(rule => rule.cssText).join('\n'))
        } catch {
          styleMode = 'computed-fallback'
        }
      }
      for (const adopted of document.adoptedStyleSheets ?? []) {
        try { sheets.push([...adopted.cssRules].map(rule => rule.cssText).join('\n')) } catch { styleMode = 'computed-fallback' }
      }
      // 앵커는 **복제본이 아니라 원본**에 스탬프한다 — 셀렉터가 원본 문서 기준이기 때문이다.
      const stamped = []
      const unmatched = []
      const ambiguous = []
      for (const anchor of anchors) {
        let found = []
        try { found = [...document.querySelectorAll(anchor.selector)] } catch { found = [] }
        if (found.length === 0) { unmatched.push(anchor.anchorId); continue }
        if (found.length > 1) { ambiguous.push(`${anchor.anchorId}(${found.length})`); continue }
        found[0].setAttribute('data-wh-anchor', anchor.anchorId)
        found[0].setAttribute('data-wh-feature', anchor.featureId)
        stamped.push(anchor.anchorId)
      }
      const clone = document.documentElement.cloneNode(true)
      for (const node of clone.querySelectorAll('script')) node.remove()
      return {html: clone.outerHTML, css: sheets.join('\n'), styleMode, title: document.title, stamped, unmatched, ambiguous}
    }, routeAnchors)

    const finalized = finalizeCapture({captured, route, url, preserved})
    const slug = slugFor(route)
    writeFileSync(join(outDirectory, `${slug}.html`), finalized.html)
    captures.push({
      route, url, slug, title: finalized.title, styleMode: captured.styleMode,
      preservedCount: finalized.preservedCount, substitutedCount: finalized.substitutedCount,
      stampedAnchors: captured.stamped, overlayBootstrapped: finalized.overlayBootstrapped,
    })
    process.stdout.write(`captured ${route} → ${slug}.html (보존 ${finalized.preservedCount} / 치환 ${finalized.substitutedCount}, 앵커 ${captured.stamped.length}, 스타일 ${captured.styleMode})\n`)
  }

  await browser.close()

  // 메타는 스스로를 검증하는 숫자를 담는다: 치환이 0이면 보존 어휘가 과하게 잡힌 것이고,
  // 과도하게 많으면 시드가 아니라 실데이터로 띄웠을 수 있다.
  writeFileSync(join(outDirectory, 'meta.json'), `${JSON.stringify({
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    base: options.base,
    viewport: options.viewport,
    preservedVocabulary: preserved.size,
    anchorsDeclared: anchorMap.length,
    captures,
    limits: [
      '이미지·canvas·바이너리는 치환 대상이 아니다 — 시드 데이터가 근본 방어다.',
      'closed shadow root와 cross-origin iframe은 직렬화되지 않는다.',
      'styleMode가 computed-fallback이면 반응형이 유효하지 않다.',
      `치환 대상 속성은 ${'value·title·alt·placeholder·aria-label'} 뿐이다 — 그 밖의 속성(data-*·href·srcset 등)과 HTML 주석은 원문으로 남는다.`,
      '수집한 CSS는 치환하지 않는다 — content 속성에 넣은 문구는 원문으로 남는다.',
      '보존 어휘 수집은 소스 파일의 문자열 리터럴·템플릿 텍스트에 한한다. 서버에서만 오는 문구는 어휘에 없어 치환된다.',
    ],
  }, null, 2)}\n`)
  process.stdout.write(`meta.json 기록 — 보존 어휘 ${preserved.size}개\n`)

  // 앵커 0개 바탕은 승인 판정에서 INVALID다. 그 사실을 승인 시점이 아니라 **여기서** 알린다 —
  // 캡처를 막지는 않는다(바탕 먼저 뜨고 anchor-map을 나중에 쓰는 순서가 정상이다).
  if (captures.every(capture => capture.stampedAnchors.length === 0)) {
    process.stderr.write(
      '경고: 앵커가 하나도 스탬프되지 않았다 — 이 바탕으로는 승인할 수 없다(배지가 없다).\n'
      + '      --anchor-map으로 {anchorId, featureId, route, selector}를 주고 다시 캡처하라.\n',
    )
  }
}

if (process.argv[1] !== undefined && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`)
    process.exit(1)
  })
}
