import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PREVIEW_CHANGE_REQUEST,
  isTrustedPreviewMessageSource,
  parsePreviewChangeRequestMessage,
} from '../public/preview-message-contract.mjs'

const validMessage = {
  type: PREVIEW_CHANGE_REQUEST,
  schemaVersion: 1,
  featureId: 'FEAT-004',
  subFeatureId: 'FEAT-004-02',
  anchorId: 'wh-feat-004-02-table-rename',
}

test('preview change request message accepts only bounded FEAT and anchor identifiers', () => {
  assert.deepEqual(parsePreviewChangeRequestMessage(validMessage), {
    featureId: 'FEAT-004',
    subFeatureId: 'FEAT-004-02',
    anchorId: 'wh-feat-004-02-table-rename',
  })
  assert.equal(parsePreviewChangeRequestMessage({...validMessage, schemaVersion: 2}), null)
  assert.equal(parsePreviewChangeRequestMessage({...validMessage, featureId: 'FEAT-999<script>'}), null)
  assert.equal(parsePreviewChangeRequestMessage({...validMessage, subFeatureId: 'FEAT-004-99<script>'}), null)
  assert.equal(parsePreviewChangeRequestMessage({...validMessage, anchorId: '../feature-plan.md'}), null)
  assert.equal(parsePreviewChangeRequestMessage({...validMessage, anchorId: 'a'.repeat(129)}), null)
})

test('preview message source must match the exact iframe window and preview origin', () => {
  const frameWindow = {}
  const previewOrigin = 'http://127.0.0.1:4311'
  assert.equal(isTrustedPreviewMessageSource({eventOrigin: previewOrigin, eventSource: frameWindow, previewOrigin, frameWindow}), true)
  assert.equal(isTrustedPreviewMessageSource({eventOrigin: 'http://127.0.0.1:4310', eventSource: frameWindow, previewOrigin, frameWindow}), false)
  assert.equal(isTrustedPreviewMessageSource({eventOrigin: previewOrigin, eventSource: {}, previewOrigin, frameWindow}), false)
})
