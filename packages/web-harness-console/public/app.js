import {
  PREVIEW_CHANGE_REQUEST_CLOSED,
  PREVIEW_MESSAGE_SCHEMA_VERSION,
  isTrustedPreviewMessageSource,
  parsePreviewChangeRequestMessage,
} from './preview-message-contract.mjs'

const elements = {
  projectList: document.querySelector('#project-list'),
  projectCount: document.querySelector('#project-count'),
  projectTitle: document.querySelector('#project-title'),
  projectPath: document.querySelector('#project-path'),
  scanTime: document.querySelector('#scan-time'),
  refreshButton: document.querySelector('#refresh-button'),
  message: document.querySelector('#global-message'),
  runStatusLive: document.querySelector('#run-status-live'),
  tabs: [...document.querySelectorAll('[role="tab"]')],
  content: document.querySelector('#content'),
}

const state = {
  catalog: null,
  detail: null,
  projectId: null,
  tab: 'overview',
  documentPath: null,
  featureId: null,
  subFeatureId: null,
  previewAnchorId: null,
  previewOrigin: null,
  previewPane: null,
  // 단계 탭 재구성(2026-08-20): Features(기능/변경), Design(시안/프리뷰) 서브탭 상태.
  featuresPane: 'features',
  designPane: 'design',
  focusChangeRequestId: null,
  codexConnection: null,
  codexPollTimer: null,
  loading: false,
}

const create = (tag, options = {}, children = []) => {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(options)) {
    if (key === 'className') node.className = value
    else if (key === 'text') node.textContent = value
    else if (key === 'dataset') Object.assign(node.dataset, value)
    else if (key.startsWith('aria-')) node.setAttribute(key, value)
    else if (key in node) node[key] = value
    else node.setAttribute(key, value)
  }
  node.append(...children.filter(Boolean))
  return node
}

const formatTime = source => source ? new Intl.DateTimeFormat('ko-KR', {hour: '2-digit', minute: '2-digit', second: '2-digit'}).format(new Date(source)) : '—'
const formatBytes = bytes => bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`
const extension = path => path.includes('.') ? `.${path.split('.').at(-1).toLowerCase()}` : ''
const statusClass = status => `status-${String(status).toLowerCase()}`
const statusChip = status => create('span', {className: `status-chip ${statusClass(status)}`, text: status})
const statusMessage = preview => ({
  APPROVED: '현재 설계 입력과 승인된 프리뷰 해시가 일치합니다.',
  STALE: '승인 후 설계 문서 또는 프리뷰가 변경됐습니다. 재생성과 재승인이 필요합니다.',
  UNAPPROVED: '추적 정보는 유효하지만 아직 사용자 승인이 기록되지 않았습니다.',
  DRAFT: '프리뷰가 생성됐지만 설계 입력 snapshot이 아직 고정되지 않았습니다.',
  MISSING: 'Legacy 프리뷰이거나 traceability.json이 없습니다.',
  INVALID: '프리뷰 추적 정보 또는 승인 기록이 유효하지 않습니다.',
  ABSENT: '이 프로젝트에는 디자인 프리뷰가 없습니다.',
}[preview.status] ?? preview.status)

// Console은 표시 전용이고 재생성·승인 기록은 하네스 세션의 소유이므로, 상태별 다음 행동을
// 명령 수준으로 안내해 루프 단절 지점에서 인수인계를 잇는다.
const statusNextAction = preview => ({
  APPROVED: '다음 행동: 개발 게이트가 열려 있습니다. 하네스 세션에서 /web-orchestrator Phase 3(개발)를 진행하세요.',
  STALE: '다음 행동: 하네스 세션에서 바뀐 스펙 기준으로 프리뷰를 재생성하고 snapshot을 고정한 뒤(validate-design-preview.mjs --write-source-snapshot) 동작 확인 후 재승인(--record-approval)하세요. 재승인 전까지 Phase 3 개발은 BLOCKED입니다.',
  UNAPPROVED: '다음 행동: Preview 탭에서 test case 동작을 직접 확인한 뒤 아래에서 승인을 기록하세요. 하네스 세션의 validate-design-preview.mjs --record-approval도 계속 유효합니다.',
  DRAFT: '다음 행동: 하네스 세션에서 validate-design-preview.mjs --write-source-snapshot으로 설계 입력 snapshot을 고정하세요.',
  INVALID: '다음 행동: 하네스 세션에서 design-review.md의 승인 기록과 traceability.json을 점검하세요.',
}[preview.status] ?? null)

// UNAPPROVED 프리뷰의 승인 폼 — 상태 dialog 안에서 단일 표면으로 기록한다.
const buildPreviewApprovalForm = (preview, {onSuccess = null} = {}) => {
  if (preview.status !== 'UNAPPROVED' || !preview.sourceDigest || !preview.previewDigest) return null
  const approvalError = create('p', {className: 'panel-copy preview-approval-error', hidden: true})
  const attested = create('input', {type: 'checkbox', id: 'preview-approval-attested'})
  const attestedLabel = create('label', {htmlFor: 'preview-approval-attested', text: 'Preview 탭에서 이 프리뷰의 test case 동작을 직접 확인했습니다.'})
  const approvalText = create('input', {type: 'text', maxLength: 500, className: 'preview-approval-text', placeholder: '승인 문구 (한 줄, 500자 이내)', 'aria-label': '승인 문구'})
  const submit = create('button', {type: 'button', className: 'preview-approval-submit', text: '프리뷰 승인 기록', disabled: true})
  const syncSubmit = () => { submit.disabled = !(attested.checked && approvalText.value.trim()) }
  attested.addEventListener('change', syncSubmit)
  approvalText.addEventListener('input', syncSubmit)
  submit.addEventListener('click', async () => {
    submit.disabled = true
    approvalError.hidden = true
    try {
      const result = await mutateApi(`/api/projects/${encodeURIComponent(state.projectId)}/preview-approval`, {
        approvalText: approvalText.value.trim(),
        sourceDigest: preview.sourceDigest,
        previewDigest: preview.previewDigest,
      }, crypto.randomUUID(), 'record-preview-approval')
      onSuccess?.()
      state.detail = await api(`/api/projects/${encodeURIComponent(state.projectId)}`)
      const project = state.catalog.projects.find(candidate => candidate.id === state.projectId)
      if (project) project.preview.status = result.status
      renderProjectNavigation()
      renderContent()
      showMessage('프리뷰 승인을 기록했습니다. 개발 게이트가 열렸습니다 — 하네스 세션에서 Phase 3를 진행할 수 있습니다.')
    } catch (requestError) {
      approvalError.textContent = `승인을 기록하지 못했습니다: ${requestError.message}`
      approvalError.hidden = false
      syncSubmit()
    }
  })
  return create('div', {className: 'preview-approval-form'}, [
    create('div', {className: 'preview-approval-attest'}, [attested, attestedLabel]),
    approvalText,
    submit,
    approvalError,
  ])
}

// 상태 chip 클릭 또는 '프리뷰 승인' 버튼으로 여는 상태 dialog — 모든 상태에서 설명과 다음
// 행동을 보여주고, UNAPPROVED일 때만 승인 폼을 포함하는 단일 승인 표면이다.
const openPreviewStatusDialog = (preview, trigger = null) => {
  const dialog = create('dialog', {className: 'change-request-dialog preview-status-dialog', 'aria-labelledby': 'preview-status-title'})
  const body = create('div', {className: 'change-request-form'})
  const closeIcon = create('button', {type: 'button', className: 'icon-button', 'aria-label': '프리뷰 상태 닫기', text: '×'})
  body.append(
    create('header', {className: 'request-dialog-header'}, [
      create('div', {}, [create('span', {className: 'eyebrow', text: 'DESIGN PREVIEW'}), create('h2', {id: 'preview-status-title', text: '프리뷰 상태'})]),
      closeIcon,
    ]),
    create('div', {className: 'preview-status-dialog-row'}, [statusChip(preview.status)]),
    create('p', {className: 'panel-copy', text: statusMessage(preview)}),
  )
  const nextAction = statusNextAction(preview)
  if (nextAction) body.append(create('p', {className: 'panel-copy preview-next-action', text: nextAction}))
  let approved = false
  const approvalForm = buildPreviewApprovalForm(preview, {onSuccess: () => { approved = true; dialog.close('approved') }})
  if (approvalForm) body.append(approvalForm)
  else {
    const closeAction = create('button', {type: 'button', className: 'secondary-button', text: '닫기'})
    closeAction.addEventListener('click', () => dialog.close('cancel'))
    body.append(create('footer', {className: 'request-dialog-actions'}, [closeAction]))
  }
  dialog.append(body)
  closeIcon.addEventListener('click', () => dialog.close('cancel'))
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close('cancel')
  })
  dialog.addEventListener('close', () => {
    dialog.remove()
    if (!approved && trigger?.isConnected) trigger.focus()
  })
  document.body.append(dialog)
  dialog.showModal()
}

const statusChipButton = preview => {
  const button = create('button', {
    type: 'button',
    className: `status-chip status-chip-button ${statusClass(preview.status)}`,
    text: preview.status,
    'aria-label': `프리뷰 상태 ${preview.status} — 상세와 다음 행동 보기`,
  })
  button.addEventListener('click', () => openPreviewStatusDialog(preview, button))
  return button
}

const showMessage = (message, error = false) => {
  elements.message.hidden = !message
  elements.message.textContent = message ?? ''
  elements.message.style.borderColor = error ? '#fda29b' : ''
  elements.message.style.color = error ? '#b42318' : ''
  elements.message.style.background = error ? '#fef3f2' : ''
  // 오류 배너는 상단 고정 요소라 카드 위치에서 클릭한 사용자에게 안 보인다("반응 없음" 실측)
  if (message && error) elements.message.scrollIntoView({behavior: 'smooth', block: 'nearest'})
}

const api = async path => {
  // x-web-harness-ui: 커스텀 헤더는 cross-origin에서 CORS preflight 없이는 실을 수 없다
  // — 외부 페이지의 blind GET이 프록시 생성 등 읽기 경로의 부작용을 트리거하지 못하게 한다.
  const response = await fetch(path, {headers: {accept: 'application/json', 'x-web-harness-ui': '1'}})
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error?.message ?? `HTTP ${response.status}`)
  return payload
}

const mutateApi = async (path, body, idempotencyKey, intent = 'create-change-request') => {
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-web-harness-intent': intent,
      'idempotency-key': idempotencyKey,
    },
    body: JSON.stringify(body),
  })
  const payload = await response.json()
  if (!response.ok) {
    const error = new Error(payload.error?.message ?? `HTTP ${response.status}`)
    error.code = payload.error?.code ?? null
    throw error
  }
  return payload
}

// 임베드 웹뷰(콘솔의 기본 표시 환경)는 confirm/alert 네이티브 다이얼로그를 소리 없이
// 무시한다(실측: confirm이 다이얼로그 없이 즉시 false 반환) — 차단형 다이얼로그로
// 확인을 받으면 클릭이 무반응이 된다. 같은 버튼을 4초 안에 한 번 더 누르게 하는
// 무장(arm) 확인으로 대체한다.
const armedClick = (button, armedLabel, run) => {
  if (button.dataset.armed !== 'true') {
    const original = button.textContent
    button.dataset.armed = 'true'
    button.textContent = armedLabel
    setTimeout(() => {
      if (button.dataset.armed === 'true' && !button.disabled) {
        button.dataset.armed = ''
        button.textContent = original
      }
    }, 4000)
    return
  }
  button.dataset.armed = ''
  run()
}

// 라이브 베이스 시작 명령 행(복사 + 2단계 시작 + 인라인 오류) — Preview 헬스 카드와
// Development 탭이 공유한다. recheck는 시작 요청 뒤 헬스 재확인 콜백.
const buildStartHintRow = (hint, recheck) => {
  const rowError = create('p', {className: 'live-health-inline-error', hidden: true})
  return create('div', {className: 'live-health-command'}, [
    create('code', {text: hint.command}),
    create('button', {type: 'button', className: 'secondary-button', text: '복사', onclick: event => {
      const button = event.currentTarget
      navigator.clipboard?.writeText(hint.command)
      button.textContent = '복사됨'
      setTimeout(() => { button.textContent = '복사' }, 1500)
    }}),
    create('button', {type: 'button', className: 'primary-button', text: '시작', title: `launch.json "${hint.name}" 항목을 repo 루트에서 실행합니다`, onclick: event => {
      const button = event.currentTarget
      armedClick(button, '한 번 더 누르면 실행', async () => {
        button.disabled = true
        button.textContent = '시작 중…'
        rowError.hidden = true
        try {
          await mutateApi('/api/live-base/start', {project: state.projectId, entry: hint.name}, crypto.randomUUID(), 'start-live-base')
          setTimeout(recheck, 1500)
          // 스폰은 됐지만 서버가 계속 무응답이면 버튼을 되살려 재시도를 허용한다.
          setTimeout(() => {
            if (button.disabled && document.contains(button)) {
              button.disabled = false
              button.textContent = '시작'
              rowError.textContent = '시작 요청은 접수됐지만 서버가 아직 응답하지 않습니다 — 잠시 후 다시 시도하거나 터미널에서 명령을 직접 실행해 로그를 확인하세요.'
              rowError.hidden = false
            }
          }, 20000)
        } catch (error) {
          button.disabled = false
          button.textContent = '시작'
          rowError.textContent = `시작 실패: ${error.message}`
          rowError.hidden = false
        }
      })
    }}),
    rowError,
  ])
}

const deleteApi = async (path, intent = 'delete-change-request') => {
  const response = await fetch(path, {
    method: 'DELETE',
    headers: {accept: 'application/json', 'x-web-harness-intent': intent},
  })
  if (response.status === 204) return
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error?.message ?? `HTTP ${response.status}`)
}

const parseLocation = () => {
  const params = new URLSearchParams(location.hash.replace(/^#/, ''))
  return {
    projectId: params.get('project'),
    tab: params.get('tab') ?? 'overview',
    documentPath: params.get('document'),
    featureId: params.get('feature'),
    subFeatureId: params.get('subfeature'),
    previewAnchorId: params.get('anchor'),
    pane: params.get('pane'),
    changeRequestId: /^CHG-\d{8}-\d{3}$/.test(params.get('change') ?? '') ? params.get('change') : null,
    openCR: params.get('openCR') === '1',
  }
}

// URL의 서브탭(pane) 복원 — 구형 tab=preview/changes 딥링크는 setTab 별칭이 처리한다.
const applyLocationPanes = locationState => {
  if (locationState.tab === 'features') state.featuresPane = locationState.pane === 'changes' ? 'changes' : 'features'
  if (locationState.tab === 'design') state.designPane = locationState.pane === 'preview' ? 'preview' : 'design'
}

const previewSurfaceVisible = () => state.tab === 'design' && state.designPane === 'preview'
const changesSurfaceVisible = () => state.tab === 'features' && state.featuresPane === 'changes'

const writeLocation = ({replace = false} = {}) => {
  const params = new URLSearchParams()
  if (state.projectId) params.set('project', state.projectId)
  params.set('tab', state.tab)
  if (changesSurfaceVisible()) params.set('pane', 'changes')
  if (previewSurfaceVisible()) params.set('pane', 'preview')
  if (state.tab === 'documents' && state.documentPath) params.set('document', state.documentPath)
  if (state.tab === 'features' && state.featureId) params.set('feature', state.featureId)
  if (state.tab === 'features' && state.subFeatureId) params.set('subfeature', state.subFeatureId)
  if (previewSurfaceVisible() && state.previewAnchorId) params.set('anchor', state.previewAnchorId)
  if (changesSurfaceVisible() && state.focusChangeRequestId) params.set('change', state.focusChangeRequestId)
  const hash = `#${params}`
  if (location.hash === hash) return
  if (replace) history.replaceState(null, '', hash)
  else location.hash = hash
}

