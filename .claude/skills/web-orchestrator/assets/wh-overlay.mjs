// wh-overlay.mjs — 기획 추적 오버레이 공용 런타임 (닷+호버 배지 표준의 정본 구현)
// 디자인 프리뷰(풀/부분 프로토타입)가 이 파일을 로드한다.
// 생성 시 이 템플릿을 산출물 디렉토리로 복사한다(자기완결 원칙 — 외부 로드 없음).
//
// 사용:
//   import {initWhOverlay} from './wh-overlay.mjs'
//   initWhOverlay()                                  // 프로토타입: ./traceability.json 자동
//   initWhOverlay({traceabilityUrl, consoleOrigin, projectId})  // 델타: bootstrap이 주입
//
// 변경 요청 채널(순서대로 시도): ① 신뢰된 Console 부모(iframe) postMessage(schemaVersion 1)
// ② consoleOrigin 딥링크 새 탭(#project=..&tab=features&feature=..&anchor=..&openCR=1)
// ③ 둘 다 없으면 action 숨김.

const STYLE = `
#wh-trace-overlay-layer { position: fixed; inset: 0; z-index: 99990; pointer-events: none; }
.wh-trace-overlay-hidden #wh-trace-overlay-layer, .wh-trace-overlay-hidden .wh-side-panel-scrim { display: none; }
.wh-feature-badge { position: fixed; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: 50%; background: transparent; cursor: pointer; overflow: visible; pointer-events: auto; }
.wh-feature-badge__dot { width: 8px; height: 8px; border-radius: 50%; background: #2f6fed; border: 1px solid #2f6fed; box-shadow: 0 0 0 3px rgba(47,111,237,.18); transition: transform .12s, box-shadow .12s; }
.wh-feature-badge--asis .wh-feature-badge__dot { background: #9aa3af; border-color: #9aa3af; box-shadow: 0 0 0 3px rgba(154,163,175,.2); }
.wh-feature-badge__label { position: absolute; top: calc(100% - 2px); right: 0; width: max-content; padding: 5px 8px; border: 1px solid #2f6fed; border-radius: 6px; background: #fff; color: #2f6fed; font: 700 11px/1 system-ui; box-shadow: 0 2px 8px rgba(0,0,0,.12); opacity: 0; pointer-events: none; transform: translateY(-4px); transition: opacity .12s, transform .12s; white-space: nowrap; }
.wh-feature-badge[data-placement="above"] .wh-feature-badge__label { top: auto; bottom: calc(100% - 2px); transform: translateY(4px); }
.wh-feature-badge:hover .wh-feature-badge__dot, .wh-feature-badge:focus-visible .wh-feature-badge__dot, .wh-feature-badge[aria-expanded="true"] .wh-feature-badge__dot { transform: scale(1.35); }
.wh-feature-badge:hover .wh-feature-badge__label, .wh-feature-badge:focus-visible .wh-feature-badge__label, .wh-feature-badge[aria-expanded="true"] .wh-feature-badge__label { opacity: 1; transform: translateY(0); }
.wh-overlay-toggle { position: fixed; top: 12px; right: 12px; z-index: 99993; padding: 6px 10px; border: 1px solid #d1d5db; border-radius: 8px; background: #fff; color: #374151; font: 600 12px/1.2 system-ui; cursor: pointer; box-shadow: 0 1px 3px rgba(0,0,0,.1); pointer-events: auto; }
.wh-side-panel-scrim { position: fixed; inset: 0; z-index: 99991; background: rgba(15,23,42,.35); }
.wh-side-panel { position: fixed; top: 0; right: 0; bottom: 0; z-index: 99992; width: min(380px, 92vw); overflow-y: auto; padding: 18px 18px 24px; background: #fff; box-shadow: -4px 0 20px rgba(0,0,0,.18); font: 13px/1.5 system-ui; color: #1f2937; }
.wh-side-panel h2 { margin: 0; font-size: 15px; }
.wh-side-panel .wh-sp-id { font: 700 11px/1 system-ui; color: #2f6fed; }
.wh-side-panel .wh-sp-scope { margin: 8px 0 0; padding: 6px 8px; border-radius: 6px; background: #f3f4f6; font-size: 12px; color: #4b5563; }
.wh-side-panel .wh-sp-scope--add { background: #eef4ff; color: #1d4ed8; }
.wh-side-panel h3 { margin: 16px 0 6px; font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: .04em; }
.wh-side-panel .wh-sp-tc { margin: 0 0 8px; padding: 8px 10px; border: 1px solid #e5e7eb; border-radius: 8px; }
.wh-side-panel .wh-sp-tc strong { font-size: 12px; }
.wh-side-panel dl { margin: 6px 0 0; }
.wh-side-panel dt { float: left; clear: left; width: 44px; font-weight: 700; color: #6b7280; font-size: 11px; }
.wh-side-panel dd { margin: 0 0 2px 50px; font-size: 12px; }
.wh-side-panel .wh-sp-close { position: absolute; top: 10px; right: 10px; border: 0; background: #f3f4f6; border-radius: 6px; width: 26px; height: 26px; cursor: pointer; }
.wh-side-panel .wh-sp-cr { margin-top: 16px; width: 100%; padding: 9px 0; border: 0; border-radius: 8px; background: #2f6fed; color: #fff; font: 700 13px/1 system-ui; cursor: pointer; }
`

