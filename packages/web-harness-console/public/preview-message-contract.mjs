export const PREVIEW_CHANGE_REQUEST = 'web-harness:request-change'
export const PREVIEW_CHANGE_REQUEST_CLOSED = 'web-harness:request-change-closed'
export const PREVIEW_MESSAGE_SCHEMA_VERSION = 1

const FEATURE_ID = /^FEAT-\d{3}$/
const SUB_FEATURE_ID = /^FEAT-\d{3}-\d{2}$/
const ANCHOR_ID = /^[a-zA-Z][a-zA-Z0-9_-]{0,127}$/

export const parsePreviewChangeRequestMessage = data => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  if (data.type !== PREVIEW_CHANGE_REQUEST || data.schemaVersion !== PREVIEW_MESSAGE_SCHEMA_VERSION) return null
  if (typeof data.featureId !== 'string' || !FEATURE_ID.test(data.featureId)) return null
  if (data.subFeatureId !== null && data.subFeatureId !== undefined && (typeof data.subFeatureId !== 'string' || !SUB_FEATURE_ID.test(data.subFeatureId))) return null
  if (typeof data.anchorId !== 'string' || !ANCHOR_ID.test(data.anchorId)) return null
  return {
    featureId: data.featureId,
    subFeatureId: data.subFeatureId ?? null,
    anchorId: data.anchorId,
  }
}

export const isTrustedPreviewMessageSource = ({eventOrigin, eventSource, previewOrigin, frameWindow}) => (
  typeof previewOrigin === 'string'
  && eventOrigin === previewOrigin
  && eventSource !== null
  && eventSource === frameWindow
)