const renderProjectNavigation = () => {
  elements.projectList.replaceChildren()
  const projects = state.catalog?.projects ?? []
  elements.projectCount.textContent = String(projects.length)
  if (projects.length === 0) {
    elements.projectList.append(create('p', {className: 'panel-copy', text: '아직 _workspace 프로젝트가 없습니다. 기획을 시작하면 여기에 나타납니다.'}))
    return
  }
  for (const project of projects) {
    const button = create('button', {type: 'button', className: 'project-button', 'aria-current': project.id === state.projectId ? 'page' : 'false'})
    button.append(
      create('strong', {text: project.name}),
      create('small', {text: project.relativePath}),
      create('span', {className: 'project-button-meta'}, [
        create('span', {text: `P ${project.phaseCounts.plan}`}),
        create('span', {text: `D ${project.phaseCounts.design}`}),
        create('span', {text: project.preview.status}),
      ]),
    )
    button.addEventListener('click', () => selectProject(project.id))
    elements.projectList.append(button)
  }
}

const updateHeader = () => {
  const project = state.catalog?.projects.find(item => item.id === state.projectId)
  elements.projectTitle.textContent = project?.name ?? '프로젝트가 없습니다'
  elements.projectPath.textContent = project?.relativePath ?? (state.catalog?.scanRoot ? `${state.catalog.scanRoot} 아래에서 _workspace를 검색했습니다.` : '_workspace 프로젝트를 검색했습니다.')
  elements.scanTime.textContent = formatTime(state.catalog?.scannedAt)
  document.title = project ? `${project.name} · Web Harness Console` : 'Web Harness Console'
}

const setTab = (tab, {updateLocation = true} = {}) => {
  // 단계 재구성 이전의 preview/changes 탭 id 별칭 — 구 딥링크·내부 호출부를 그대로 살린다.
  if (tab === 'preview') { state.designPane = 'preview'; tab = 'design' }
  else if (tab === 'changes') { state.featuresPane = 'changes'; tab = 'features' }
  const available = new Set(elements.tabs.map(button => button.dataset.tab))
  state.tab = available.has(tab) ? tab : 'overview'
  if (!changesSurfaceVisible() && state.codexPollTimer) {
    clearTimeout(state.codexPollTimer)
    state.codexPollTimer = null
  }
  if (!previewSurfaceVisible()) state.previewAnchorId = null
  document.body.dataset.activeTab = state.tab
  elements.content.setAttribute('aria-labelledby', `tab-${state.tab}`)
  for (const button of elements.tabs) {
    const selected = button.dataset.tab === state.tab
    button.setAttribute('aria-selected', String(selected))
    button.tabIndex = selected ? 0 : -1
  }
  if (updateLocation) writeLocation()
  renderContent()
}

const selectProject = async (projectId, {updateLocation = true} = {}) => {
  if (!projectId) return
  const requestedLocation = parseLocation()
  state.projectId = projectId
  state.detail = null
  state.documentPath = null
  state.featureId = null
  state.subFeatureId = null
  state.previewAnchorId = null
  // 서브탭은 프로젝트별 맥락이다 — 전환 시 기본값으로 돌리고, 딥링크의 pane만 복원한다.
  state.featuresPane = 'features'
  state.designPane = 'design'
  if (requestedLocation.projectId === projectId) applyLocationPanes(requestedLocation)
  renderProjectNavigation()
  updateHeader()
  elements.content.replaceChildren(create('div', {className: 'loading-state'}, [create('span', {className: 'spinner', 'aria-hidden': 'true'}), document.createTextNode('프로젝트 문서를 읽고 있습니다.')]))
  if (updateLocation) writeLocation()
  try {
    const [detail, codexConnection] = await Promise.all([
      api(`/api/projects/${encodeURIComponent(projectId)}`),
      api('/api/codex/status'),
    ])
    if (state.projectId !== projectId) return
    state.detail = detail
    state.codexConnection = codexConnection
    if (requestedLocation.projectId === projectId && requestedLocation.documentPath) state.documentPath = requestedLocation.documentPath
    if (requestedLocation.projectId === projectId && requestedLocation.featureId) state.featureId = requestedLocation.featureId
    if (requestedLocation.projectId === projectId && requestedLocation.subFeatureId) state.subFeatureId = requestedLocation.subFeatureId
    if (requestedLocation.projectId === projectId && requestedLocation.previewAnchorId) state.previewAnchorId = requestedLocation.previewAnchorId
    renderContent()
    // 델타 새 탭 딥링크(openCR=1): 오버레이 사이드바의 "변경 요청"이 연 URL이면
    // 해당 FEAT/anchor로 CR 다이얼로그를 자동으로 연다. 1회성 — URL에서 즉시 제거.
    if (requestedLocation.projectId === projectId && requestedLocation.openCR && requestedLocation.featureId) {
      const feature = detail.features.find(item => item.featureId === requestedLocation.featureId)
      if (feature) {
        const subFeature = requestedLocation.subFeatureId
          ? (feature.subFeatures ?? []).find(item => item.subFeatureId === requestedLocation.subFeatureId) ?? null
          : null
        openChangeRequestDialog({feature, subFeature})
        writeLocation({replace: true})
      }
    }
  } catch (error) {
    if (state.projectId !== projectId) return
    showMessage(`프로젝트를 불러오지 못했습니다: ${error.message}`, true)
    elements.content.replaceChildren(create('div', {className: 'empty-state', text: `프로젝트를 불러오지 못했습니다: ${error.message}`}))
  }
}

const heading = (title, copy, trailing = null) => create('div', {className: 'section-heading'}, [
  create('div', {}, [create('h2', {text: title}), create('p', {text: copy})]),
  trailing,
])

const metricCard = (label, value, detail) => create('article', {className: 'metric-card'}, [
  create('span', {text: label}), create('strong', {text: String(value)}), create('small', {text: detail}),
])

const previewDigestLabel = preview => {
  const digest = preview.previewDigest ?? preview.sourceDigest
  return digest ? `${preview.status} · ${digest.slice(0, 12)}…` : `${preview.status} · digest unavailable`
}

const findAnchorContext = anchorId => {
  if (!anchorId) return null
  for (const feature of state.detail.features) {
    const anchor = feature.previewMapping.anchors.find(candidate => candidate.anchorId === anchorId)
    if (!anchor) continue
    const subFeature = (feature.subFeatures ?? []).find(candidate => candidate.subFeatureId === anchor.subFeatureId) ?? null
    return {feature, subFeature, anchor}
  }
  return null
}

const requestField = ({id, label, multiline = false, ...options}) => {
  const control = create(multiline ? 'textarea' : 'input', {id, name: id, ...options})
  return create('label', {className: 'request-field'}, [create('span', {text: label}), control])
}

const openChangeRequestDialog = ({feature = null, subFeature = null, anchor = null, bootstrap = false, newFeature = false, trigger = null, onCancel = null}) => {
  const selectedTestCases = anchor?.testCaseIds?.length
    ? anchor.testCaseIds
    : subFeature?.testCaseIds?.length
      ? subFeature.testCaseIds
      : feature?.testCaseIds ?? []
  const dialog = create('dialog', {className: 'change-request-dialog', 'aria-labelledby': 'change-request-title'})
  const error = create('p', {className: 'request-error', role: 'alert', 'aria-live': 'assertive', hidden: true})
  const form = create('form', {className: 'change-request-form', method: 'dialog'})
  const submit = create('button', {type: 'submit', className: 'primary-button', text: '변경 요청 생성'})
  const cancel = create('button', {type: 'button', className: 'secondary-button', text: '취소'})
  const idempotencyKey = crypto.randomUUID()
  let created = false

  form.append(
    create('header', {className: 'request-dialog-header'}, [
      create('div', {}, [create('span', {className: 'eyebrow', text: 'PROPOSED CHANGE SET'}), create('h2', {id: 'change-request-title', text: bootstrap ? '첫 변경 요청 만들기' : newFeature ? '신규 기능 요청' : '기능 변경 요청'})]),
      create('button', {type: 'button', className: 'icon-button', 'aria-label': '변경 요청 닫기', text: '×'}),
    ]),
    create('p', {className: 'request-boundary-copy', text: bootstrap
      ? '요청 파일 1개만 추가합니다. 등록 후 Changes 탭에서 기획 정찰 → 기획 초안 생성 실행으로 미니 기획(feature-plan 초안)을 만들고, 검토·승격(확인 1회)을 거쳐 정본이 됩니다.'
      : newFeature
        ? '요청 파일 1개만 추가합니다. 등록 후 Changes 탭에서 기획 정찰 → 기획 초안 생성 실행으로 feature-plan에 신규 FEAT 초안을 추가하고, 검토·승격(확인 1회)을 거쳐 정본이 됩니다.'
        : '요청 파일 1개만 추가합니다. 기존 기획·TC·디자인·프리뷰는 이 단계에서 수정하지 않습니다.'}),
    create('section', {className: 'request-context', 'aria-label': '현재 검토 기준'}, [
      create('div', {}, [create('small', {text: 'Target'}), create('strong', {text: subFeature?.subFeatureId ?? feature?.featureId ?? (newFeature ? '신규 기능 — 기존 FEAT 대상 아님' : '프로젝트 전체 — 신규(부트스트랩)')})]),
      create('div', {}, [create('small', {text: 'Preview mapping'}), create('strong', {text: anchor ? `${anchor.label} · ${anchor.anchorId}` : 'Feature 전체'})]),
      create('div', {}, [create('small', {text: 'Test cases'}), create('strong', {text: selectedTestCases.join(', ') || '연결된 TC 없음'})]),
      create('div', {}, [create('small', {text: 'Base design'}), create('strong', {text: previewDigestLabel(state.detail.preview)})]),
    ]),
    requestField({id: 'title', label: '요청 제목', required: true, autofocus: true, maxLength: 120, placeholder: '예: 테이블 이름 변경 흐름 개선'}),
    requestField({id: 'requestedChange', label: '무엇을 바꿀까요?', multiline: true, required: true, maxLength: 2000, rows: 4}),
    requestField({id: 'reason', label: '왜 바꿔야 하나요?', multiline: true, required: true, maxLength: 2000, rows: 3}),
    requestField({id: 'expectedBehavior', label: '변경 후 기대 동작', multiline: true, required: true, maxLength: 2000, rows: 4}),
    create('label', {className: 'request-field'}, [
      create('span', {text: 'Version intent'}),
      create('select', {id: 'versionIntent', name: 'versionIntent'}, [
        create('option', {value: 'patch', text: 'patch · 동작을 유지하는 보정'}),
        create('option', {value: 'minor', text: 'minor · 새 동작/TC 추가', selected: true}),
        create('option', {value: 'major', text: 'major · 기존 계약의 비호환 변경'}),
      ]),
    ]),
    error,
    create('footer', {className: 'request-dialog-actions'}, [cancel, submit]),
  )
  dialog.append(form)

  const closeButton = form.querySelector('.icon-button')
  closeButton.addEventListener('click', () => dialog.close('cancel'))
  cancel.addEventListener('click', () => dialog.close('cancel'))
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close('cancel')
  })
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    dialog.close('cancel')
  })
  dialog.addEventListener('close', () => {
    dialog.remove()
    if (!created) {
      if (trigger?.isConnected) trigger.focus()
      onCancel?.()
    }
  })
  form.addEventListener('submit', async event => {
    event.preventDefault()
    if (!form.reportValidity()) return
    submit.disabled = true
    submit.textContent = '생성 중…'
    error.hidden = true
    const values = new FormData(form)
    try {
      const result = await mutateApi(`/api/projects/${encodeURIComponent(state.projectId)}/change-requests`, {
        ...(bootstrap ? {bootstrap: true} : newFeature ? {newFeature: true} : {targetFeatureId: feature.featureId}),
        subFeatureId: subFeature?.subFeatureId ?? null,
        anchorId: anchor?.anchorId ?? null,
        title: values.get('title'),
        requestedChange: values.get('requestedChange'),
        reason: values.get('reason'),
        expectedBehavior: values.get('expectedBehavior'),
        versionIntent: values.get('versionIntent'),
      }, idempotencyKey)
      state.detail = await api(`/api/projects/${encodeURIComponent(state.projectId)}`)
      const project = state.catalog.projects.find(candidate => candidate.id === state.projectId)
      if (project) project.changeRequestCount = state.detail.changeRequestCount
      state.focusChangeRequestId = result.changeRequest.id
      created = true
      dialog.close('created')
      setTab('changes')
      showMessage(`${result.changeRequest.id} 변경 요청을 생성했습니다. 정본 문서는 아직 수정되지 않았습니다.`)
    } catch (requestError) {
      error.textContent = `변경 요청을 생성하지 못했습니다: ${requestError.message}`
      error.hidden = false
      submit.disabled = false
      submit.textContent = '변경 요청 생성'
    }
  })
  document.body.append(dialog)
  dialog.showModal()
  form.elements.title.focus()
}

const renderOverview = () => {
  const detail = state.detail
  const metrics = create('div', {className: 'metric-grid'}, [
    metricCard('Source', detail.phaseCounts.source, '00_source documents'),
    metricCard('Plan', detail.phaseCounts.plan, '01_plan documents'),
    metricCard('Design', detail.phaseCounts.design, '02_design documents'),
    metricCard('Features / TCs', `${detail.featureCount} / ${detail.testCaseCount}`, 'feature-plan traceability'),
  ])
  const previewPanel = create('article', {className: 'panel'}, [
    create('h3', {text: 'Design preview status'}),
    create('div', {className: 'status-row'}, [create('span', {text: '현재 상태'}), statusChipButton(detail.preview)]),
    create('p', {className: 'panel-copy', text: statusMessage(detail.preview)}),
  ])
  const nextAction = statusNextAction(detail.preview)
  if (nextAction) previewPanel.append(create('p', {className: 'panel-copy preview-next-action', text: nextAction}))
  if (detail.preview.status === 'UNAPPROVED' && detail.preview.sourceDigest && detail.preview.previewDigest) {
    const approveButton = create('button', {type: 'button', className: 'preview-approval-submit preview-approve-open', text: '프리뷰 승인…'})
    approveButton.addEventListener('click', () => openPreviewStatusDialog(detail.preview, approveButton))
    previewPanel.append(approveButton)
  }
  previewPanel.addEventListener('dblclick', () => setTab('preview'))

  const changes = detail.changes.slice(0, 5)
  const changePanel = create('article', {className: 'panel'}, [create('h3', {text: `Change requests · ${detail.changeRequestCount}`}), create('p', {className: 'panel-copy', text: 'Preview 검토에서 생성한 영구 요청 이력입니다.'}), create('h3', {className: 'secondary-panel-title', text: `Session changes · ${detail.changeSummary.total}`})])
  if (changes.length === 0) changePanel.append(create('p', {className: 'panel-copy', text: '서버 시작 이후 감지된 Source/Plan/Design 변경이 없습니다.'}))
  else {
    const list = create('ul', {className: 'plain-list'})
    for (const change of changes) list.append(create('li', {}, [
      create('span', {className: `change-kind change-${change.kind}`, text: change.kind}),
      create('span', {text: change.path}),
    ]))
    changePanel.append(list)
  }
  return create('div', {}, [heading('Project overview', '기획과 디자인의 현재 상태를 한눈에 확인합니다.'), metrics, create('div', {className: 'overview-grid'}, [previewPanel, changePanel])])
}

const appendMarkdown = (container, source) => {
  const lines = source.split(/\r?\n/)
  let list = null
  let code = null
  const flushList = () => { if (list) { container.append(list); list = null } }
  for (const line of lines) {
    if (line.startsWith('```')) {
      flushList()
      if (code) { container.append(code); code = null }
      else code = create('pre', {}, [create('code')])
      continue
    }
    if (code) {
      code.firstChild.textContent += `${line}\n`
      continue
    }
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/)
    if (headingMatch) {
      flushList()
      container.append(create(`h${headingMatch[1].length}`, {text: headingMatch[2]}))
      continue
    }
    const listMatch = line.match(/^\s*[-*]\s+(.+)$/)
    if (listMatch) {
      if (!list) list = create('ul')
      list.append(create('li', {text: listMatch[1]}))
      continue
    }
    flushList()
    if (line.startsWith('|')) container.append(create('pre', {className: 'table-source', text: line}))
    else if (line.trim()) container.append(create('p', {text: line}))
  }
  flushList()
  if (code) container.append(code)
}

