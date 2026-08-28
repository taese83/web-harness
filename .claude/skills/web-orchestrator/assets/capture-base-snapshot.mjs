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
//   <out>/<slug>.html   — script 없는 정적 스냅샷
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

const slugFor = route => {
  const cleaned = route.replace(/^[#/]+/, '').replace(/[^a-zA-Z0-9/_-]/g, '-').replace(/\//g, '-')
  return cleaned === '' ? 'index' : cleaned.slice(0, 60)
}

// ── 보존 어휘(allowlist) ────────────────────────────────────────────────────
// **극성이 중요하다.** "PII 패턴을 찾아 지운다"는 열린 집합이라 놓치면 샌다(fail-open).
// 여기서는 반대로 **컴포넌트 문구를 찾아 보존하고 나머지를 치환한다** — 닫힌 집합이라
// 놓치면 멀쩡한 문구가 치환될 뿐 유출되지 않는다(fail-closed).
//
// 보존 어휘의 출처는 프로젝트 소스다: i18n 카탈로그가 있으면 정확하고, 없으면 문자열
// 리터럴을 긁는다. 템플릿 조합(`${name}님 안녕하세요`)의 렌더 결과는 소스에 없으므로
// 치환된다 — 보기엔 어색해지지만 새지 않는다.
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
      if (!/\.(?:ts|tsx|js|jsx|mjs|cjs|json)$/.test(entry.name)) continue
      let text
      try { text = readFileSync(full, 'utf8') } catch { continue }
      for (const match of text.matchAll(/(['"`])((?:(?!\1)[^\\\r\n]|\\.){2,120})\1/g)) {
        const value = match[2].trim()
        if (value.length >= 2) preserved.add(value)
      }
      // JSX 텍스트 노드: >텍스트<
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
// 이메일 전용 분기는 두지 않는다: `@example.test`로 바꿔도 뒤의 일반 규칙이 다시 뭉개
// 마커가 남지 않고, 도메인만 고정 길이가 돼 길이 보존이 깨졌다(실측 `a@b.kr` 6→14,
// 41자 주소 41→25). `@`·`.`는 어차피 통과하므로 일반 규칙만으로 길이가 정확히 남는다.
export const substituteValue = value => value
  .replace(/\d/g, '0')
  .replace(/[가-힣]/g, '○')
  .replace(/[A-Za-z]/g, character => (character === character.toUpperCase() ? 'X' : 'x'))

export const shouldPreserve = (value, preserved) => {
  const trimmed = value.trim()
  if (trimmed === '') return true
  if (preserved.has(trimmed)) return true
  // 템플릿 조합의 접두·접미 매칭: 소스의 리터럴이 렌더 결과에 포함돼 있으면 보존 후보다.
  for (const candidate of preserved) {
    if (candidate.length >= 6 && trimmed.includes(candidate)) return true
  }
  return false
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

const main = async () => {
  const options = parseArguments(process.argv.slice(2))
  const {chromium} = await import('@playwright/test').catch(() => {
    throw new Error('@playwright/test를 찾을 수 없다 — 이 스크립트는 대상 프로젝트에서 실행한다(하네스에는 Playwright가 없다).')
  })

  const preserved = collectPreservedStrings(options.copySource ? resolve(options.copySource) : null)
  const anchorMap = readAnchorMap(options.anchorMap ? resolve(options.anchorMap) : null)

  // 순수 정적 검사이므로 **브라우저를 띄우기 전에** 죽는다.
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
    const url = `${options.base.replace(/\/+$/, '')}${route.startsWith('/') ? route : `/${route}`}`
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
      for (const anchor of anchors) {
        let element = null
        try { element = document.querySelector(anchor.selector) } catch { element = null }
        if (!element) { unmatched.push(anchor.anchorId); continue }
        element.setAttribute('data-wh-anchor', anchor.anchorId)
        element.setAttribute('data-wh-feature', anchor.featureId)
        stamped.push(anchor.anchorId)
      }
      const clone = document.documentElement.cloneNode(true)
      for (const node of clone.querySelectorAll('script')) node.remove()
      return {html: clone.outerHTML, css: sheets.join('\n'), styleMode, title: document.title, stamped, unmatched}
    }, routeAnchors)

    // 매칭 실패를 경고로 흘리지 않는다 — 셀렉터가 낡았다는 뜻이고, 조용히 넘기면
    // 기획 연관 요소에 배지가 없는 채로 승인이 진행된다. **쓰기 전에** 죽어서
    // 앵커 없는 반쪽 바탕이 디스크에 남지 않게 한다(실측: 종전 순서는 남겼다).
    if (captured.unmatched.length > 0) {
      throw new Error(`앵커 셀렉터가 ${route}에서 매칭되지 않았다: ${captured.unmatched.join(', ')} — anchor-map을 고치거나 해당 route를 확인하라`)
    }

    // 문자열 치환은 Node 쪽에서 한다 — 보존 어휘가 파일시스템에서 오기 때문이다.
    let preservedCount = 0
    let substitutedCount = 0
    const sanitized = captured.html.replace(/>([^<>]{2,})</g, (whole, text) => {
      if (shouldPreserve(text, preserved)) { preservedCount += 1; return whole }
      substitutedCount += 1
      return `>${substituteValue(text)}<`
    })

    const slug = slugFor(route)
    const document_ = [
      '<!doctype html>',
      `<!-- web-harness base snapshot — ${url} -->`,
      sanitized.replace('</head>', `<style>${captured.css}</style></head>`),
    ].join('\n')
    writeFileSync(join(outDirectory, `${slug}.html`), `${document_}\n`)
    captures.push({
      route, url, slug, title: captured.title, styleMode: captured.styleMode,
      preservedCount, substitutedCount,
      stampedAnchors: captured.stamped, unmatchedAnchors: captured.unmatched,
    })
    process.stdout.write(`captured ${route} → ${slug}.html (보존 ${preservedCount} / 치환 ${substitutedCount}, 앵커 ${captured.stamped.length}, 스타일 ${captured.styleMode})\n`)

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
    ],
  }, null, 2)}\n`)
  process.stdout.write(`meta.json 기록 — 보존 어휘 ${preserved.size}개\n`)
}

if (process.argv[1] !== undefined && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`)
    process.exit(1)
  })
}
