# Brownfield Adoption — the Adoption Ladder

How to adopt web-harness in a service that is already designed, built, or in flight.
Canonical decision record: 2026-08-10, synthesizing the analytics-spa pilot series (delta
preview, the failed hand-reproduced preview, snapshot hydration, and the CHG-20260807-001
confirmed loop). The preview-first approach was retired and redefined.

> This is a faithful reduced translation of `brownfield-adoption.md` (Korean canonical).
> The maintainer backlog and console follow-up sections live only in the original.

## Diagnosis — why preview-first kept failing

**Greenfield's source of truth is the spec; brownfield's source of truth is the code.**
Greenfield has no code, so spec → preview → approval → implementation is natural. Transplant
that pipeline into brownfield and the authority inverts — the hand-reproduced preview failed
as "a completely different design" (code was canonical, but we redrew from spec), snapshot
hydration worked (it accepted rendered code as canonical), and delta previews looked most
real (they build on running code). All three are symptoms of the same asymmetry.

So brownfield adoption is not "porting the greenfield pipeline" — it is **layering the
harness's change-management loop onto a code-canonical world**.

## Principles

1. **In brownfield, code is canonical.** Specs and previews are derivatives. A brownfield
   spec's status is not a "living mirror" but a **confirmed record at change time**
   (append-only history) — the code moving ahead of the spec is a property, not a defect.
2. **Gates apply only to changes that enter through the harness (CRs).** The team's existing
   workflow is untouched. The team decides the adoption scope.
3. **Preview is a tool, not an obligation.** Reach for it only when a change's approval
   needs visual confirmation.
4. **Approval fidelity.** Plans/designs approved via preview (delta/snapshot) must land in
   the implementation **as approved** — and the judgment is mechanical, not subjective:
   ① implementation input is only the spec pinned by the approval digest (no porting
   preview code — Prototype Isolation), ② completion means **implementation tests passing
   under the same TC IDs** (the console CR's implementation-verification record can only
   list a subset of the approved TCs), ③ new-part designs are recorded as references to the
   existing design system, so implementations that use existing components reproduce visual
   fidelity structurally.

## The adoption ladder

| Level | Name | What it is | Status |
|---|---|---|---|
| L0 | Observe | The console discovers `_workspace` and indexes documents. Non-invasive | Working |
| L1 | Change-management loop | CR → mini-plan (auto-drafted + confirmed) → impact analysis → candidate → approve → apply | **The default adoption story** — proven end-to-end by CHG-20260807-001 (document loop) and CHG-20260810-001 (auto-draft → real implementation → live verification) |
| L2 | Visual confirmation of the delta | Delta/snapshot-hydration toolbox — optional | Tools validated |
| L3 | Gradual canonicalization | As changes accumulate, FEAT/TC coverage grows until the spec converges to canonical (strangler fig) | A natural outcome, not a goal |

Higher levels never require lower ones — L1 stands without any preview.

**Re-entry marker (optional, valid from L0):** brownfield repos never met the scaffolder, so
append the `web-harness-managed` marker block to the root `CLAUDE.md` by hand (the exact
block from the `environment-scaffolder` re-entry marker rule); future sessions then recognize the repo as
harness-managed and enter via the minimal re-entry map. With the plugin installed, the
SessionStart hook injects the same guidance automatically on `_workspace/` detection — the
marker covers hook-less environments.

## Entry point — change-driven (option A, confirmed)

**First contact is "when the next change request arrives."** No registration ceremony, no
init, no full reverse-extraction (full extraction is unvalidated for accuracy and creates
dual-canonical drift from day one).

- The console's empty-project screen invites "create your first change request" (not "run
  an extraction").
- Reverse-extraction always covers **only the surfaces adjacent to the change** — no waste,
  no rot.
- Optional **B-lite**: teams that want a map can auto-collect only what machines can gather
  (route lists, screen snapshots) at registration. Semantics (FEAT/TC) fill in per change.
- If partial PRD/IA artifacts exist, normalize them in via `source-artifact-ingestor`.

## L1 mini-plan — auto-drafted + one user confirmation

The format stays **identical to the greenfield feature-plan** (console parsing, CR
targeting, impact analysis, and validators all work unmodified — proven). One change
produces:

- `_workspace/01_plan/feature-plan.md` — existing features as one-line "as-is" entries
  (adjacent surfaces only); new/changed features get FEAT + `TC-NNN-N: description` + an
  adjacent-interactions list. ~60 lines.

**The writing burden never falls on the human**: register the CR (title, request, reason,
expected behavior) → an agent auto-drafts the mini-plan from the CR and the code → **one
user confirmation** → the usual loop from impact analysis onward. TC IDs live in the file
because of three links: the Phase 4 test-authoring spawn verifies under the same TC IDs, the console's
Features tab accumulates traceability (the L3 convergence path), and later changes reference
them during impact analysis. This is where the harness differs from a ticket system.

## L1 runbook (proven by CHG-20260810-001)

1. **Receive the request in natural language** — empty projects can start from the console
   too (2026-08-11 bootstrap CR): "create your first change request" makes a targetless
   bootstrap CR (Target: PROJECT_BOOTSTRAP). Starting from a harness session in natural
   language works the same.
2. **Auto-draft the plan** — two routes. ① **Console route**: for a targetless CR, "plan
   recon" (read-only reverse-extraction) → "draft plan" (into an isolated candidate) →
   review/promote is the single confirmation. **Before approving, verify existing sections
   survived** — in a live pilot the executor rewrote the existing plan and destroyed
   approved TC definitions (a preservation clause was added to the instructions, but human
   review is the last line of defense). The console review screen currently lists changed
   files only, so open the candidate's plan file directly and check that existing FEAT/TC
   sections are intact (line-diff rendering is a known follow-up). ② **Harness-session
   route**: give the `feature-planner` agent the request plus the project root. Constraints
   you must state in the prompt (all pilot-measured):
   - TC lines exactly `- TC-NNN-N: Given..., When..., Then...` — **no backticks, no
     parentheses/labels between the ID and the colon** (the console parser cannot read
     them — labels go after the colon). Violations surface as *silently missing* TCs, so
     compare the console's parsed TC count after generation.
   - Existing features as one-line "as-is (reverse-extracted)" entries, adjacent surfaces
     only; add only what is new.
   - Reverse-extraction with code evidence (file paths). Never invent ambiguous decisions —
     mark `NEEDS_DECISION`.
   - An `## Adjacent interactions` section is mandatory. ~60 lines.
3. **One user confirmation** — present the draft summary plus NEEDS_DECISION items, record
   the decisions in a "confirmed decisions" section (append-only history).
4. **Register the console CR** — target the confirmed FEATs → impact analysis → isolated
   candidate (the executor may include real implementation — the pilot confirmed app-
   convention and design-system compliance) → diff verification → approve → promote to
   canonical.
5. **Live verification** — a running dev server (HMR) compiles immediately, so measure the
   TCs against the real app right after promotion (why previews are optional). TCs that
   cannot be measured get an honest annotation with the reason.
6. **Operational note**: a console CR's stored `status` stays `PROPOSED` until the review
   decision; the UI's IMPACT_REVIEW/READY_FOR_REVIEW are derived displays — monitor state
   via `codexRuns` run status/outcome.

## Known limits (measured, not hypothetical)

- Generalization is n=1: one app (Vite/React/MUI). SSR, strict-CSP environments, and Shadow
  DOM are unverified.
- Apps that redirect to an SSO server cannot render in the console's embedded preview
  (loopback-only `frame-src`) — use "open in new tab".
- Full reverse-extraction (option B) remains unvalidated.