const renderDocumentContent = async (reader, path) => {
  reader.replaceChildren(create('div', {className: 'loading-state', text: '문서를 읽고 있습니다.'}))
  try {
    const documentPayload = await api(`/api/projects/${encodeURIComponent(state.projectId)}/document?path=${encodeURIComponent(path)}`)
    const body = extension(path) === '.md' ? create('article', {className: 'markdown-document'}) : create('pre', {className: 'source-document'})
    if (extension(path) === '.md') appendMarkdown(body, documentPayload.content)
    else body.textContent = documentPayload.content
    reader.replaceChildren(
      create('div', {className: 'reader-meta'}, [
        create('span', {text: documentPayload.path}),
        create('span', {text: formatBytes(documentPayload.bytes)}),
        create('span', {text: `${documentPayload.lines} lines`}),
        documentPayload.change ? create('span', {className: `change-${documentPayload.change.kind}`, text: documentPayload.change.kind.toUpperCase()}) : null,
      ]),
      body,
    )
  } catch (error) {
    reader.replaceChildren(create('div', {className: 'empty-state', text: `문서를 읽지 못했습니다: ${error.message}`}))
  }
}

// Design 탭 — 현재 디자인(최신 라운드의 선정 시안)만 노출한다(사용자 결정: 후보·과거
// 라운드는 UI 미노출 — 파일 아카이브는 발산 기계화 §보존대로 저장소에 남는다). 선정
// 식별은 판정 기록의 SELECTED_CANDIDATE 기계 마커가 유일 근거 — 없으면 "선정 기록
// 없음"으로 정직 표시(추정 금지). 새 라운드가 생기면 디스크 새로고침 시 자동 교체된다.
const renderDesign = () => {
  const detail = state.detail
  const container = create('div', {}, [heading('Design', '현재 적용 방향의 선정 시안입니다. 발산 라운드가 갱신되면 최신 선정 시안으로 바뀝니다.')])
  const rounds = detail.styleTiles ?? []
  const latest = rounds[0] ?? null
  if (!latest) {
    container.append(create('div', {className: 'empty-state', text: '보존된 디자인 시안이 없습니다. 발산 라운드가 실행되면 여기에 나타납니다.'}))
    return container
  }
  const documentButton = (label, path) => {
    if (!path) return null
    const button = create('button', {type: 'button', className: 'style-tile-doc', text: label})
    button.addEventListener('click', () => {
      state.documentPath = path
      setTab('documents')
    })
    return button
  }
  const heroCandidate = latest.selectedCandidate
  container.append(create('article', {className: 'panel style-tiles-panel'}, [
    create('div', {className: 'style-tile-hero-head'}, [
      create('h3', {text: heroCandidate ? `현재 디자인 · ${heroCandidate}` : '현재 디자인 · 선정 기록 없음'}),
      create('small', {text: `${latest.round} 라운드`}),
    ]),
    create('div', {className: 'style-tile-docs'}, [
      documentButton('README', latest.readmePath),
      documentButton('렌더 판정', latest.renderVerdictPath),
      documentButton('구현 대조표', latest.implementationVerdictPath),
    ]),
    heroCandidate
      ? create('figure', {className: 'style-tile-figure'}, [create('iframe', {
          className: 'style-tile-frame style-tile-hero-frame',
          title: `${latest.round} ${heroCandidate}`,
          src: `${state.previewOrigin}/${encodeURIComponent(state.projectId)}/__style-tiles/${encodeURIComponent(latest.round)}/${encodeURIComponent(heroCandidate)}/index.html`,
        })])
      : create('p', {className: 'panel-copy', text: '이 라운드의 판정 기록(RENDER-VERDICT.md)에 SELECTED_CANDIDATE 마커가 없어 선정 시안을 표시하지 않습니다. 후보·판정 원문은 Documents 탭과 저장소의 style-tiles 라운드 디렉터리에 보존돼 있습니다.'}),
  ]))
  return container
}

const renderDocuments = () => {
  const detail = state.detail
  const tree = create('nav', {className: 'document-tree', 'aria-label': '문서 목록'})
  const reader = create('article', {className: 'document-reader'})
  const phaseLabels = {source: '00 · Source', plan: '01 · Plan', design: '02 · Design'}
  const allDocuments = []
  for (const phase of ['source', 'plan', 'design']) {
    const group = create('section', {className: 'phase-group'}, [create('h3', {text: `${phaseLabels[phase]} · ${detail.documents[phase].length}`})])
    for (const documentItem of detail.documents[phase]) {
      allDocuments.push(documentItem)
      const button = create('button', {type: 'button', className: 'document-button', 'aria-current': String(documentItem.path === state.documentPath)}, [
        create('span', {text: documentItem.title}), create('small', {text: documentItem.path.replace(`_workspace/${phase === 'source' ? '00_source' : phase === 'plan' ? '01_plan' : '02_design'}/`, '')}),
      ])
      button.addEventListener('click', () => {
        state.documentPath = documentItem.path
        writeLocation()
        for (const sibling of tree.querySelectorAll('.document-button')) sibling.setAttribute('aria-current', String(sibling === button))
        renderDocumentContent(reader, documentItem.path)
      })
      group.append(button)
    }
    tree.append(group)
  }
  const selected = allDocuments.find(documentItem => documentItem.path === state.documentPath) ?? allDocuments[0]
  if (selected) {
    state.documentPath = selected.path
    queueMicrotask(() => renderDocumentContent(reader, selected.path))
  } else reader.append(create('div', {className: 'empty-state', text: '표시할 Source/Plan/Design 문서가 없습니다.'}))
  return create('div', {}, [heading('Documents', '00_source부터 02_design까지만 표시합니다.'), create('div', {className: 'document-layout'}, [tree, reader])])
}

const renderFeatures = () => {
  const features = state.detail.features
  if (features.length === 0) {
    // A안 온보딩(docs/brownfield-adoption.md): 첫 접점은 등록 의식·역추출이 아니라
    // "새 변경 요청" — 빈 프로젝트는 부트스트랩 CR로 시작한다.
    const startButton = create('button', {type: 'button', className: 'primary-button', text: '첫 변경 요청 만들기'})
    startButton.addEventListener('click', () => openChangeRequestDialog({bootstrap: true, trigger: startButton}))
    return create('div', {}, [
      heading('Features', 'feature-plan의 FEAT와 TC 연결을 표시합니다.'),
      create('div', {className: 'empty-state bootstrap-onboarding'}, [
        create('strong', {text: '아직 기획(FEAT)이 없는 프로젝트입니다'}),
        create('p', {text: '도입에 등록 의식이나 전면 역추출은 필요 없습니다. 바꾸고 싶은 것이 생겼을 때 첫 변경 요청을 만들면, 그 요청을 바탕으로 미니 기획(변경분 + 인접 표면만)을 만들고 확인 1회 후 변경 관리 루프가 시작됩니다 — 기획 정찰·초안 생성·검토까지 콘솔에서 진행됩니다.'}),
        startButton,
      ]),
    ])
  }
  const selectedFeature = features.find(feature => feature.featureId === state.featureId) ?? features[0]
  const selectedFeatureSubFeatures = selectedFeature.subFeatures ?? []
  const selectedSubFeature = selectedFeatureSubFeatures.find(subFeature => subFeature.subFeatureId === state.subFeatureId) ?? null
  state.featureId = selectedFeature.featureId
  state.subFeatureId = selectedSubFeature?.subFeatureId ?? null
  const list = create('nav', {className: 'feature-list', 'aria-label': 'Feature 목록'})
  const detail = create('article', {className: 'feature-detail', 'aria-live': 'polite'})
  const pageGroups = []
  const pageGroupByKey = new Map()
  for (const [featureIndex, feature] of features.entries()) {
    const pageGroup = feature.pageGroup ?? {id: null, label: '미분류', route: '', order: null, source: 'ungrouped'}
    const key = pageGroup.id ?? `fallback:${pageGroup.label}`
    if (!pageGroupByKey.has(key)) {
      const entry = {key, pageGroup, features: [], firstFeatureIndex: featureIndex}
      pageGroupByKey.set(key, entry)
      pageGroups.push(entry)
    }
    pageGroupByKey.get(key).features.push(feature)
  }
  pageGroups.sort((left, right) => {
    const leftOrder = Number.isInteger(left.pageGroup.order) ? left.pageGroup.order : 10_000 + left.firstFeatureIndex
    const rightOrder = Number.isInteger(right.pageGroup.order) ? right.pageGroup.order : 10_000 + right.firstFeatureIndex
    return leftOrder - rightOrder || left.firstFeatureIndex - right.firstFeatureIndex
  })

  const renderDetail = (feature, subFeature = null) => {
    const selectedTestCases = subFeature
      ? feature.testCases.filter(testCase => subFeature.testCaseIds.includes(testCase.testCaseId))
      : feature.testCases
    const selectedMapping = subFeature?.previewMapping ?? feature.previewMapping
    const metadata = [
      ['Parent', subFeature ? feature.featureId : ''],
      ['Page', feature.pageGroup?.label ?? '미분류'],
      ['Priority', feature.priority],
      ['Screen', feature.screen],
      ['Scope', feature.scope],
    ].filter(([, value]) => value)
    const intro = subFeature
      ? (subFeature.description || `${feature.title}의 하위 동작입니다. 관련 Test Case와 Preview anchor를 이 책임 단위로 추적합니다.`)
      : (feature.description || feature.summary || 'feature-plan.md에 별도 동작 설명이 없습니다.')
    const approvedChanges = subFeature?.approvedChanges ?? feature.approvedChanges ?? []
    const history = create('section', {className: 'feature-detail-section'}, [
      create('div', {className: 'detail-section-heading'}, [create('h3', {text: `승인된 변경 이력 · ${approvedChanges.length}`})]),
    ])
    if (approvedChanges.length === 0) history.append(create('p', {className: 'panel-copy', text: '이 Feature에 연결된 승인된 Change Request가 없습니다.'}))
    else {
      const historyList = create('div', {className: 'approved-change-list'})
      for (const change of approvedChanges) {
        const button = create('button', {type: 'button', className: 'approved-change-card', 'aria-label': `${change.changeRequestId} 변경 이력 열기`}, [
          create('div', {className: 'approved-change-heading'}, [create('span', {className: 'feature-id', text: change.changeRequestId}), statusChip('APPROVED')]),
          create('strong', {text: change.title}),
          create('p', {text: change.requestedChange}),
          create('div', {className: 'approved-change-meta'}, [
            create('span', {text: change.versionIntent}),
            create('span', {text: `TC ${change.affectedTestCaseIds.length}`}),
            create('time', {dateTime: change.approvedAt, text: formatTime(change.approvedAt)}),
          ]),
          create('span', {className: 'anchor-card-action', text: 'Changes에서 보기 →'}),
        ])
        button.addEventListener('click', () => {
          state.focusChangeRequestId = change.changeRequestId
          setTab('changes')
        })
        historyList.append(button)
      }
      history.append(historyList)
    }
    const tests = create('section', {className: 'feature-detail-section'}, [
      create('div', {className: 'detail-section-heading'}, [create('h3', {text: `Test cases · ${selectedTestCases.length}`})]),
    ])
    if (selectedTestCases.length === 0) tests.append(create('p', {className: 'panel-copy', text: '연결된 Test Case 상세가 없습니다.'}))
    for (const testCase of selectedTestCases) {
      const testBody = create('div', {className: 'test-case-body'})
      if (testCase.description) testBody.append(create('p', {text: testCase.description}))
      const steps = [['Given', testCase.given], ['When', testCase.when], ['Then', testCase.then]].filter(([, value]) => value)
      if (steps.length > 0) {
        const definition = create('dl', {className: 'test-case-steps'})
        for (const [label, value] of steps) definition.append(create('dt', {text: label}), create('dd', {text: value}))
        testBody.append(definition)
      }
      tests.append(create('article', {className: 'test-case'}, [
        create('div', {className: 'test-case-heading'}, [create('span', {className: 'tc-chip', text: testCase.testCaseId}), testCase.label ? create('span', {className: 'test-label', text: testCase.label}) : null]),
        testBody,
      ]))
    }

    const documents = create('section', {className: 'feature-detail-section'}, [create('div', {className: 'detail-section-heading'}, [create('h3', {text: `Related documents · ${feature.relatedDocuments.length}`})])])
    if (feature.relatedDocuments.length === 0) documents.append(create('p', {className: 'panel-copy', text: '이 Feature ID를 참조하는 Source/Plan/Design 문서가 없습니다.'}))
    else {
      const documentList = create('div', {className: 'related-document-list'})
      for (const documentItem of feature.relatedDocuments) {
        const button = create('button', {type: 'button', className: 'related-document-button'}, [
          create('span', {className: 'document-phase', text: documentItem.phase}),
          create('span', {}, [create('strong', {text: documentItem.title}), create('small', {text: documentItem.path})]),
        ])
        button.addEventListener('click', () => {
          state.documentPath = documentItem.path
          setTab('documents')
        })
        documentList.append(button)
      }
      documents.append(documentList)
    }

    const mapping = create('section', {className: 'feature-detail-section'}, [create('div', {className: 'detail-section-heading'}, [create('h3', {text: 'Preview mapping'})])])
    if (selectedMapping.anchors.length === 0) {
      const reason = selectedMapping.unmappedReason
        || (state.detail.preview.status === 'INVALID' ? `Preview traceability 검증 오류: ${(state.detail.preview.errors ?? [])[0] ?? 'Console 서버를 최신 코드로 재시작해 주세요.'}` : null)
        || (state.detail.preview.status === 'MISSING' ? 'Legacy 프리뷰라서 traceability anchor 정보가 없습니다.' : '이 Feature에 연결된 preview anchor가 없습니다.')
      mapping.append(create('div', {className: 'mapping-empty'}, [statusChip(state.detail.preview.status), create('p', {text: reason})]))
    } else {
      for (const anchor of selectedMapping.anchors) {
        const button = create('button', {type: 'button', className: 'anchor-card', 'aria-label': `${anchor.label} 프리뷰에서 열기`}, [
          create('div', {className: 'feature-card-header'}, [create('strong', {text: anchor.label}), create('span', {className: 'count-badge', text: `TC ${anchor.testCaseIds.length}`})]),
          create('code', {text: anchor.route}),
          create('small', {text: anchor.anchorId}),
          create('span', {className: 'anchor-card-action', text: '프리뷰에서 위치 열기 →'}),
        ])
        button.addEventListener('click', () => {
          state.previewAnchorId = anchor.anchorId
          setTab('preview')
        })
        mapping.append(button)
      }
    }

    const detailChildren = [
      create('header', {className: 'feature-detail-header'}, [
        create('div', {}, [create('span', {className: 'feature-id', text: subFeature?.subFeatureId ?? feature.featureId}), create('h2', {text: subFeature?.title ?? feature.title})]),
        create('div', {className: 'feature-detail-actions'}, [
          create('button', {type: 'button', className: 'secondary-button request-change-button', text: '변경 요청'}),
          metadata.length > 0 ? create('div', {className: 'feature-metadata'}, metadata.map(([label, value]) => create('span', {}, [create('small', {text: label}), document.createTextNode(value)]))) : null,
        ]),
      ]),
      !subFeature && feature.summary && feature.summary !== intro ? create('p', {className: 'feature-summary', text: feature.summary}) : null,
      create('p', {className: 'feature-description', text: intro}),
      history,
      tests,
      documents,
      mapping,
    ].filter(Boolean)
    detail.replaceChildren(...detailChildren)
    const requestButton = detail.querySelector('.request-change-button')
    requestButton.addEventListener('click', () => openChangeRequestDialog({feature, subFeature, trigger: requestButton}))
  }

  for (const [pageIndex, pageEntry] of pageGroups.entries()) {
    const headingId = `feature-page-group-${pageIndex}`
    const pageSection = create('section', {className: 'feature-page-group', 'aria-labelledby': headingId})
    const pageMeta = [pageEntry.pageGroup.id, pageEntry.pageGroup.route].filter(Boolean).join(' · ')
    pageSection.append(create('header', {className: 'feature-page-heading'}, [
      create('div', {}, [create('h3', {id: headingId, text: pageEntry.pageGroup.label}), pageMeta ? create('small', {text: pageMeta}) : null]),
      create('span', {className: 'count-badge', text: `${pageEntry.features.length} FEAT`}),
    ]))
    const pageFeatureList = create('div', {className: 'feature-page-list'})
    for (const feature of pageEntry.features) {
      const subFeatures = feature.subFeatures ?? []
      const treeGroup = create('section', {className: 'feature-tree-group', dataset: {featureId: feature.featureId}})
      const parentSelected = feature.featureId === selectedFeature.featureId && !selectedSubFeature
      const button = create('button', {type: 'button', className: 'feature-card', 'aria-current': String(parentSelected), 'aria-expanded': String(subFeatures.length > 0 && feature.featureId === selectedFeature.featureId)}, [
        create('div', {className: 'feature-card-header'}, [create('span', {className: 'feature-id', text: feature.featureId}), create('span', {className: 'count-badge', text: `TC ${feature.testCaseIds.length}`})]),
        create('strong', {className: 'feature-card-title', text: feature.title}),
        create('span', {className: 'feature-card-copy', text: feature.summary || feature.description || '상세 내용을 확인하세요.'}),
      ])
      button.addEventListener('click', () => {
        state.featureId = feature.featureId
        state.subFeatureId = null
        renderContent()
        writeLocation()
      })
      treeGroup.append(button)
      if (subFeatures.length > 0) {
        const children = create('div', {className: 'subfeature-list', role: 'group', 'aria-label': `${feature.featureId} 하위 기능`})
        for (const subFeature of subFeatures) {
          const subButton = create('button', {
            type: 'button',
            className: 'subfeature-card',
            'aria-current': String(subFeature.subFeatureId === selectedSubFeature?.subFeatureId),
          }, [
            create('span', {className: 'feature-id', text: subFeature.subFeatureId}),
            create('strong', {text: subFeature.title}),
            create('span', {className: 'count-badge', text: `TC ${subFeature.testCaseIds.length}`}),
          ])
          subButton.addEventListener('click', () => {
            state.featureId = feature.featureId
            state.subFeatureId = subFeature.subFeatureId
            renderContent()
            writeLocation()
          })
          children.append(subButton)
        }
        treeGroup.append(children)
      }
      pageFeatureList.append(treeGroup)
    }
    pageSection.append(pageFeatureList)
    list.append(pageSection)
  }
  renderDetail(selectedFeature, selectedSubFeature)
  queueMicrotask(() => {
    writeLocation({replace: true})
    if (window.matchMedia('(min-width: 905px)').matches) {
      list.querySelector('[aria-current="true"]')?.scrollIntoView({block: 'nearest', inline: 'nearest'})
    }
  })
  // 기존 FEAT와 무관한 신규 기능 요청 진입점 — 대상 없는 newFeature CR을 만든다.
  const newFeatureButton = create('button', {type: 'button', className: 'secondary-button features-new-request', text: '신규 기능 요청'})
  newFeatureButton.addEventListener('click', () => openChangeRequestDialog({newFeature: true, trigger: newFeatureButton}))
  const featuresHeading = heading('Features', `${pageGroups.length}개 페이지 · ${features.length}개 기능 · ${state.detail.testCaseCount}개 테스트 케이스를 인덱싱했습니다.`)
  return create('div', {}, [create('div', {className: 'features-heading-row'}, [featuresHeading, newFeatureButton]), create('div', {className: 'feature-layout'}, [list, detail])])
}

