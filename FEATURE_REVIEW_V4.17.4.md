# Feature Review v4.17.4 — Production Acceptance & Cutover Verification

## Scope
v4.17 Step 5 adds a final, fail-closed Production acceptance layer after Step 4 connector/OAuth connectivity verification. It does not perform a deployment cutover or mutate Discord/Naver/CHZZK state; it verifies whether the current production instance is safe to hand over to live traffic.

## Added
- `src/production-acceptance.js` with privacy-minimized `daengdaeng-production-acceptance-v1` reports.
- Read-only `GET /api/production-acceptance` preview.
- Admin-only `POST /api/production-acceptance/verify` for a current read-only live verification pass under the existing CSRF, same-site, idempotency and audit protections.
- Deployment Dashboard **Production Acceptance & Cutover** card with explicit live verification and local JSON export of the displayed result.
- Acceptance regression coverage for live-verification requirement, fail-closed missing data, Release Center transitional states, draining state, optional connector warnings, dashboard wiring and privacy.

## Acceptance model
- Production Gate must be available and contain no blocking failures.
- Go-Live readiness must explicitly be launchable.
- A live verification run is required for a launchable acceptance result.
- Discord/Naver/CHZZK/Public HTTPS connectivity reuses Step 4 read-only probes; optional configured integrations can warn without changing the existing core-launch policy.
- Release Center must not be waiting for restart, rollback completion, transaction recovery, or a failed post-deploy Smoke Test.
- A draining server cannot be accepted for live traffic.
- Missing core readiness data or unavailable Release Center state fails closed rather than creating a false positive.

## Security / privacy
- No connector write API, Cafe post/comment, Discord mutation, CHZZK write/chat action, queue/session mutation, or release apply/rollback is invoked by acceptance verification.
- The report contains only bounded status/check text and counts. Bot Token, OAuth access/refresh tokens, Client Secrets, dashboard credentials, CSRF values, Naver profile identifiers, Discord member IDs, queue tokens, participant identities, and raw upstream payloads are never serialized.
- POST verification remains admin-only and can run during Emergency Lock solely for diagnostics; the acceptance result itself remains blocked while Go-Live reports the lock.
- No new environment variable, Discord Gateway Intent, Administrator permission, persistent data file, or data schema change.

## Compatibility
- Application version: 4.17.4
- Data schema: 2 (unchanged)
- Existing Discord + Naver Cafe + CHZZK, unified Queue, mobile operations, Recovery/Emergency Lock, Preflight, Runbook/Handoff/Automation/Closeout, Broadcast Archive, Performance Trends, Production Go-Live, Host Bootstrap, Secrets validation and Step 4 connector verification are preserved.
