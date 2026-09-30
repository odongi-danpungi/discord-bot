# v4.16.1 Step 2 Feature Review — Broadcast Runbook & Operator Handoff

## Scope

This step adds a persistent broadcast operations checklist and operator handoff workflow on top of the existing v4.16.0 Go-Live Preflight. It reuses the existing `BroadcastOpsStore`, dashboard authentication, delegated operator capabilities, CSRF, idempotency, SSE, recovery, and Emergency Lock architecture.

## Implemented

- 12 fixed Runbook items grouped into PRE-LIVE, ON-AIR, and POST-LIVE.
- Current owner, progress, item status, handoff notes/history, and archive count.
- PC admin Runbook page plus mobile Runbook tab for admins/operators with `broadcast` capability.
- GET `/api/broadcast-runbook` and POST endpoints for new Runbook, step changes, and handoff saves.
- Home/sidebar/Command Palette navigation and responsive desktop/mobile UI.
- Runbook handoff fields participate in the existing unsaved-form navigation guard.

## Security and privacy

- Handoff `from` is derived from authenticated dashboard identity, never accepted from the browser.
- Token/password/secret/API-key assignments and Authorization Bearer values are redacted before persistence.
- Operator responses are rebuilt through the existing sanitizer and omit unknown credential/identifier fields.
- Ordinary broadcast summaries expose only the current Runbook and `archiveCount`; archived Runbook bodies remain internal.
- No call response token, CSRF value, Discord raw user ID, Naver identity hash, OAuth/bot/dashboard secret, or release key is introduced into the Runbook UI model.
- Operator writes require the existing `broadcast` capability. No Discord Administrator permission or new Gateway Intent is required.

## Reliability review and fix

The first implementation persisted the Runbook mutation and then performed a second persistent write for the Timeline audit entry. If that second write failed after the first commit, the API could appear failed even though the Runbook action had already committed, encouraging a duplicate retry. The Step 2 review changed new Runbook operations so the Runbook state and its Timeline item are written in the **same atomic JsonStore update**.

Runbook metadata writes remain intentionally available during Emergency Operation Lock because they do not mutate Discord, Queue, participant calls, or broadcast session state. Existing live-control mutation protections remain unchanged.

## Persistence

- Reuses `data/broadcast-ops.json`.
- No new environment variable.
- No new persistent data file.
- Application data schema remains v2.
- Runbook archives are capped at 20 and handoff entries at 30.

## Compatibility

Existing Discord + Naver Cafe + CHZZK integrations, v4.14 mobile operations, v4.15 dashboard UX, Go-Live Preflight, canonical Queue, Recovery/Emergency Lock, Release Center, atomic file persistence, and persistent idempotency remain in place.