const renderPreview = () => {
  const preview = state.detail.preview
  const targetContext = findAnchorContext(state.previewAnchorId)
  const targetAnchor = targetContext?.anchor ?? null
  const fallbackFeature = state.detail.features.find(feature => feature.featureId === state.featureId) ?? null
  const requestContext = targetContext ?? (fallbackFeature ? {
    feature: fallbackFeature,
    subFeature: (fallbackFeature.subFeatures ?? []).find(item => item.subFeatureId === state.subFeatureId) ?? null,
    anchor: null,
  } : null)
  const canApprove = preview.status === 'UNAPPROVED' && preview.sourceDigest && preview.previewDigest
  const approveButton = canApprove ? create('button', {type: 'button', className: 'preview-approval-submit preview-approve-open', text: '프리뷰 승인…'}) : null
  if (approveButton) approveButton.addEventListener('click', () => openPreviewStatusDialog(preview, approveButton))
  const toolbarActions = create('div', {className: 'preview-toolbar-actions'}, [
    requestContext ? create('button', {type: 'button', className: 'secondary-button request-change-button', text: '변경 요청'}) : null,
    approveButton,
    statusChipButton(preview),
  ])
  const shell = create('div', {className: 'preview-shell'})
  shell.append(create('div', {className: 'preview-toolbar'}, [
    create('div', {}, [
      create('strong', {text: 'Design preview'}),
      create('p', {text: targetAnchor ? `${targetAnchor.label} 위치로 이동하고 Feature 상세 패널을 엽니다.` : statusMessage(preview)}),
    ]),
    toolbarActions,
  ]))
  const requestButton = toolbarActions.querySelector('.request-change-button')
  if (requestButton) requestButton.addEventListener('click', () => openChangeRequestDialog({...requestContext, trigger: requestButton}))
  if (!preview.exists) shell.append(create('div', {className: 'preview-empty'}, [create('div', {}, [create('strong', {text: '프리뷰가 없습니다'}), create('p', {text: '_workspace/02_design/preview/index.html이 생성되면 여기에 자동으로 나타납니다.'})])]))
  else {
    const routePattern = /^#\/[a-zA-Z0-9_./~-]*$/
    const firstMappedRoute = state.detail.features
      .flatMap(feature => feature.previewMapping?.anchors ?? [])
      .map(anchor => anchor.route)
      .find(route => routePattern.test(route ?? ''))
    const safeRoute = targetAnchor && routePattern.test(targetAnchor.route ?? '') ? targetAnchor.route : firstMappedRoute ?? '#/'
    const queryParams = new URLSearchParams()
    queryParams.set('whConsoleOrigin', location.origin)
    if (targetAnchor) {
      queryParams.set('whAnchor', targetAnchor.anchorId)
      queryParams.set('whOpen', '1')
      if (targetAnchor.fixtureId) queryParams.set('whFixture', targetAnchor.fixtureId)
      if (targetAnchor.fixtureMode) queryParams.set('whFixtureMode', targetAnchor.fixtureMode)
    }
    const query = queryParams.size > 0 ? `?${queryParams.toString()}` : ''
    const iframe = create('iframe', {
      className: 'preview-frame',
      title: `${state.detail.name} 디자인 프리뷰`,
      src: `${state.previewOrigin}/${encodeURIComponent(state.projectId)}/${query}${safeRoute}`,
      loading: 'eager',
    })
    shell.append(iframe)
  }
  const live = state.detail.livePreview
  const isDeltaMode = preview.mode === 'live-delta'
  if (!live && !isDeltaMode) return create('div', {}, [heading('Preview', 'Console과 다른 localhost origin에서 prototype을 실행합니다.'), shell])
  if (isDeltaMode && !live) {
    // 프록시 동적 구성 실패(대상 URL 무효 등) — 정직하게 안내.
    return create('div', {}, [
      heading('Preview', '이 프로젝트의 기획 확인 표면은 라이브 베이스 델타입니다.'),
      create('div', {className: 'preview-shell'}, [create('div', {className: 'preview-empty'}, [create('div', {}, [
        create('strong', {text: '라이브 베이스 프록시를 구성하지 못했습니다'}),
        create('p', {text: state.detail.livePreviewError === 'INVALID_LIVE_TARGET'
          ? 'preview/manifest.json의 target이 loopback http URL(http://127.0.0.1:<port>)이 아닙니다. target을 고치면 자동으로 구성됩니다.'
          : state.detail.livePreviewError === 'LIVE_TARGET_NOT_IN_LAUNCH'
            ? 'manifest의 target 포트가 .claude/launch.json에 등록돼 있지 않습니다. 운영자가 등록한 dev server 포트만 라이브 베이스가 될 수 있습니다(allowlist).'
            : state.detail.livePreviewError === 'INVALID_LIVE_IDENTITY'
              ? 'preview/manifest.json의 identity 선언이 유효하지 않습니다. identity.titleIncludes에 대상 앱 <title>의 부분 문자열(1~200자)을 적으면 자동으로 구성됩니다.'
              : '델타 프록시 시작에 실패했습니다. Console 서버 로그를 확인하세요.'}),
      ])])]),
    ])
  }
  // 오버레이의 "변경 요청" 채널용 파라미터 — 새 탭 딥링크(whConsoleOrigin+whProject)와
  // 임베드 postMessage 신뢰 검증이 모두 이 값을 읽는다. "프리뷰에서 위치 열기"로 진입하면
  // 오버레이 reveal 파라미터(whAnchor·whOpen)와 대상 라우트를 함께 실어준다.
  const liveHandshake = new URLSearchParams({whConsoleOrigin: location.origin, whProject: state.projectId})
  let liveRoute = ''
  if (targetAnchor) {
    liveHandshake.set('whAnchor', targetAnchor.anchorId)
    liveHandshake.set('whOpen', '1')
    if (/^#\/[a-zA-Z0-9_./~-]*$/.test(targetAnchor.route ?? '')) liveRoute = targetAnchor.route
  }
  const liveTargetUrl = `${live.url}/?${liveHandshake}${liveRoute}`

  // 델타 모드 프로젝트는 라이브 델타가 유일한 기획 확인 표면이다(태생별 표면 모델) —
  // 서브 탭 없이 라이브만 보여준다. 프로토타입+라이브가 공존하는 과도기만 서브 탭.
  const pane = isDeltaMode ? 'live' : (state.previewPane ?? (live.deltaPresent && !preview.exists ? 'live' : 'design'))
  const liveShell = create('div', {className: 'preview-shell live-preview-shell'})
  // 라이브 베이스 헬스체크 칩 + 다운 시 시작 명령 안내(후속 작업 7-①) — 카드가 DOM에
  // 있는 동안 8초 주기로 재확인하고, 서버가 다시 뜨면 임베드를 자동 새로고침한다.
  const liveHealthChip = create('span', {className: 'status-chip status-pending live-health-chip', 'aria-live': 'polite', text: 'BASE 확인 중'})
  const liveHealthGuide = create('div', {className: 'live-health-guide', hidden: true})
  const liveManagedStopError = create('p', {className: 'live-health-inline-error', hidden: true})
  const liveManagedStop = create('button', {type: 'button', className: 'secondary-button', text: '베이스 중지', hidden: true, onclick: event => armedClick(event.currentTarget, '한 번 더 누르면 중지', async () => {
    liveManagedStopError.hidden = true
    try {
      await mutateApi('/api/live-base/stop', {project: state.projectId}, crypto.randomUUID(), 'stop-live-base')
      setTimeout(checkLiveHealth, 800)
    } catch (error) {
      liveManagedStopError.textContent = `중지 실패: ${error.message}`
      liveManagedStopError.hidden = false
    }
  })})
  let liveWasDown = false
  let liveHealthTimer = null
  let liveHealthBusy = false
  // 다운/불일치 안내는 내용이 같으면 재렌더하지 않는다 — 8초 폴링마다 replaceChildren
  // 하면 무장 상태·'시작 중…'·인라인 오류가 매 주기 초기화된다.
  let liveGuideSignature = null
  const checkLiveHealth = async () => {
    // 단일 폴링 체인 유지 — 버튼 등에서 수동 호출해도 체인이 복제되지 않는다.
    if (liveHealthBusy) return
    liveHealthBusy = true
    clearTimeout(liveHealthTimer)
    if (!document.contains(liveHealthChip)) { liveHealthBusy = false; return }
    try {
      const body = await fetch(`/api/live-base/health?project=${encodeURIComponent(state.projectId)}`).then(r => r.json())
      if (!document.contains(liveHealthChip)) { liveHealthBusy = false; return }
      liveManagedStop.hidden = !(body.healthy && body.managed)
      if (body.managed) liveManagedStop.title = `launch.json "${body.managed.entry}" — 콘솔이 시작함 (${body.managed.startedAt})`
      // 신원 불일치는 "실행 중이지만 다른 앱"이다 — healthy로 취급하면 오표시 사건
      // (다른 프로젝트 dev server의 포트 점유)을 초록 칩이 덮는다. 프록시는 별도로
      // HTML 응답을 차단하고, 여기서는 원인과 복구 경로를 안내한다.
      const misbound = body.healthy && (body.identity?.state === 'mismatch' || body.identity?.state === 'invalid')
      if (body.healthy && !misbound) {
        liveHealthChip.textContent = body.identity?.state === 'verified' ? 'BASE 신원 일치' : 'BASE 실행 중'
        liveHealthChip.className = 'status-chip status-approved live-health-chip'
        liveHealthGuide.hidden = true
        liveGuideSignature = null
        if (liveWasDown) {
          liveWasDown = false
          const frame = liveShell.querySelector('iframe')
          if (frame) frame.src = frame.src
        }
      } else if (misbound) {
        liveWasDown = true
        liveHealthChip.textContent = body.identity.state === 'invalid' ? 'IDENTITY 설정 오류' : 'BASE 다른 앱 응답'
        liveHealthChip.className = 'status-chip status-failed live-health-chip'
        const signature = `identity:${body.identity.state}:${body.identity.expected ?? ''}:${body.identity.actualTitle ?? ''}`
        if (liveGuideSignature !== signature) {
          liveGuideSignature = signature
          liveHealthGuide.replaceChildren(
            create('strong', {text: body.identity.state === 'invalid' ? 'identity 선언이 유효하지 않습니다' : '대상 포트의 앱이 이 프로젝트가 아닌 것으로 보입니다'}),
            create('p', {text: body.identity.state === 'invalid'
              ? 'preview/manifest.json의 identity.titleIncludes는 1~200자 문자열이어야 합니다. 선언을 고치면 자동으로 회복됩니다.'
              : `기대 제목 포함 문자열 "${body.identity.expected}" — 실제 응답 제목: ${body.identity.actualTitle ? `"${body.identity.actualTitle}"` : '(제목 없음/HTML 아님)'}. 다른 프로젝트의 dev server가 이 포트(${body.target ?? live.target})를 점유했을 수 있습니다. 올바른 앱을 시작하거나, 정당한 제목 변경이라면 manifest의 identity.titleIncludes를 갱신하세요(프리뷰 승인은 STALE로 전이됩니다).`}),
          )
        }
        liveHealthGuide.hidden = false
      } else {
        liveWasDown = true
        liveHealthChip.textContent = 'BASE 응답 없음'
        liveHealthChip.className = 'status-chip status-failed live-health-chip'
        const signature = `down:${body.target ?? live.target}:${(body.startHints ?? []).map(hint => hint.name).join('|')}`
        if (liveGuideSignature !== signature) {
          liveGuideSignature = signature
          liveHealthGuide.replaceChildren(...[
            create('strong', {text: '라이브 베이스가 응답하지 않습니다'}),
            create('p', {text: `대상 ${body.target ?? live.target} — 아래 명령으로 서버를 시작하면 자동으로 다시 연결됩니다. (repo 루트에서 실행)`}),
            (body.startHints ?? []).length > 1 ? create('p', {text: '⚠ 같은 포트에 launch.json 항목이 여러 개 등록돼 있습니다 — 이 서비스에 맞는 항목만 시작하세요.'}) : null,
            ...(body.startHints ?? []).map(hint => buildStartHintRow(hint, checkLiveHealth)),
            (body.startHints ?? []).length === 0 ? create('p', {text: '.claude/launch.json에서 대상 포트의 시작 명령을 찾지 못했습니다. 대상 서버를 수동으로 시작하세요.'}) : null,
          // replaceChildren은 null을 문자열 "null"로 렌더한다(실측) — 조건부 항목은 반드시 걸러낸다
          ].filter(Boolean))
        }
        liveHealthGuide.hidden = false
      }
    } catch { /* 콘솔 서버 통신 실패 — 다음 주기에 재시도 */ }
    liveHealthBusy = false
    liveHealthTimer = setTimeout(checkLiveHealth, 8000)
  }
  // 렌더 트리가 DOM에 부착된 뒤 시작해야 contains 가드에 걸리지 않는다.
  setTimeout(checkLiveHealth, 0)
  const openLink = create('a', {href: liveTargetUrl, target: '_blank', rel: 'noopener', className: 'secondary-button', text: '새 탭에서 열기'})
  liveShell.append(create('div', {className: 'preview-toolbar'}, [
    create('div', {}, [
      create('strong', {text: '라이브 베이스 델타 프리뷰'}),
      create('p', {text: `실행 중인 실제 앱(${live.target}) 위에 델타를 주입해 확인합니다. 기존 동작은 실물, 신규 동작은 프로토타입입니다. 임베드가 비어 보이면 앱 인증이 만료된 것입니다 — 로그인 리다이렉트는 Console 보안 정책상 임베드에서 차단되므로 새 탭에서 확인하세요.`}),
    ]),
    create('div', {className: 'preview-toolbar-actions'}, [
      isDeltaMode ? statusChipButton(preview) : null,
      create('span', {className: `status-chip ${live.deltaPresent ? 'status-approved' : 'status-absent'}`, text: live.deltaPresent ? 'DELTA READY' : 'DELTA ABSENT'}),
      // target 신원 미검증 경고(하위호환 킷): 선언이 없으면 프록시가 포트의 앱을 대조하지
      // 못한다 — 다른 프로젝트의 dev server가 같은 포트를 점유하면 그 앱이 표시될 수 있다.
      live.identity?.state === 'undeclared' ? create('span', {
        className: 'status-chip status-stale',
        text: 'IDENTITY 미검증',
        title: 'manifest.json에 identity.titleIncludes가 없어 target 포트의 앱이 이 프로젝트인지 확인하지 못합니다. 다른 프로젝트의 dev server가 같은 포트를 점유하면 그 앱이 표시될 수 있습니다.',
      }) : null,
      liveHealthChip,
      liveManagedStop,
      openLink,
    ]),
  ]))
  liveShell.append(liveManagedStopError, liveHealthGuide)
  if (live.deltaPresent) {
    liveShell.append(create('iframe', {
      className: 'preview-frame',
      title: `${state.detail.name} 라이브 베이스 델타 프리뷰`,
      src: liveTargetUrl,
      loading: 'eager',
    }))
  } else {
    liveShell.append(create('div', {className: 'preview-empty'}, [create('div', {}, [
      create('strong', {text: '델타가 없습니다'}),
      create('p', {text: '_workspace/02_design/preview/delta/bootstrap.mjs가 생성되면 실행 중인 앱 위에 주입됩니다.'}),
    ])]))
  }

  const paneTabs = create('div', {className: 'tabs preview-pane-tabs', role: 'tablist', 'aria-label': '프리뷰 종류'}, [
    ['design', 'Design preview'],
    ['live', '라이브 베이스 델타'],
  ].map(([id, label]) => {
    const button = create('button', {type: 'button', role: 'tab', 'aria-selected': String(pane === id), text: label})
    button.addEventListener('click', () => {
      state.previewPane = id
      renderContent()
    })
    return button
  }))
  if (isDeltaMode) {
    return create('div', {}, [
      heading('Preview', '이 프로젝트의 기획 확인 표면은 라이브 베이스 델타입니다 — 실행 중인 실제 앱 위에 변경분이 적용됩니다.'),
      liveShell,
    ])
  }
  return create('div', {}, [
    heading('Preview', 'Console과 다른 localhost origin에서 prototype을 실행합니다.'),
    paneTabs,
    pane === 'live' ? liveShell : shell,
  ])
}

const handlePreviewMessage = event => {
  if (!previewSurfaceVisible()) return
  const frame = elements.content.querySelector('.preview-frame')
  if (!frame) return
  // 신뢰 origin: 격리 프로토타입(previewOrigin) 또는 이 프로젝트의 라이브 델타 origin.
  const liveOrigin = (() => {
    try { return state.detail?.livePreview ? new URL(state.detail.livePreview.url).origin : null } catch { return null }
  })()
  const trusted = [state.previewOrigin, liveOrigin].some(origin => origin && isTrustedPreviewMessageSource({
    eventOrigin: event.origin,
    eventSource: event.source,
    previewOrigin: origin,
    frameWindow: frame.contentWindow,
  }))
  if (!trusted) return

  const message = parsePreviewChangeRequestMessage(event.data)
  if (!message) return
  const context = findAnchorContext(message.anchorId)
  if (!context || context.feature.featureId !== message.featureId) return
  if ((context.subFeature?.subFeatureId ?? null) !== message.subFeatureId) return

  state.previewAnchorId = message.anchorId
  const source = event.source
  const origin = event.origin
  openChangeRequestDialog({
    ...context,
    onCancel: () => source?.postMessage({
      type: PREVIEW_CHANGE_REQUEST_CLOSED,
      schemaVersion: PREVIEW_MESSAGE_SCHEMA_VERSION,
      anchorId: message.anchorId,
    }, origin),
  })
}

const openChangeRequestRevisionDialog = ({request, trigger = null}) => {
  const dialog = create('dialog', {className: 'change-request-dialog', 'aria-labelledby': 'change-request-revision-title'})
  const error = create('p', {className: 'request-error', role: 'alert', 'aria-live': 'assertive', hidden: true})
  const form = create('form', {className: 'change-request-form', method: 'dialog'})
  const submit = create('button', {type: 'submit', className: 'primary-button', text: '수정본 저장'})
  const cancel = create('button', {type: 'button', className: 'secondary-button', text: '취소'})
  const close = create('button', {type: 'button', className: 'icon-button', 'aria-label': '요청 수정 닫기', text: '×'})
  const idempotencyKey = crypto.randomUUID()
  form.append(
    create('header', {className: 'request-dialog-header'}, [
      create('div', {}, [create('span', {className: 'eyebrow', text: 'REQUEST REVISION'}), create('h2', {id: 'change-request-revision-title', text: '변경 요청 수정'})]),
      close,
    ]),
    create('p', {className: 'request-boundary-copy', text: '최초 요청은 그대로 보존하고 수정본을 이력에 추가합니다. 저장하면 이전 영향도 검토는 만료되어 최신 요청 기준으로 다시 실행해야 합니다.'}),
    create('section', {className: 'request-context', 'aria-label': '수정 대상'}, [
      create('div', {}, [create('small', {text: 'Change Request'}), create('strong', {text: request.id})]),
      create('div', {}, [create('small', {text: 'Target (변경 불가)'}), create('strong', {text: request.context.subFeatureId ?? request.context.featureId ?? '프로젝트(부트스트랩)'})]),
      create('div', {}, [create('small', {text: '현재 revision'}), create('strong', {text: request.revisionCount ? `REV-${String(request.revisionCount).padStart(3, '0')}` : '원본'})]),
    ]),
    requestField({id: 'revisionTitle', name: 'title', label: '요청 제목', required: true, autofocus: true, maxLength: 120, value: request.title}),
    requestField({id: 'revisionRequestedChange', name: 'requestedChange', label: '무엇을 바꿀까요?', multiline: true, required: true, maxLength: 2000, rows: 4, textContent: request.requestedChange}),
    requestField({id: 'revisionReason', name: 'reason', label: '왜 바꿔야 하나요?', multiline: true, required: true, maxLength: 2000, rows: 3, textContent: request.reason}),
    requestField({id: 'revisionExpectedBehavior', name: 'expectedBehavior', label: '변경 후 기대 동작', multiline: true, required: true, maxLength: 2000, rows: 4, textContent: request.expectedBehavior}),
    create('label', {className: 'request-field'}, [
      create('span', {text: 'Version intent'}),
      create('select', {name: 'versionIntent'}, [
        create('option', {value: 'patch', text: 'patch · 동작을 유지하는 보정', selected: request.versionIntent === 'patch'}),
        create('option', {value: 'minor', text: 'minor · 새 동작/TC 추가', selected: request.versionIntent === 'minor'}),
        create('option', {value: 'major', text: 'major · 기존 계약의 비호환 변경', selected: request.versionIntent === 'major'}),
      ]),
    ]),
    error,
    create('footer', {className: 'request-dialog-actions'}, [cancel, submit]),
  )
  dialog.append(form)
  close.addEventListener('click', () => dialog.close('cancel'))
  cancel.addEventListener('click', () => dialog.close('cancel'))
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close('cancel') })
  dialog.addEventListener('close', () => {
    dialog.remove()
    if (dialog.returnValue !== 'saved' && trigger?.isConnected) trigger.focus()
  })
  form.addEventListener('submit', async event => {
    event.preventDefault()
    if (!form.reportValidity()) return
    submit.disabled = true
    submit.textContent = '저장 중…'
    error.hidden = true
    const values = new FormData(form)
    try {
      const result = await mutateApi(
        `/api/projects/${encodeURIComponent(state.projectId)}/change-requests/${encodeURIComponent(request.id)}/revisions`,
        Object.fromEntries(['title', 'requestedChange', 'reason', 'expectedBehavior', 'versionIntent'].map(field => [field, values.get(field)])),
        idempotencyKey,
        'revise-change-request',
      )
      state.detail = await api(`/api/projects/${encodeURIComponent(state.projectId)}`)
      state.focusChangeRequestId = request.id
      dialog.close('saved')
      renderContent()
      showMessage(`${result.revision.revisionId} 수정본을 저장했습니다. 기존 영향도 검토는 만료되었습니다.`)
    } catch (requestError) {
      error.textContent = `변경 요청을 수정하지 못했습니다: ${requestError.message}`
      error.hidden = false
      submit.disabled = false
      submit.textContent = '수정본 저장'
    }
  })
  document.body.append(dialog)
  dialog.showModal()
  form.elements.title.focus()
}