// rAF는 숨김 탭(백그라운드 iframe·pane)에서 발화하지 않는다 — hidden이면 setTimeout 폴백.
const defer = callback => document.visibilityState === 'hidden'
  ? setTimeout(callback, 120)
  : requestAnimationFrame(callback)

const el = (tag, attrs = {}, children = []) => {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'text') node.textContent = value
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value)
    else node.setAttribute(key, value)
  }
  for (const child of children) if (child) node.append(child)
  return node
}

export const initWhOverlay = (options = {}) => {
  const params = new URLSearchParams(location.search)
  // 핸드셰이크 파라미터는 앱의 리다이렉트 체인(SSO 로그인·세션 복원)에서 URL이 갈리며
  // 유실된다(실측) — 첫 로드에서 sessionStorage에 영속해 같은 탭 내내 유지한다.
  const handshake = key => {
    const value = params.get(key)
    if (value) { try { sessionStorage.setItem(`wh-overlay:${key}`, value) } catch { /* storage 불가 시 무시 */ } }
    try { return value ?? sessionStorage.getItem(`wh-overlay:${key}`) } catch { return value }
  }
  const config = {
    traceabilityUrl: options.traceabilityUrl ?? './traceability.json',
    traceability: options.traceability ?? null,
    consoleOrigin: options.consoleOrigin ?? handshake('whConsoleOrigin'),
    projectId: options.projectId ?? handshake('whProject'),
    root: options.root ?? document,
  }
  const state = {trace: null, visible: true, frame: null, trigger: null}
  // 콘솔 "프리뷰에서 위치 열기" 딥링크(whAnchor·whOpen=1) — 앵커가 나타나는 첫 attach에서
  // 1회만 스크롤·패널 오픈한다(그린필드 프로토타입과 같은 파라미터 규약).
  const reveal = {anchorId: params.get('whAnchor'), open: params.get('whOpen') === '1'}

  document.head.append(el('style', {'data-wh-overlay': 'styles', text: STYLE}))
  const layer = el('div', {id: 'wh-trace-overlay-layer', 'aria-label': '기능 추적 오버레이'})
  document.body.append(layer)
  const toggle = el('button', {class: 'wh-overlay-toggle', type: 'button', 'aria-pressed': 'true', text: '기능 배지 숨기기'})
  toggle.addEventListener('click', () => {
    state.visible = !state.visible
    document.body.classList.toggle('wh-trace-overlay-hidden', !state.visible)
    toggle.setAttribute('aria-pressed', String(state.visible))
    toggle.textContent = state.visible ? '기능 배지 숨기기' : '기능 배지 표시'
  })
  document.body.append(toggle)

  const featureOf = id => (state.trace?.features ?? []).find(f => f.featureId === id)
  const anchorMeta = anchorId => (state.trace?.anchors ?? []).find(a => a.anchorId === anchorId)
  // 스키마 세대 별칭 — 그린필드 세대(description·howTo·feature 내장 testCases)와 델타
  // 세대(summary·behavior·최상위 testCases)를 같은 패널로 렌더한다(표면 간 통일).
  const summaryOf = feature => feature.summary ?? feature.description
  const behaviorOf = meta => meta.behavior ?? meta.howTo
  const testCaseById = id =>
    (state.trace?.testCases ?? []).find(tc => tc.testCaseId === id)
    ?? (state.trace?.features ?? []).flatMap(f => f.testCases ?? []).find(tc => tc.testCaseId === id)
  const testCasesFor = ids => (ids ?? []).map(id => testCaseById(id) ?? {testCaseId: id})

  // 신뢰된 Console 부모(iframe) 확인 — consoleOrigin이 명시된 경우에만.
  const trustedParent = () =>
    window.parent !== window && config.consoleOrigin ? {target: window.parent, origin: config.consoleOrigin} : null

  const closePanel = restoreFocus => {
    document.getElementById('wh-side-panel')?.remove()
    document.querySelector('.wh-side-panel-scrim')?.remove()
    document.removeEventListener('keydown', onPanelKeydown)
    state.trigger?.setAttribute('aria-expanded', 'false')
    if (restoreFocus && state.trigger && document.contains(state.trigger)) state.trigger.focus()
    state.trigger = null
  }

  const onPanelKeydown = event => {
    if (event.key === 'Escape') { event.preventDefault(); return closePanel(true) }
    if (event.key !== 'Tab') return
    const panel = document.getElementById('wh-side-panel')
    const focusable = [...panel.querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"])')].filter(node => !node.disabled)
    if (focusable.length === 0) return
    const [first, last] = [focusable[0], focusable[focusable.length - 1]]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  const requestChange = context => {
    const parent = trustedParent()
    if (parent) {
      // 콘솔 preview-message-contract(schemaVersion 1)와 동일한 type이어야 수신된다.
      parent.target.postMessage({
        type: 'web-harness:request-change', schemaVersion: 1,
        featureId: context.featureId, subFeatureId: context.subFeatureId ?? null, anchorId: context.anchorId,
      }, parent.origin)
      return
    }
    if (config.consoleOrigin && config.projectId) {
      const query = new URLSearchParams({project: config.projectId, tab: 'features', feature: context.featureId, anchor: context.anchorId, openCR: '1'})
      if (context.subFeatureId) query.set('subfeature', context.subFeatureId)
      window.open(`${config.consoleOrigin}/#${query.toString()}`, '_blank', 'noopener')
    }
  }

  const openPanel = (badge, anchorId) => {
    closePanel(false)
    const meta = anchorMeta(anchorId) ?? {anchorId}
    const feature = featureOf(meta.featureId) ?? {featureId: meta.featureId ?? '?', title: ''}
    const sub = meta.subFeatureId ? (feature.subFeatures ?? []).find(s => s.subFeatureId === meta.subFeatureId) : null
    const scopeIsAdd = /add/i.test(feature.scope ?? '') || !/기존|as-?is/i.test(feature.scope ?? '')
    const canRequest = Boolean(trustedParent() || (config.consoleOrigin && config.projectId))

    const panel = el('aside', {id: 'wh-side-panel', class: 'wh-side-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': `${sub?.subFeatureId ?? feature.featureId} 상세`}, [
      el('button', {class: 'wh-sp-close', type: 'button', 'aria-label': '닫기', text: '✕', onClick: () => closePanel(true)}),
      el('div', {class: 'wh-sp-id', text: sub?.subFeatureId ?? feature.featureId}),
      el('h2', {text: sub?.title ?? feature.title}),
      (sub?.description ?? summaryOf(feature)) ? el('p', {text: sub?.description ?? summaryOf(feature)}) : null,
      el('p', {class: `wh-sp-scope${scopeIsAdd ? ' wh-sp-scope--add' : ''}`, text: scopeIsAdd ? '이번 변경의 신규/변경 기능 — 승인 대상입니다.' : '기존(as-is) 표면 — 관찰 전용이며 이번 승인 대상이 아닙니다.'}),
      behaviorOf(meta) ? el('div', {}, [el('h3', {text: '현재 화면에서 수행'}), el('p', {text: behaviorOf(meta)})]) : null,
    ])
    const tcs = testCasesFor(sub?.testCaseIds ?? meta.testCaseIds ?? feature.testCaseIds)
    if (tcs.length > 0) {
      panel.append(el('h3', {text: `Test Case · ${tcs.length}`}))
      for (const tc of tcs) {
        const detail = tc.given || tc.when || tc.then
          ? el('dl', {}, [
            el('dt', {text: 'Given'}), el('dd', {text: tc.given ?? '—'}),
            el('dt', {text: 'When'}), el('dd', {text: tc.when ?? '—'}),
            el('dt', {text: 'Then'}), el('dd', {text: tc.then ?? '—'}),
          ])
          : (tc.description ? el('p', {text: tc.description}) : null)
        panel.append(el('div', {class: 'wh-sp-tc'}, [el('strong', {text: tc.testCaseId}), detail]))
      }
    }
    if (canRequest) {
      panel.append(el('button', {
        class: 'wh-sp-cr', type: 'button', text: '변경 요청',
        onClick: () => requestChange({featureId: feature.featureId, subFeatureId: sub?.subFeatureId, anchorId}),
      }))
    }
    document.body.append(el('div', {class: 'wh-side-panel-scrim', onClick: () => closePanel(true)}), panel)
    document.addEventListener('keydown', onPanelKeydown)
    state.trigger = badge
    badge.setAttribute('aria-expanded', 'true')
    panel.querySelector('.wh-sp-close').focus()
  }

  const position = () => {
    state.frame = null
    for (const badge of layer.querySelectorAll('.wh-feature-badge')) {
      const anchor = config.root.querySelector(`[data-wh-anchor="${badge.dataset.whAnchorId}"]`)
      if (!anchor) { badge.hidden = true; continue }
      const rect = anchor.getBoundingClientRect()
      badge.hidden = rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth || (rect.width === 0 && rect.height === 0)
      if (badge.hidden) continue
      const size = 32, edge = 4
      badge.style.left = `${Math.min(innerWidth - size - edge, Math.max(edge, rect.right - size / 2))}px`
      badge.style.top = `${Math.min(innerHeight - size - edge, Math.max(edge, rect.top - size / 2))}px`
      badge.dataset.placement = rect.top > innerHeight - 90 ? 'above' : 'below'
    }
  }
  const schedule = () => { if (state.frame === null) state.frame = defer(position) || -1 }

  const warnedAnchors = new Set()
  const attach = () => {
    layer.replaceChildren()
    const seen = new Set()
    for (const anchor of config.root.querySelectorAll('[data-wh-anchor]')) {
      const anchorId = anchor.getAttribute('data-wh-anchor')
      if (seen.has(anchorId)) continue
      const meta = anchorMeta(anchorId)
      // 미지 앵커는 배지 금지 — 브라운필드 바탕에는 과거 하네스 산출물 등 traceability 밖의
      // data-wh-anchor 스탬프가 있을 수 있고, 배지하면 조회 실패로 빈 패널이 뜬다(실측).
      if (!meta) {
        if (!warnedAnchors.has(anchorId)) {
          warnedAnchors.add(anchorId)
          console.warn(`[wh-overlay] traceability에 없는 앵커 — 배지 생략: ${anchorId}`)
        }
        continue
      }
      seen.add(anchorId)
      const featureId = anchor.getAttribute('data-wh-subfeature') ?? anchor.getAttribute('data-wh-feature') ?? meta.featureId ?? '?'
      const feature = featureOf(meta.featureId ?? featureId)
      const isAsIs = /기존|as-?is/i.test(feature?.scope ?? '')
      const badge = el('button', {
        class: `wh-feature-badge${isAsIs ? ' wh-feature-badge--asis' : ''}`, type: 'button',
        'aria-label': `${featureId} 기능 설명 열기`, 'aria-expanded': 'false',
        onClick: event => { event.stopPropagation(); openPanel(badge, anchorId) },
      }, [
        el('span', {class: 'wh-feature-badge__dot', 'aria-hidden': 'true'}),
        el('span', {class: 'wh-feature-badge__label', 'aria-hidden': 'true', text: featureId}),
      ])
      badge.dataset.whAnchorId = anchorId
      layer.append(badge)
    }
    schedule()
    if (reveal.anchorId && seen.has(reveal.anchorId)) {
      const anchorId = reveal.anchorId
      reveal.anchorId = null
      const target = config.root.querySelector(`[data-wh-anchor="${anchorId}"]`)
      target?.scrollIntoView({block: 'center', inline: 'center'})
      if (reveal.open) {
        const badge = [...layer.querySelectorAll('.wh-feature-badge')].find(b => b.dataset.whAnchorId === anchorId)
        if (badge) defer(() => openPanel(badge, anchorId))
      }
    } else if (reveal.anchorId && !reveal.activated) {
      // 앵커가 아직 DOM에 없으면 traceability의 activation(트리거 클릭, 예: 다이얼로그
      // 열기)을 1회 시도한다 — 안전한 id 셀렉터의 버튼만.
      const activation = anchorMeta(reveal.anchorId)?.activation
      if (activation?.event === 'click' && /^#[a-zA-Z][\w-]*$/.test(activation.selector ?? '')) {
        reveal.activated = true
        const trigger = config.root.querySelector(activation.selector)
        if (trigger instanceof HTMLButtonElement) trigger.click()
      }
    }
  }

  const load = config.traceability
    ? Promise.resolve(config.traceability)
    : fetch(config.traceabilityUrl, {cache: 'no-store'}).then(response => {
      if (!response.ok) throw new Error(`traceability ${response.status}`)
      return response.json()
    })
  load.then(trace => {
    state.trace = trace
    attach()
  }).catch(error => console.warn('[wh-overlay] traceability 로드 실패 — 배지 비활성:', error.message))

  addEventListener('resize', schedule, {passive: true})
  addEventListener('scroll', schedule, {passive: true, capture: true})

  // 자기오염 가드: 오버레이 자신(레이어·패널·토글)의 변화는 무시하고, 앱 DOM 변화만
  // rAF 디바운스로 재부착한다 — 없으면 replaceChildren이 observer를 다시 깨워 무한 루프.
  let attachFrame = null
  const ownedNode = node => node instanceof Element
    && (layer.contains(node) || node.closest?.('#wh-side-panel, .wh-side-panel-scrim, .wh-overlay-toggle') !== null
      || node.id === 'wh-side-panel' || node.classList?.contains('wh-side-panel-scrim'))
  new MutationObserver(mutations => {
    if (mutations.every(mutation => ownedNode(mutation.target))) return
    if (attachFrame === null) attachFrame = defer(() => { attachFrame = null; attach() }) || -1
  }).observe(document.body, {childList: true, subtree: true})

  return {refresh: attach, close: () => closePanel(false)}
}
