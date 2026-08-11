# Change Request API

## `POST /api/projects/:id/change-requests`

Creates exactly one `_workspace/01_plan/change-requests/CHG-YYYYMMDD-NNN.md` with exclusive-create semantics.

- Required headers: `Content-Type: application/json`, same loopback `Origin`, `X-Web-Harness-Intent: create-change-request`, UUID `Idempotency-Key`
- Body limit: 16 KiB
- Body: `targetFeatureId`, optional `subFeatureId`, optional `anchorId`, `title`, `requestedChange`, `reason`, `expectedBehavior`, `versionIntent=patch|minor|major`
- The server rejects unknown Feature/Sub Feature/anchor combinations and derives TC/document/preview digest context from the current catalog.
- Reusing an idempotency key returns the existing record without creating or overwriting a file.
- Success: `201 { created: true, changeRequest }`; replay: `200 { created: false, changeRequest }`.
- Preview origin remains GET/HEAD only.

## `DELETE /api/projects/:id/change-requests/:changeRequestId`

Physically removes an unapproved Change Request and every server-owned temporary artifact linked to it.

- Required headers: same loopback `Origin`, `X-Web-Harness-Intent: delete-change-request`
- No request body and no client-provided path/run ID are accepted.
- The server resolves the current project and exact `CHG-YYYYMMDD-NNN` ownership, then derives revision, Codex run audit, review decision and candidate paths from validated server records.
- Deletion is allowed only while no Codex run is active and no `APPROVED` review decision exists. Other non-approved states, including `REVISION_REQUESTED` and `DISCARDED`, remain deletable because canonical promotion did not occur.
- Before removal, every existing target must be a regular file or safe directory inside its dedicated storage root. A process-level transaction stages exact targets and rolls them back if any move fails, preventing an observable partial delete.
- Success and replay after a completed deletion: `204` with no body. A well-formed absent CHG is treated as an idempotent success; malformed IDs and unknown projects remain typed 4xx.
- Conflict: `409 CHANGE_REQUEST_DELETE_RUN_ACTIVE` or `409 CHANGE_REQUEST_DELETE_APPROVED`; validation or transaction failure removes nothing.
- The endpoint creates no tombstone, cancellation event, reason or replacement Change Request.