const ACTIVE_CODEX_STATUSES = new Set(['PENDING', 'RUNNING'])

const latestCodexRun = (requestId, phase) => (state.detail.codexRuns ?? [])
  .find(run => run.changeRequestId === requestId && run.phase === phase) ?? null

const runMatchesCurrentRequest = (run, request) => !run
  ? false
  : run.requestDigest
    ? run.requestDigest === request.currentDigest
    : request.revisionCount === 0

const latestCurrentCodexRun = (request, phase) => (state.detail.codexRuns ?? [])
  .find(run => run.changeRequestId === request.id && run.phase === phase && runMatchesCurrentRequest(run, request)) ?? null

const hasActiveCodexRun = () => (state.detail?.codexRuns ?? []).some(run => ACTIVE_CODEX_STATUSES.has(run.status))
const hasActiveCodexRunForRequest = requestId => (state.detail?.codexRuns ?? [])
  .some(run => run.changeRequestId === requestId && ACTIVE_CODEX_STATUSES.has(run.status))

const refreshCodexConnection = async ({announce = false} = {}) => {
  try {
    state.codexConnection = await api('/api/codex/status?refresh=1')
    if (announce) showMessage(state.codexConnection.connected ? '실행기 연결을 확인했습니다.' : '실행기 연결이 필요합니다.', !state.codexConnection.connected)
    renderContent()
  } catch (error) {
    showMessage(`실행기 연결 상태를 확인하지 못했습니다: ${error.message}`, true)
  }
}

const codexActivitySignature = detail => JSON.stringify([
  (detail?.codexRuns ?? []).map(run => [run.runId, run.status, run.result?.outcome ?? null, run.candidate?.changedFiles?.length ?? 0]),
  (detail?.changeRequests ?? []).map(request => [request.id, request.revisionCount ?? 0, (request.reviewDecisions ?? []).length]),
  (detail?.changes ?? []).length,
])

const announceCodexRunStatus = detail => {
  const latest = (detail.codexRuns ?? [])[0]
  if (!latest) return
  const phaseLabel = latest.phase === 'impact' ? '영향 검토' : '변경 적용'
  elements.runStatusLive.textContent = `${latest.changeRequestId} ${phaseLabel} 상태: ${codexRunStatus(latest)}`
}

const captureChangesViewState = () => ({
  openRequestDetails: [...elements.content.querySelectorAll('[data-request-id] details[open]')]
    .map(details => details.closest('[data-request-id]')?.dataset.requestId)
    .filter(Boolean),
  focusedRequestId: document.activeElement?.closest?.('[data-request-id]')?.dataset.requestId ?? null,
})

const restoreChangesViewState = ({openRequestDetails, focusedRequestId}) => {
  for (const requestId of openRequestDetails) {
    const details = elements.content.querySelector(`[data-request-id="${CSS.escape(requestId)}"] details`)
    if (details) details.open = true
  }
  if (focusedRequestId && document.activeElement === document.body) {
    elements.content.querySelector(`[data-request-id="${CSS.escape(focusedRequestId)}"]`)?.focus()
  }
}

const scheduleCodexPoll = () => {
  if (state.codexPollTimer) clearTimeout(state.codexPollTimer)
  state.codexPollTimer = null
  if (!changesSurfaceVisible() || !hasActiveCodexRun()) return
  const projectId = state.projectId
  state.codexPollTimer = setTimeout(async () => {
    state.codexPollTimer = null
    try {
      const detail = await api(`/api/projects/${encodeURIComponent(projectId)}`)
      if (state.projectId !== projectId) return
      const changed = codexActivitySignature(detail) !== codexActivitySignature(state.detail)
      state.detail = detail
      if (!changesSurfaceVisible()) return
      if (!changed) {
        scheduleCodexPoll()
        return
      }
      announceCodexRunStatus(detail)
      const viewState = captureChangesViewState()
      renderContent()
      restoreChangesViewState(viewState)
    } catch (error) {
      showMessage(`실행기 실행 상태를 갱신하지 못했습니다: ${error.message}`, true)
    }
  }, 1500)
}

const startCodexRun = async ({request, phase, impactRun = null, trigger = null}) => {
  const idempotencyKey = crypto.randomUUID()
  if (trigger) trigger.disabled = true
  try {
    const response = await mutateApi(
      `/api/projects/${encodeURIComponent(state.projectId)}/change-requests/${encodeURIComponent(request.id)}/codex-runs`,
      phase === 'impact'
        ? {phase: 'impact'}
        : {phase: 'apply', impactRunId: impactRun.runId, approval: 'create-isolated-candidate'},
      idempotencyKey,
      'start-codex-run',
    )
    state.detail = await api(`/api/projects/${encodeURIComponent(state.projectId)}`)
    showMessage(phase === 'impact'
      ? response.cacheHit
        ? `${request.id} 동일한 요청·기획·디자인 기준의 영향도 결과를 재사용했습니다. 모델 호출은 발생하지 않았습니다.`
        : `${request.id} 영향 검토를 시작했습니다.`
      : `${request.id} 격리 변경 후보 생성을 시작했습니다. 완료 후 candidate diff를 검토해 주세요.`)
    renderContent()
  } catch (error) {
    if (error.code === 'CODEX_IMPACT_STALE') {
      state.evidenceStaleRunIds = state.evidenceStaleRunIds ?? new Set()
      if (impactRun?.runId) state.evidenceStaleRunIds.add(impactRun.runId)
      showMessage('기획·디자인 증거가 변경되어 기존 영향 검토가 만료되었습니다. 카드의 ‘영향 검토 다시 실행’으로 새 검토를 시작해 주세요.', true)
      renderContent()
      return
    }
    showMessage(`실행기 작업을 시작하지 못했습니다: ${error.message}`, true)
    if (trigger?.isConnected) {
      trigger.disabled = false
      trigger.focus()
    }
  }
}

