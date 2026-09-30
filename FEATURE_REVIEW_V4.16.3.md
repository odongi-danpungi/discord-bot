# v4.16.3 Step 4 Feature Review — Broadcast Closeout & Next-Show Handoff

## Scope

This step finalizes the v4.16 Runbook workflow after POST-LIVE. It does not add a new external connector or change Discord/Naver/CHZZK permissions.

## Implemented

- Server-authoritative Runbook closeout endpoint.
- Closeout requires no pending checklist items, POST-LIVE phase, no active participation session, and CHZZK not known LIVE.
- Atomic transition to `closed` plus bounded archive insertion in the existing `broadcast-ops.json`.
- Idempotent duplicate closeout handling with no duplicate archive entry.
- Closed Runbooks are immutable for checklist/handoff edits.
- Starting a new Runbook does not re-archive an already closed/archived Runbook.
- Next-broadcast handoff summary includes next owner, operator note, and nearest scheduled broadcast when present.
- Desktop and delegated mobile Runbook surfaces show closeout readiness and archived summary.
- Closeout creates a `runbook_closeout` timeline item and sends a best-effort Discord notice when broadcast notifications are enabled.

## Reliability review

The closeout commit updates the current Runbook, archive, and timeline atomically. Notification delivery happens afterward and cannot roll back or make the committed closeout appear failed. A repeated closeout request returns the existing closed result rather than duplicating archive data. Automatic phase synchronization skips closed Runbooks, including a race where closeout occurs between the phase preview and write transaction.

## Privacy / security

- Next-show notes pass through the existing credential redaction rules.
- Delegated operator output exposes only allowlisted closeout fields.
- No raw call token, Discord user ID, Naver identity hash, CSRF/OAuth token, bot token, dashboard password, or release key is introduced.
- No Administrator permission or new Gateway Intent is required.

## Compatibility

- Application version: 4.16.3
- Data schema version: 2 (unchanged)
- No new environment variable
- No new persistent file
- Existing Release Center update/rollback flow preserved
