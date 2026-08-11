# 공통 조회와 오류

## `GET /api/projects?refresh=0|1`

Returns `{ scannedAt, baselineAt, roots, projects[] }`. Each project contains `id`, `name`, `relativePath`, phase document counts, preview status, feature/test counts, and change summary.

## `GET /api/projects/:id`

Returns project detail, phase-grouped document metadata, features, preview metadata, and changes. Each feature includes list metadata, behavior description, structured test cases, matching Source/Plan/Design document metadata, any validated preview anchor mapping, derived `approvedChanges[]`, and `pageGroup {id,label,route,order,source}`. `source` is `explicit|unknown-reference|screen-fallback|ungrouped`; legacy plans never lose a Feature because grouping metadata is absent. An anchor may expose nullable `fixtureId` and `fixtureMode`; Console only forwards these values to the isolated preview origin.

`approvedChanges[]`는 terminal `APPROVED` decision과 Change Request를 join한 read model이다. `changeRequestId`, title/requested change/version intent, approved time/exact apply run, target/affected FEAT·Sub Feature·TC, source/preview digest와 scope/digest source를 포함한다. 상위 Feature에는 영향 FEAT 기준, Sub Feature에는 명시적인 영향 Sub Feature 기준으로 투영하며 저장된 정본 Feature 문서를 수정하지 않는다.

Detail은 `changeRequests[]`와 `codexRuns[]`도 반환한다. Change Request는 원본 metadata 외에 `reviewDecisions[]`와 nullable `latestReviewDecision` projection을 포함한다. 결정은 `eventId`, `changeRequestId`, exact `applyRunId`, `decision`, bounded `reason`, `createdAt`과 승인 시 optional `featureLinks`를 공개하고 idempotency key는 숨긴다. run은 bounded structured result/error, nullable numeric `usage`, public `impactContext`, optional cache metadata만 포함하며 raw prompt/reasoning/tool output/environment는 포함하지 않는다.

## `GET /api/projects/:id/document?path=<allowlisted-relative-path>`

Returns text content and bounded change detail. Only paths present in the current 00/01/02 document index are accepted. Binary, symlink, oversized, traversal, or missing files return typed 4xx errors.

## Errors

`{ error: { code, message } }` with 400 invalid request, 403 origin/intent/approval rejection, 404 missing project/request/document/preview, 405 method boundary, 409 write collision/sequence exhaustion/Codex disconnected/active run/invalid transition/review scope or digest mismatch, 413 oversized request/document, 415 unsupported media type, 500 bounded internal error.