// 원칙 4(승인 충실)의 마지막 고리 — 승인된 CR의 같은 TC ID 테스트 통과 증거를 기록·표시.
const appendImplementationVerification = (card, request) => {
  const summary = request.implementationVerification
  if (!summary) return
  const section = create('section', {className: 'implementation-verification'})
  const chip = summary.complete
    ? create('span', {className: 'status-chip status-approved', title: '기록된 증거 기준입니다 — 증거는 자기진술이며 테스트 실행을 자동 보장하지 않습니다.', text: '구현 검증 완료'})
    : create('span', {className: 'status-chip status-stale', text: `구현 검증 대기 ${summary.coveredTestCaseIds.length}/${summary.approvedTestCaseIds.length}`})
  const recordButton = create('button', {type: 'button', className: 'secondary-button', text: '구현 검증 기록'})
  recordButton.addEventListener('click', () => openImplementationVerificationDialog({request, summary, trigger: recordButton}))
  section.append(create('div', {className: 'implementation-verification-head'}, [
    create('strong', {text: '구현 검증 — 승인된 TC의 구현 테스트 통과 증거'}),
    chip,
    summary.complete ? null : recordButton,
  ]))
  if (summary.missingTestCaseIds.length > 0) {
    section.append(create('p', {className: 'implementation-missing', text: `미검증 TC: ${summary.missingTestCaseIds.join(', ')}`}))
  }
  for (const event of summary.events.slice(-3)) {
    section.append(create('p', {className: 'implementation-event', text: `${event.testCaseIds.join(', ')} — ${event.evidence}${event.command ? ` (${event.command})` : ''}`}))
  }
  card.append(section)
}

const openImplementationVerificationDialog = ({request, summary, trigger = null}) => {
  const dialog = create('dialog', {className: 'change-request-dialog', 'aria-labelledby': 'implementation-verification-title'})
  const error = create('p', {className: 'request-error', role: 'alert', 'aria-live': 'assertive', hidden: true})
  const form = create('form', {className: 'change-request-form', method: 'dialog'})
  const submit = create('button', {type: 'submit', className: 'primary-button', text: '증거 기록'})
  const cancel = create('button', {type: 'button', className: 'secondary-button', text: '취소'})
  const idempotencyKey = crypto.randomUUID()
  form.append(
    create('header', {className: 'request-dialog-header'}, [
      create('div', {}, [create('span', {className: 'eyebrow', text: 'IMPLEMENTATION VERIFICATION'}), create('h2', {id: 'implementation-verification-title', text: '구현 검증 기록'})]),
      create('button', {type: 'button', className: 'icon-button', 'aria-label': '닫기', text: '×'}),
    ]),
    create('p', {className: 'request-boundary-copy', text: '실제로 실행해 통과한 테스트만 기록하세요 — 증거는 자기진술이며 명령·결과 요약·시점을 담아야 합니다. 기록은 append-only입니다.'}),
    create('fieldset', {className: 'implementation-tc-select'}, [
      create('legend', {text: '검증한 TC (승인된 ID만 선택 가능)'}),
      ...summary.approvedTestCaseIds.map(id => create('label', {className: 'implementation-tc-option'}, [
        create('input', {type: 'checkbox', name: 'testCaseIds', value: id, checked: summary.missingTestCaseIds.includes(id)}),
        create('span', {text: `${id}${summary.coveredTestCaseIds.includes(id) ? ' (검증됨)' : ''}`}),
      ])),
    ]),
    requestField({id: 'evidence', label: '증거 요약 (통과 수·러너·시점 — 한 줄)', required: true, maxLength: 300, placeholder: '예: vitest run 4/4 passed, 2026-08-11 14:00'}),
    requestField({id: 'command', label: '실행 명령 (선택)', required: false, maxLength: 300, placeholder: '예: pnpm --dir workspace/... test'}),
    error,
    create('footer', {className: 'request-dialog-actions'}, [cancel, submit]),
  )
  dialog.append(form)
  form.querySelector('.icon-button').addEventListener('click', () => dialog.close('cancel'))
  cancel.addEventListener('click', () => dialog.close('cancel'))
  dialog.addEventListener('close', () => {
    dialog.remove()
    if (trigger?.isConnected) trigger.focus()
  })
  form.addEventListener('submit', async event => {
    event.preventDefault()
    const testCaseIds = [...form.querySelectorAll('input[name="testCaseIds"]:checked')].map(input => input.value)
    if (testCaseIds.length === 0) {
      error.textContent = '검증한 TC를 하나 이상 선택하세요.'
      error.hidden = false
      return
    }
    submit.disabled = true
    submit.textContent = '기록 중…'
    error.hidden = true
    const values = new FormData(form)
    try {
      await mutateApi(
        `/api/projects/${encodeURIComponent(state.projectId)}/change-requests/${encodeURIComponent(request.id)}/implementation-verifications`,
        {testCaseIds, evidence: values.get('evidence'), command: values.get('command') || null},
        idempotencyKey,
        'record-implementation-verification',
      )
      state.detail = await api(`/api/projects/${encodeURIComponent(state.projectId)}`)
      showMessage(`${request.id} 구현 검증을 기록했습니다.`)
      dialog.close('done')
      renderContent()
    } catch (submitError) {
      error.textContent = submitError.message
      error.hidden = false
      submit.disabled = false
      submit.textContent = '증거 기록'
    }
  })
  document.body.append(dialog)
  dialog.showModal()
}

const recordReviewDecision = async ({request, decision, reason, trigger = null}) => {
  if (trigger) trigger.disabled = true
  try {
    await mutateApi(
      `/api/projects/${encodeURIComponent(state.projectId)}/change-requests/${encodeURIComponent(request.id)}/review-decisions`,
      {decision, reason},
      crypto.randomUUID(),
      'record-change-review',
    )
    state.detail = await api(`/api/projects/${encodeURIComponent(state.projectId)}`)
    const label = {APPROVED: '승인', REVISION_REQUESTED: '수정 요청', DISCARDED: '변경 폐기'}[decision]
    showMessage(`${request.id} 검토 결정을 ${label}(으)로 기록했습니다.`)
    renderContent()
  } catch (error) {
    showMessage(`검토 결정을 기록하지 못했습니다: ${error.message}`, true)
    if (trigger?.isConnected) {
      trigger.disabled = false
      trigger.focus()
    }
  }
}

const openReviewDecisionDialog = ({request, decision, trigger, applyRun}) => {
  const isolatedCandidate = Boolean(applyRun?.candidate)
  const config = {
    APPROVED: {
      eyebrow: 'REVIEW DECISION',
      title: '변경 승인',
      copy: isolatedCandidate
        ? '현재 candidate를 정본 프로젝트에 적용하고 이 Change Request의 검토를 종료합니다. apply 이후 정본이 바뀌었다면 승인은 안전하게 거부됩니다.'
        : '이 legacy apply는 candidate 도입 전에 정본에 직접 적용됐습니다. 현재 결과를 승인하고 검토를 종료합니다.',
      field: '검토 메모 (선택)',
      submit: '승인',
      submitClass: 'primary-button',
      required: false,
    },
    REVISION_REQUESTED: {
      eyebrow: 'REVIEW FEEDBACK',
      title: '수정 요청',
      copy: isolatedCandidate
        ? '수정 사유를 append-only로 기록합니다. 정본은 변경하지 않으며 이후 `수정 반영`은 같은 정본 기준에서 새 candidate를 만듭니다.'
        : '수정 사유를 append-only로 기록합니다. legacy apply의 기존 정본 변경은 자동 복원하지 않으며 다음 실행부터 새 candidate를 만듭니다.',
      field: '수정할 내용',
      submit: '수정 요청 기록',
      submitClass: 'primary-button',
      required: true,
    },
    DISCARDED: {
      eyebrow: 'REVIEW DECISION',
      title: '검토 결과 폐기',
      copy: isolatedCandidate
        ? '이 candidate를 채택하지 않고 Change Request를 종료합니다. 실행기는 격리된 복사본만 수정했으므로 정본 프로젝트에는 적용하거나 복원할 변경이 없습니다.'
        : '이 legacy apply 결과를 채택하지 않고 종료합니다. 안전한 candidate 기준점이 없어 기존 정본 파일 변경은 자동 복원되지 않습니다.',
      field: '폐기 사유',
      submit: '변경 폐기',
      submitClass: 'danger-button',
      required: true,
    },
  }[decision]
  if (!config) return
  const dialog = create('dialog', {className: 'change-request-dialog review-decision-dialog', 'aria-labelledby': 'review-decision-title'})
  const form = create('form', {className: 'change-request-form', method: 'dialog'})
  const close = create('button', {type: 'button', className: 'icon-button', 'aria-label': `${config.title} 닫기`, text: '×'})
  const cancel = create('button', {type: 'button', className: 'secondary-button', text: '취소'})
  const submit = create('button', {type: 'submit', className: config.submitClass, text: config.submit})
  const reason = create('textarea', {rows: 5, maxlength: 2000, required: config.required, placeholder: config.required ? '검토자가 확인할 수 있도록 구체적으로 작성해 주세요.' : '선택 사항입니다.'})
  form.append(
    create('header', {className: 'request-dialog-header'}, [
      create('div', {}, [create('span', {className: 'eyebrow', text: config.eyebrow}), create('h2', {id: 'review-decision-title', text: config.title})]),
      close,
    ]),
    create('p', {className: decision === 'DISCARDED' ? 'review-warning-copy' : 'request-boundary-copy', text: config.copy}),
    create('section', {className: 'request-context', 'aria-label': '검토 대상'}, [
      create('div', {}, [create('small', {text: 'Change Request'}), create('strong', {text: request.id})]),
      create('div', {}, [create('small', {text: 'Target'}), create('strong', {text: request.context.subFeatureId ?? request.context.featureId ?? '프로젝트(부트스트랩)'})]),
    ]),
    create('label', {className: 'request-field'}, [document.createTextNode(config.field), reason]),
    create('footer', {className: 'request-dialog-actions'}, [cancel, submit]),
  )
  dialog.append(form)
  close.addEventListener('click', () => dialog.close('cancel'))
  cancel.addEventListener('click', () => dialog.close('cancel'))
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close('cancel') })
  dialog.addEventListener('close', () => {
    dialog.remove()
    if (dialog.returnValue !== 'submit' && trigger?.isConnected) trigger.focus()
  })
  form.addEventListener('submit', event => {
    event.preventDefault()
    if (!form.reportValidity()) return
    dialog.close('submit')
    recordReviewDecision({request, decision, reason: reason.value, trigger})
  })
  document.body.append(dialog)
  dialog.showModal()
  reason.focus()
}

const openChangeRequestDeleteDialog = ({request, trigger}) => {
  const dialog = create('dialog', {className: 'change-request-dialog review-decision-dialog', 'aria-labelledby': 'change-request-delete-title'})
  const form = create('form', {className: 'change-request-form', method: 'dialog'})
  const error = create('p', {className: 'request-error', role: 'alert', 'aria-live': 'assertive', hidden: true})
  const close = create('button', {type: 'button', className: 'icon-button', 'aria-label': '변경 요청 삭제 닫기', text: '×'})
  const cancel = create('button', {type: 'button', className: 'secondary-button', text: '취소'})
  const submit = create('button', {type: 'submit', className: 'danger-button', text: '영구 삭제'})
  form.append(
    create('header', {className: 'request-dialog-header'}, [
      create('div', {}, [create('span', {className: 'eyebrow', text: 'DELETE DRAFT'}), create('h2', {id: 'change-request-delete-title', text: '변경 요청 삭제'})]),
      close,
    ]),
    create('p', {className: 'review-warning-copy', text: '아직 정본에 승인 반영되지 않은 작업 초안을 삭제합니다. 요청 원본, 수정본, 영향도·적용 실행 기록과 미승인 candidate가 함께 삭제되며 복구할 수 없습니다.'}),
    create('section', {className: 'request-context', 'aria-label': '삭제 대상'}, [
      create('div', {}, [create('small', {text: 'Change Request'}), create('strong', {text: request.id})]),
      create('div', {}, [create('small', {text: 'Target'}), create('strong', {text: request.context.subFeatureId ?? request.context.featureId ?? '프로젝트(부트스트랩)'})]),
    ]),
    error,
    create('footer', {className: 'request-dialog-actions'}, [cancel, submit]),
  )
  dialog.append(form)
  close.addEventListener('click', () => dialog.close('cancel'))
  cancel.addEventListener('click', () => dialog.close('cancel'))
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close('cancel') })
  dialog.addEventListener('close', () => {
    dialog.remove()
    if (dialog.returnValue !== 'deleted' && trigger?.isConnected) trigger.focus()
  })
  form.addEventListener('submit', async event => {
    event.preventDefault()
    submit.disabled = true
    submit.textContent = '삭제 중…'
    error.hidden = true
    try {
      await deleteApi(`/api/projects/${encodeURIComponent(state.projectId)}/change-requests/${encodeURIComponent(request.id)}`)
      state.detail = await api(`/api/projects/${encodeURIComponent(state.projectId)}`)
      if (state.focusChangeRequestId === request.id) {
        state.focusChangeRequestId = null
        writeLocation({replace: true})
      }
      dialog.close('deleted')
      renderContent()
      showMessage(`${request.id} 변경 요청과 연결된 임시 산출물을 삭제했습니다.`)
    } catch (deleteError) {
      error.textContent = `변경 요청을 삭제하지 못했습니다: ${deleteError.message}`
      error.hidden = false
      submit.disabled = false
      submit.textContent = '영구 삭제'
    }
  })
  document.body.append(dialog)
  dialog.showModal()
  cancel.focus()
}

const openCodexApplyDialog = ({request, impactRun, trigger}) => {
  const dialog = create('dialog', {className: 'change-request-dialog codex-apply-dialog', 'aria-labelledby': 'codex-apply-title'})
  const form = create('form', {className: 'change-request-form', method: 'dialog'})
  const cancel = create('button', {type: 'button', className: 'secondary-button', text: '취소'})
  const submit = create('button', {type: 'submit', className: 'primary-button', text: 'Candidate 생성 시작'})
  const revisionDecision = request.latestReviewDecision?.decision === 'REVISION_REQUESTED' ? request.latestReviewDecision : null
  form.append(
    create('header', {className: 'request-dialog-header'}, [
      create('div', {}, [create('span', {className: 'eyebrow', text: '실행기 · L2 APPROVAL'}), create('h2', {id: 'codex-apply-title', text: '격리 변경 후보 생성'})]),
      create('button', {type: 'button', className: 'icon-button', 'aria-label': '변경 적용 닫기', text: '×'}),
    ]),
    create('p', {className: 'request-boundary-copy', text: '실행기 workspace-write 세션은 서버가 만든 temporary candidate만 수정합니다. 정본은 검토 승인 전 변경되지 않으며 commit, push, PR, deploy와 danger-full-access는 허용되지 않습니다.'}),
    create('section', {className: 'request-context', 'aria-label': '적용 기준'}, [
      create('div', {}, [create('small', {text: 'Change Request'}), create('strong', {text: request.id})]),
      create('div', {}, [create('small', {text: 'Target'}), create('strong', {text: request.context.subFeatureId ?? request.context.featureId ?? '프로젝트(부트스트랩)'})]),
      create('div', {}, [create('small', {text: 'Impact outcome'}), create('strong', {text: impactRun.result.outcome})]),
      create('div', {}, [create('small', {text: 'Base design'}), create('strong', {text: request.context.previewDigest ? `${request.context.previewStatus} · ${request.context.previewDigest.slice(0, 12)}…` : request.context.previewStatus})]),
    ]),
    create('div', {className: 'codex-impact-summary'}, [create('strong', {text: '영향 검토 요약'}), create('p', {text: impactRun.result.summary})]),
    ...(revisionDecision ? [create('div', {className: 'review-feedback-summary'}, [create('strong', {text: '반영할 수정 요청'}), create('p', {text: revisionDecision.reason})])] : []),
    create('label', {className: 'codex-approval-check'}, [
      create('input', {type: 'checkbox', required: true}),
      create('span', {text: '격리 candidate의 planning·TC·design·preview 변경과 검증 결과를 확인한 뒤 정본 적용 여부를 별도로 결정하겠습니다.'}),
    ]),
    create('footer', {className: 'request-dialog-actions'}, [cancel, submit]),
  )
  dialog.append(form)
  const closeButton = form.querySelector('.icon-button')
  closeButton.addEventListener('click', () => dialog.close('cancel'))
  cancel.addEventListener('click', () => dialog.close('cancel'))
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close('cancel') })
  dialog.addEventListener('close', () => {
    dialog.remove()
    if (dialog.returnValue !== 'apply' && trigger?.isConnected) trigger.focus()
  })
  form.addEventListener('submit', event => {
    event.preventDefault()
    if (!form.reportValidity()) return
    dialog.close('apply')
    startCodexRun({request, phase: 'apply', impactRun, trigger})
  })
  document.body.append(dialog)
  dialog.showModal()
  form.querySelector('input').focus()
}

