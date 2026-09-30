# Feature Review v4.17.5 — Production Cutover Smoke & Stabilization Verification

## Scope
v4.17 Step 6 verifies the production instance immediately after an operator completes the real external traffic switch. It intentionally does not change DNS, reverse-proxy/provider routing, or any Discord/Naver/CHZZK state.

## Added
- `src/production-cutover.js` with privacy-minimized `daengdaeng-production-cutover-v1` reports.
- Read-only `GET /api/production-cutover` preview.
- Admin-only `POST /api/production-cutover/verify` requiring `trafficOpened=true`.
- Deployment Dashboard **Production Cutover & Stabilization** card with an explicit operator acknowledgement, post-cutover smoke verification, and local JSON export.
- Regression coverage for fresh Production Acceptance, Runtime Health, active Incident severity, Release transitions, current code Manifest, draining state, admin/acknowledgement enforcement, and privacy.

## Verification model
- A fresh Step 5 Production Acceptance run is performed inside the post-cutover verification request; a prior browser result is never treated as authorization.
- The operator must explicitly acknowledge that the real external host/proxy traffic switch is already complete.
- Runtime Health `fail`, active CRITICAL incidents, transitional/failed Release states, missing current code Manifest, or service draining are blockers.
- Non-critical active incidents remain warnings. `Release Center = idle` is advisory because a provider-native deployment may not have been applied through the in-app Release Center.
- The current project Manifest is recalculated read-only and reported as file count + SHA-256 digest.
- A successful result is an operational snapshot valid for 10 minutes, not a durable authorization token.

## Security / privacy
- No DNS/provider routing, Discord mutation, Naver Cafe post/comment, CHZZK write/chat, queue/session mutation, release apply/rollback, or Emergency Lock mutation is performed.
- POST verification remains admin-only and uses existing dashboard authentication, CSRF, same-site, JSON-body, persistent idempotency, and audit controls.
- The diagnostic endpoint may run during Emergency Lock, but its fresh Production Acceptance fails while the lock is active.
- Reports do not serialize Bot Token, OAuth access/refresh token, Client Secret, Dashboard password, CSRF values, participant identities, Naver profile identifiers, or raw upstream payloads.
- No new environment variable, Discord Gateway Intent, Administrator permission, data schema migration, or persistent data file is added.

## Compatibility
- Application version: 4.17.5
- Data schema: 2 (unchanged)
- Existing Discord + Naver Cafe + CHZZK, unified Queue, mobile operations, Recovery/Emergency Lock, Preflight, Runbook/Handoff/Automation/Closeout, Broadcast Archive, Performance Trends, Production Go-Live, Host Bootstrap, Secrets validation, connector verification, and Production Acceptance remain preserved.