const codexRunStatus = run => {
  if (!run) return 'PROPOSED'
  if (run.status !== 'COMPLETED') return run.status
  if (run.phase === 'impact') return run.result?.outcome === 'BLOCKED' ? 'BLOCKED' : run.result?.outcome === 'ALREADY_APPLIED' ? 'NO_CHANGE' : 'IMPACT_REVIEW'
  return run.result?.outcome ?? 'READY_FOR_REVIEW'
}

const reviewDecisionForRun = (request, applyRun) => applyRun
  ? (request.reviewDecisions ?? []).find(decision => decision.applyRunId === applyRun.runId) ?? null
  : null

const requestLifecycleStatus = (request, impactRun, applyRun, staleImpact = false) => reviewDecisionForRun(request, applyRun)?.decision ?? (staleImpact ? 'REQUEST_REVISED' : codexRunStatus(applyRun ?? impactRun))

const LIFECYCLE_STEP_LABELS = ['요청', '영향 검토', '적용 candidate', '검토 결정']

const lifecycleStageIndex = ({impactRun, applyRun, staleImpact, reviewDecision}) => {
  if (reviewDecision) return reviewDecision.decision === 'REVISION_REQUESTED' ? 2 : 3
  if (applyRun) return applyRun.status === 'COMPLETED' && applyRun.result?.outcome === 'READY_FOR_REVIEW' ? 3 : 2
  if (staleImpact) return 1
  if (impactRun) return impactRun.status === 'COMPLETED' && impactRun.result?.outcome === 'READY' ? 2 : 1
  return 0
}

const lifecycleStepsIndicator = context => {
  const current = lifecycleStageIndex(context)
  const terminal = context.reviewDecision && context.reviewDecision.decision !== 'REVISION_REQUESTED'
  return create('ol', {className: 'lifecycle-steps', 'aria-label': `진행 단계 ${current + 1}/${LIFECYCLE_STEP_LABELS.length}: ${LIFECYCLE_STEP_LABELS[current]}`}, LIFECYCLE_STEP_LABELS.map((label, index) => {
    const modifier = index < current || (terminal && index === current) ? ' is-done' : index === current ? ' is-current' : ''
    const item = create('li', {className: `lifecycle-step${modifier}`, text: label})
    if (index === current && !terminal) item.setAttribute('aria-current', 'step')
    return item
  }))
}

const codexRunMetrics = run => {
  if (run.cache?.hit) return '캐시 재사용 · 모델 호출 없음'
  const usage = run.usage
  if (!usage) return '토큰 사용량 NOT_MEASURED'
  const parts = []
  if (Number.isSafeInteger(usage.totalTokens)) parts.push(`토큰 ${usage.totalTokens.toLocaleString('ko-KR')}`)
  if (Number.isSafeInteger(usage.inputTokens)) parts.push(`입력 ${usage.inputTokens.toLocaleString('ko-KR')}`)
  if (Number.isSafeInteger(usage.cachedInputTokens)) parts.push(`캐시 ${usage.cachedInputTokens.toLocaleString('ko-KR')}`)
  if (Number.isSafeInteger(usage.outputTokens)) parts.push(`출력 ${usage.outputTokens.toLocaleString('ko-KR')}`)
  return parts.length > 0 ? parts.join(' · ') : '토큰 사용량 NOT_MEASURED'
}

const appendCodexResult = (card, run, {stale = false} = {}) => {
  if (!run) return
  const hasLongResult = Boolean(run.result && (
    run.result.affectedFiles.length
    || run.result.risks.length
    || run.result.blockers.length
    || run.candidate?.changedFiles?.length
  ))
  const runExecutorLabel = '실행기'
  const panel = create('section', {className: `codex-run-panel${hasLongResult ? ' is-scrollable' : ''}`, 'aria-label': `${run.phase} ${runExecutorLabel} 실행`}, [
    create('div', {className: 'codex-run-heading'}, [create('strong', {text: run.phase === 'impact' ? `${runExecutorLabel} 영향 검토` : `${runExecutorLabel} 변경 적용`}), statusChip(stale ? 'STALE' : codexRunStatus(run))]),
  ])
  if (stale) panel.append(create('p', {className: 'codex-run-error', role: 'status', text: '요청 내용이 수정되어 이 영향도 결과는 적용 기준으로 사용할 수 없습니다. 최신 요청으로 다시 검토하세요.'}))
  if (run.result) {
    panel.append(create('p', {className: 'codex-run-summary', text: run.result.summary}))
    if (run.result.affectedFiles.length > 0 && (run.phase === 'impact' || !run.candidate)) panel.append(create('div', {className: 'codex-run-list'}, [create('strong', {text: run.phase === 'impact' ? '예상 영향 파일' : '변경 파일'}), create('ul', {}, run.result.affectedFiles.map(path => create('li', {text: path}))) ]))
    if (run.result.risks.length > 0) panel.append(create('div', {className: 'codex-run-list'}, [create('strong', {text: '위험/주의'}), create('ul', {}, run.result.risks.map(value => create('li', {text: value}))) ]))
    if (run.result.blockers.length > 0) panel.append(create('div', {className: 'codex-run-list'}, [create('strong', {text: 'Blockers'}), create('ul', {}, run.result.blockers.map(value => create('li', {text: value}))) ]))
    if (run.candidate?.changedFiles?.length > 0) panel.append(create('div', {className: 'codex-run-list candidate-change-list'}, [
      create('strong', {text: `격리 candidate · ${run.candidate.changedFiles.length}개 파일`}),
      create('ul', {}, run.candidate.changedFiles.map(change => create('li', {text: `${change.kind.toUpperCase()} · ${change.path}`}))),
    ]))
    if (!stale && run.phase === 'impact' && run.result.outcome === 'BLOCKED') {
      panel.append(create('p', {className: 'codex-run-error', text: '영향 검토가 BLOCKED로 종료되어 적용 단계로 진행할 수 없습니다. Blockers를 확인하고 ‘요청 수정’으로 요청을 갱신하면 새 영향 검토를 시작할 수 있습니다.'}))
    }
  } else if (run.error) {
    // 오류 코드는 API 계약이라 저장값을 바꾸지 않고 표시에서만 실행기 중립화한다
    const displayCode = String(run.error.code ?? '').replace(/^(?:UNSAFE_)?CODEX_/, 'EXECUTOR_')
    panel.append(create('p', {className: 'codex-run-error', role: 'alert', text: run.error.code === 'CODEX_RUN_TIMED_OUT'
      ? `${displayCode}: ${run.error.message} 자동 재시도하지 않았습니다. 영향 범위를 확인한 뒤 ‘변경 적용 다시 실행’을 사용하세요.`
      : `${displayCode}: ${run.error.message}`}))
  }
  else panel.append(create('p', {className: 'codex-run-summary', text: run.status === 'PENDING' ? '실행을 준비하고 있습니다.' : '실행기가 현재 repository와 요청을 확인하고 있습니다.'}))
  const contextMetrics = run.impactContext
    ? `Context ${run.impactContext.documentCount} docs · ${Number(run.impactContext.manifestBytes).toLocaleString('ko-KR')} bytes`
    : null
  panel.append(create('p', {className: 'codex-thread-id', text: [codexRunMetrics(run), contextMetrics].filter(Boolean).join(' · ')}))
  if (run.threadId) panel.append(create('p', {className: 'codex-thread-id'}, [document.createTextNode(`${runExecutorLabel} thread `), create('code', {text: run.threadId})]))
  card.append(panel)
}

const appendReviewDecision = (card, decision) => {
  if (!decision) return
  const labels = {APPROVED: '승인됨', REVISION_REQUESTED: '수정 요청됨', DISCARDED: '폐기됨'}
  card.append(create('section', {className: `review-decision-panel ${statusClass(decision.decision)}`, 'aria-label': '검토 결정'}, [
    create('div', {className: 'review-decision-heading'}, [create('strong', {text: labels[decision.decision] ?? decision.decision}), create('time', {dateTime: decision.createdAt, text: formatTime(decision.createdAt)})]),
    decision.reason ? create('p', {text: decision.reason}) : create('p', {text: '별도 검토 메모가 없습니다.'}),
  ]))
}

const renderChanges = () => {
  const requests = state.detail.changeRequests ?? []
  const changes = state.detail.changes
  const connection = state.codexConnection
  const connectionAction = create('button', {type: 'button', className: 'secondary-button', text: '연결 다시 확인'})
  connectionAction.addEventListener('click', () => refreshCodexConnection({announce: true}))
  const executorLabel = '실행기'
  const candidateReasons = connection?.candidates ?? (connection ? [connection] : [])
  const noCliInstalled = candidateReasons.length > 0 && candidateReasons.every(candidate => String(candidate.reason ?? '').endsWith('NOT_INSTALLED') || String(candidate.reason ?? '').endsWith('UNAVAILABLE'))
  const connectionPanel = create('section', {className: `codex-connection-panel ${connection?.connected ? 'is-connected' : 'is-disconnected'}`}, [
    create('div', {}, [
      create('div', {className: 'codex-connection-title'}, [create('strong', {text: '실행기 연결'}), statusChip(connection?.connected ? 'CONNECTED' : 'CONNECTION_REQUIRED')]),
      create('p', {text: connection?.connected
        ? '저장된 실행기 인증을 사용합니다. 요청 등록과 실행 승인은 분리됩니다.'
        : noCliInstalled
          ? '사용 가능한 실행기 CLI를 찾지 못했습니다. 실행기를 설치한 뒤 Console 서버를 다시 시작하세요.'
          : '실행기 CLI 인증이 필요합니다. 터미널에서 실행기 로그인을 완료한 뒤 다시 확인하세요.'}),
    ]),
    connectionAction,
  ])
  const requestSection = create('section', {className: 'change-history-section'}, [
    create('div', {className: 'subsection-heading'}, [create('div', {}, [create('h3', {text: 'Change requests'}), create('p', {text: '승인된 변경은 이력으로 보존하고, 승인 전 작업 초안은 수정하거나 삭제할 수 있습니다.'})]), create('span', {className: 'count-badge', text: String(requests.length)})]),
  ])
  if (requests.length === 0) requestSection.append(create('div', {className: 'compact-empty-state', text: '아직 생성된 변경 요청이 없습니다. Features 또는 Preview에서 요청을 시작할 수 있습니다.'}))
  else {
    const requestGrid = create('div', {className: 'request-history-grid'})
    for (const request of requests) {
      const latestImpactRun = latestCodexRun(request.id, 'impact')
      // 서버의 stale 판정은 요청 개정 축 + 증거(contextDigest) 축 2겹이다. 클라이언트는
      // 증거 축을 재계산할 수 없어, apply 409(CODEX_IMPACT_STALE)에서 표시해 둔 run을
      // 만료로 취급해 "영향 검토 다시 실행" 경로를 연다.
      const impactRun0 = latestCurrentCodexRun(request, 'impact')
      const impactRun = impactRun0 && state.evidenceStaleRunIds?.has(impactRun0.runId) ? null : impactRun0
      const applyRun = latestCodexRun(request.id, 'apply')
      const staleImpact = Boolean(latestImpactRun && (!runMatchesCurrentRequest(latestImpactRun, request) || state.evidenceStaleRunIds?.has(latestImpactRun.runId)))
      const reviewDecision = reviewDecisionForRun(request, applyRun)
      const targetButton = create('button', {type: 'button', className: 'inline-link-button', text: request.context.subFeatureId ?? request.context.featureId ?? '프로젝트(부트스트랩)'})
      targetButton.addEventListener('click', () => {
        state.featureId = request.context.featureId
        state.subFeatureId = request.context.subFeatureId ?? null
        setTab('features')
      })
      const card = create('article', {className: 'request-history-card', tabindex: '-1', dataset: {requestId: request.id}}, [
        create('div', {className: 'request-history-header'}, [
          create('div', {}, [create('span', {className: 'feature-id', text: request.id}), create('h4', {text: request.title})]),
          statusChip(requestLifecycleStatus(request, impactRun, applyRun, staleImpact)),
        ]),
        lifecycleStepsIndicator({impactRun, applyRun, staleImpact, reviewDecision}),
        create('p', {className: 'request-summary', text: request.requestedChange}),
        create('dl', {className: 'request-history-meta'}, [
          create('dt', {text: 'Target'}), create('dd', {}, [targetButton]),
          create('dt', {text: 'Version intent'}), create('dd', {text: request.versionIntent}),
          create('dt', {text: 'Request revision'}), create('dd', {text: request.revisionCount ? `${request.currentRevision.revisionId} · ${request.revisionCount}회 수정` : '원본'}),
          create('dt', {text: 'Base design'}), create('dd', {text: request.context.previewDigest ? `${request.context.previewStatus} · ${request.context.previewDigest.slice(0, 12)}…` : request.context.previewStatus}),
          create('dt', {text: 'Created'}), create('dd', {text: new Intl.DateTimeFormat('ko-KR', {dateStyle: 'medium', timeStyle: 'short'}).format(new Date(request.createdAt))}),
        ]),
      ])
      if (request.revisions?.length > 0) card.append(create('details', {className: 'request-revision-history'}, [
        create('summary', {text: `요청 수정 이력 ${request.revisions.length}건`}),
        create('ol', {}, request.revisions.map(revision => create('li', {}, [
          create('strong', {text: revision.revisionId}),
          create('time', {dateTime: revision.createdAt, text: formatTime(revision.createdAt)}),
          create('span', {text: revision.title}),
        ]))),
      ]))
      appendCodexResult(card, applyRun ?? impactRun ?? latestImpactRun, {stale: !applyRun && !impactRun && staleImpact})
      appendReviewDecision(card, reviewDecision)
      appendImplementationVerification(card, request)
      const actions = create('div', {className: 'request-codex-actions'})
      const active = hasActiveCodexRun()
      const requestActive = hasActiveCodexRunForRequest(request.id)
      if (!applyRun && !request.latestReviewDecision) {
        const editButton = create('button', {type: 'button', className: 'secondary-button', text: '요청 수정', disabled: active})
        editButton.addEventListener('click', () => openChangeRequestRevisionDialog({request, trigger: editButton}))
        actions.append(editButton)
      }
      if (reviewDecision?.decision === 'REVISION_REQUESTED') {
        const reviseButton = create('button', {type: 'button', className: 'primary-button', text: `${executorLabel} 수정 반영`, disabled: !connection?.connected || active})
        reviseButton.addEventListener('click', () => openCodexApplyDialog({request, impactRun, trigger: reviseButton}))
        actions.append(reviseButton)
      } else if (!reviewDecision && applyRun?.status === 'COMPLETED' && applyRun.result?.outcome === 'READY_FOR_REVIEW') {
        const approveButton = create('button', {type: 'button', className: 'primary-button', text: '승인'})
        const revisionButton = create('button', {type: 'button', className: 'secondary-button', text: '수정 요청'})
        const discardButton = create('button', {type: 'button', className: 'danger-button', text: '변경 폐기'})
        approveButton.addEventListener('click', () => openReviewDecisionDialog({request, decision: 'APPROVED', trigger: approveButton, applyRun}))
        revisionButton.addEventListener('click', () => openReviewDecisionDialog({request, decision: 'REVISION_REQUESTED', trigger: revisionButton, applyRun}))
        discardButton.addEventListener('click', () => openReviewDecisionDialog({request, decision: 'DISCARDED', trigger: discardButton, applyRun}))
        actions.append(approveButton, revisionButton, discardButton)
      } else if (!request.latestReviewDecision && (!impactRun || ['FAILED', 'TIMED_OUT', 'INTERRUPTED'].includes(impactRun.status))) {
        // 대상 없는 CR(bootstrap·newFeature)은 같은 파이프라인이 기획 초안 생성으로 동작한다.
        const targetlessCr = request.context?.featureId === null && (request.context?.bootstrap || request.context?.newFeature)
        const impactLabel = targetlessCr ? '기획 정찰' : '영향 검토'
        const impactButton = create('button', {type: 'button', className: 'secondary-button', text: latestImpactRun ? `${impactLabel} 다시 실행` : impactLabel, disabled: !connection?.connected || active})
        impactButton.addEventListener('click', () => startCodexRun({request, phase: 'impact', trigger: impactButton}))
        actions.append(impactButton)
      } else if (!request.latestReviewDecision && impactRun.status === 'COMPLETED' && impactRun.result?.outcome === 'READY' && (!applyRun || ['FAILED', 'TIMED_OUT', 'INTERRUPTED'].includes(applyRun.status))) {
        const targetlessCr = request.context?.featureId === null && (request.context?.bootstrap || request.context?.newFeature)
        const applyLabel = targetlessCr ? '기획 초안 생성' : '변경 적용'
        const applyButton = create('button', {type: 'button', className: 'primary-button', text: applyRun ? `${applyLabel} 다시 실행` : applyLabel, disabled: !connection?.connected || active})
        applyButton.addEventListener('click', () => openCodexApplyDialog({request, impactRun, trigger: applyButton}))
        actions.append(applyButton)
      }
      const approved = (request.reviewDecisions ?? []).some(decision => decision.decision === 'APPROVED')
      if (!approved && !requestActive) {
        const deleteButton = create('button', {type: 'button', className: 'danger-button', text: '요청 삭제'})
        deleteButton.addEventListener('click', () => openChangeRequestDeleteDialog({request, trigger: deleteButton}))
        actions.append(deleteButton)
      }
      if (actions.childElementCount > 0) card.append(actions)
      requestGrid.append(card)
    }
    requestSection.append(requestGrid)
  }

  const sessionSection = create('section', {className: 'change-history-section'}, [
    create('div', {className: 'subsection-heading'}, [create('div', {}, [create('h3', {text: 'Session document changes'}), create('p', {text: `서버 시작 baseline ${formatTime(state.detail.baselineAt)} 대비입니다.`})]), changes.length === 0 ? statusChip('UNCHANGED') : create('span', {className: 'count-badge', text: String(changes.length)})]),
  ])
  if (changes.length === 0) sessionSection.append(create('div', {className: 'compact-empty-state', text: 'Console 서버 시작 이후 감지된 Source/Plan/Design 변경이 없습니다.'}))
  else {
  const grid = create('div', {className: 'changes-grid'})
  for (const change of changes) {
    const card = create('article', {className: 'change-card'}, [
      create('div', {className: 'change-card-header'}, [
        create('div', {}, [create('span', {className: `change-kind change-${change.kind}`, text: change.kind}), create('div', {className: 'change-path', text: change.path})]),
        create('span', {className: 'line-delta', text: change.kind === 'modified' ? `${change.beforeLines} → ${change.lines} lines` : `${change.lines ?? change.beforeLines ?? 0} lines`}),
      ]),
    ])
    if (change.diff) card.append(create('div', {className: 'diff-grid'}, [
      create('pre', {className: 'diff-block diff-removed', text: change.diff.removedPreview.map(line => `- ${line}`).join('\n') || 'No removed lines'}),
      create('pre', {className: 'diff-block diff-added', text: change.diff.addedPreview.map(line => `+ ${line}`).join('\n') || 'No added lines'}),
    ]))
    grid.append(card)
  }
    sessionSection.append(grid)
  }
  const view = create('div', {}, [heading('Changes', '영구 변경 요청, 승인 기반 실행기 실행과 현재 Console 세션의 파일 변경을 구분해 표시합니다.'), connectionPanel, requestSection, sessionSection])
  if (state.focusChangeRequestId) {
    const requestId = state.focusChangeRequestId
    setTimeout(() => {
      const card = view.querySelector(`[data-request-id="${CSS.escape(requestId)}"]`)
      if (!card?.isConnected) return
      card.focus()
      if (state.focusChangeRequestId === requestId) state.focusChangeRequestId = null
    }, 0)
  }
  scheduleCodexPoll()
  return view
}

// 단계 탭 내부의 서브탭 바 — 상단 탭(단계)과 같은 시각 언어를 쓰되 상태는 state.*Pane.
const paneTabBar = (ariaLabel, items, current, onSelect) => create('div', {className: 'tabs preview-pane-tabs', role: 'tablist', 'aria-label': ariaLabel}, items.map(([id, label]) => {
  const button = create('button', {type: 'button', role: 'tab', 'aria-selected': String(current === id), text: label})
  button.addEventListener('click', () => { if (current !== id) onSelect(id) })
  return button
}))

const renderFeaturesTab = () => {
  const pane = state.featuresPane === 'changes' ? 'changes' : 'features'
  const bar = paneTabBar('기능 단계 보기', [['features', 'Features'], ['changes', 'Changes']], pane, id => {
    state.featuresPane = id
    writeLocation()
    renderContent()
  })
  return create('div', {className: 'stage-tab'}, [bar, create('div', {className: 'stage-tab-body'}, [pane === 'changes' ? renderChanges() : renderFeatures()])])
}

const renderDesignTab = () => {
  const pane = state.designPane === 'preview' ? 'preview' : 'design'
  const bar = paneTabBar('디자인 단계 보기', [['design', 'Design'], ['preview', 'Preview']], pane, id => {
    state.designPane = id
    writeLocation()
    renderContent()
  })
  return create('div', {className: 'stage-tab'}, [bar, create('div', {className: 'stage-tab-body'}, [pane === 'preview' ? renderPreview() : renderDesign()])])
}

// Development — 라이브 dev 서버 운영(상태·시작/중지·launch 항목). 기획 확인 표면
// (델타 임베드)은 Design > Preview 소관이고, 여기는 서버 운영 상세만 담당한다.
const renderDevelopment = () => {
  const live = state.detail.livePreview
  const container = create('div', {}, [heading('Development', '라이브 dev 서버 운영 — 상태 확인과 시작/중지를 관리합니다. 기획 확인 화면은 Design > Preview에 있습니다.')])
  if (!live) {
    container.append(create('article', {className: 'panel'}, [
      create('h3', {text: '라이브 서버 설정이 없습니다'}),
      create('p', {className: 'panel-copy', text: '이 프로젝트에는 라이브 베이스 대상(preview/live.json 또는 델타 킷 manifest의 target)이 선언돼 있지 않습니다. 그린필드 프로젝트는 정적 디자인 프리뷰(Design > Preview)로 확인하며, dev 서버 운영이 필요해지는 시점(라이브 델타 전환)에 이 탭이 활성화됩니다.'}),
    ]))
    return container
  }
  const chip = create('span', {className: 'status-chip status-pending live-health-chip', 'aria-live': 'polite', text: 'BASE 확인 중'})
  const infoList = create('dl', {className: 'dev-info'})
  const controls = create('div', {className: 'dev-controls'})
  let timer = null
  let busy = false
  let signature = null
  const poll = async () => {
    if (busy) return
    busy = true
    clearTimeout(timer)
    if (!document.contains(chip)) { busy = false; return }
    try {
      const body = await fetch(`/api/live-base/health?project=${encodeURIComponent(state.projectId)}`).then(r => r.json())
      if (!document.contains(chip)) { busy = false; return }
      const identityState = body.identity?.state
      if (body.healthy && identityState !== 'mismatch' && identityState !== 'invalid') {
        chip.textContent = identityState === 'verified' ? 'BASE 신원 일치' : 'BASE 실행 중'
        chip.className = 'status-chip status-approved live-health-chip'
      } else if (body.healthy) {
        chip.textContent = identityState === 'invalid' ? 'IDENTITY 설정 오류' : 'BASE 다른 앱 응답'
        chip.className = 'status-chip status-failed live-health-chip'
      } else {
        chip.textContent = 'BASE 응답 없음'
        chip.className = 'status-chip status-failed live-health-chip'
      }
      const managed = body.managed ?? null
      // 내용이 같으면 재렌더하지 않는다 — 무장 상태·'시작 중…'·인라인 오류 보존.
      const sig = JSON.stringify({healthy: body.healthy ?? false, identity: identityState ?? null, managed: managed ? `${managed.entry}@${managed.startedAt}` : null, hints: (body.startHints ?? []).map(hint => hint.name)})
      if (sig !== signature) {
        signature = sig
        infoList.replaceChildren(...[
          ['대상', body.target ?? live.target],
          ['identity 선언', identityState === 'undeclared' ? '없음 — 포트의 앱이 이 프로젝트인지 대조하지 못합니다' : identityState === 'invalid' ? '유효하지 않음 (titleIncludes는 1~200자 문자열)' : body.identity?.expected ? `titleIncludes "${body.identity.expected}"` : '선언됨'],
          ['프로세스', managed ? `콘솔 관리 — launch.json "${managed.entry}" (시작 ${formatTime(managed.startedAt)})` : body.healthy ? '외부 실행 중 (콘솔 관리 아님)' : '실행 중 아님'],
        ].flatMap(([term, value]) => [create('dt', {text: term}), create('dd', {text: value})]))
        const children = []
        if (!body.healthy) {
          children.push(create('p', {className: 'panel-copy', text: '아래 명령으로 서버를 시작합니다 (repo 루트에서 실행):'}))
          if ((body.startHints ?? []).length > 1) children.push(create('p', {className: 'panel-copy', text: '⚠ 같은 포트에 launch.json 항목이 여러 개 등록돼 있습니다 — 이 서비스에 맞는 항목만 시작하세요.'}))
          children.push(...(body.startHints ?? []).map(hint => buildStartHintRow(hint, poll)))
          if ((body.startHints ?? []).length === 0) children.push(create('p', {className: 'panel-copy', text: '.claude/launch.json에서 대상 포트의 시작 명령을 찾지 못했습니다. 대상 서버를 수동으로 시작하세요.'}))
        } else if (managed) {
          const stopError = create('p', {className: 'live-health-inline-error', hidden: true})
          children.push(create('div', {className: 'live-health-command'}, [
            create('code', {text: `launch.json "${managed.entry}" — 콘솔이 관리 중`}),
            create('button', {type: 'button', className: 'secondary-button', text: '베이스 중지', onclick: event => armedClick(event.currentTarget, '한 번 더 누르면 중지', async () => {
              stopError.hidden = true
              try {
                await mutateApi('/api/live-base/stop', {project: state.projectId}, crypto.randomUUID(), 'stop-live-base')
                setTimeout(poll, 800)
              } catch (error) {
                stopError.textContent = `중지 실패: ${error.message}`
                stopError.hidden = false
              }
            })}),
            stopError,
          ]))
        } else {
          children.push(create('p', {className: 'panel-copy', text: '서버가 콘솔 밖(터미널 등)에서 실행 중입니다 — 중지는 실행한 곳에서 하세요.'}))
        }
        controls.replaceChildren(...children)
      }
    } catch { /* 콘솔 서버 통신 실패 — 다음 주기에 재시도 */ }
    busy = false
    timer = setTimeout(poll, 8000)
  }
  setTimeout(poll, 0)
  container.append(create('article', {className: 'panel dev-live-panel'}, [
    create('div', {className: 'dev-live-head'}, [
      create('h3', {text: '라이브 베이스'}),
      chip,
      create('a', {href: live.target, target: '_blank', rel: 'noopener', className: 'secondary-button', text: '대상 직접 열기'}),
    ]),
    infoList,
    controls,
  ]))
  return container
}

const renderContent = () => {
  if (!state.detail) return
  const view = {
    overview: renderOverview,
    design: renderDesignTab,
    documents: renderDocuments,
    features: renderFeaturesTab,
    development: renderDevelopment,
  }[state.tab]?.() ?? renderOverview()
  elements.content.replaceChildren(view)
  // 전체 높이 잠금 등 표면별 CSS의 기준 — 탭이 아니라 실제 보이는 표면(서브탭 반영).
  document.body.dataset.activeSurface = state.tab === 'features'
    ? (state.featuresPane === 'changes' ? 'changes' : 'features')
    : state.tab === 'design'
      ? (state.designPane === 'preview' ? 'preview' : 'design')
      : state.tab
}

const loadCatalog = async ({refresh = false} = {}) => {
  if (state.loading) return
  state.loading = true
  elements.refreshButton.disabled = true
  showMessage(refresh ? '디스크를 다시 인덱싱하고 있습니다…' : '')
  try {
    const previousProjectId = state.projectId
    state.catalog = await api(`/api/projects${refresh ? '?refresh=1' : ''}`)
    state.previewOrigin = state.catalog.previewOrigin
    const locationState = parseLocation()
    const nextProjectId = state.catalog.projects.some(project => project.id === (locationState.projectId ?? previousProjectId))
      ? (locationState.projectId ?? previousProjectId)
      : state.catalog.projects[0]?.id ?? null
    state.tab = locationState.tab
    applyLocationPanes(locationState)
    state.documentPath = locationState.documentPath
    state.featureId = locationState.featureId
    state.subFeatureId = locationState.subFeatureId
    state.previewAnchorId = locationState.previewAnchorId
    state.focusChangeRequestId = locationState.changeRequestId
    renderProjectNavigation()
    updateHeader()
    if (nextProjectId) {
      await selectProject(nextProjectId, {updateLocation: true})
      setTab(state.tab, {updateLocation: false})
    }
    else elements.content.replaceChildren(create('div', {className: 'empty-state onboarding-state'}, [
      create('div', {className: 'onboarding-panel'}, [
        create('h2', {text: '아직 _workspace 프로젝트가 없습니다'}),
        create('p', {text: `스캔 위치: ${state.catalog?.scanRoot ?? '현재 프로젝트'} (하위 깊이 4까지)`}),
        create('p', {text: 'Console은 web-harness가 생성하는 _workspace/(00_source·01_plan·02_design) 기획·디자인 산출물과 디자인 프리뷰를 표시합니다.'}),
        create('div', {className: 'onboarding-steps'}, [
          create('p', {text: '시작하려면 이 프로젝트의 Claude Code 세션에서:'}),
          create('ul', {}, [
            create('li', {text: '/web-plan (플러그인: /web-harness:web-plan) — 기획 단계만 실행해 _workspace/01_plan을 생성'}),
            create('li', {text: '/web-orchestrator (플러그인: /web-harness:web-orchestrator) — 기획부터 QA까지 전체 파이프라인 실행'}),
            create('li', {text: '기존 PRD·화면정의서·디자인 문서가 있으면 web-orchestrator가 _workspace/00_source로 정규화한 뒤 이어서 진행'}),
          ]),
          create('p', {text: '문서가 생성되면 위의 ‘디스크 새로고침’을 누르세요.'}),
        ]),
      ]),
    ]))
    showMessage(refresh ? `새로고침 완료 · ${state.catalog.projects.length}개 프로젝트` : '')
  } catch (error) {
    showMessage(`Console 데이터를 불러오지 못했습니다: ${error.message}`, true)
    elements.content.replaceChildren(create('div', {className: 'empty-state', text: '로컬 Console 서버 상태를 확인해 주세요.'}))
  } finally {
    state.loading = false
    elements.refreshButton.disabled = false
  }
}

for (const tab of elements.tabs) {
  tab.addEventListener('click', () => setTab(tab.dataset.tab))
  tab.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const current = elements.tabs.indexOf(tab)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? elements.tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + elements.tabs.length) % elements.tabs.length
    elements.tabs[next].focus()
    setTab(elements.tabs[next].dataset.tab)
  })
}
elements.refreshButton.addEventListener('click', () => loadCatalog({refresh: true}))
window.addEventListener('message', handlePreviewMessage)
window.addEventListener('hashchange', async () => {
  const locationState = parseLocation()
  applyLocationPanes(locationState)
  state.documentPath = locationState.documentPath
  state.featureId = locationState.featureId
  state.subFeatureId = locationState.subFeatureId
  state.previewAnchorId = locationState.previewAnchorId
  state.focusChangeRequestId = locationState.changeRequestId
  if (locationState.projectId && locationState.projectId !== state.projectId) await selectProject(locationState.projectId, {updateLocation: false})
  setTab(locationState.tab, {updateLocation: false})
})

loadCatalog()
