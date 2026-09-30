# Feature Review v4.17.3

## Scope
Production Connector & OAuth Connectivity Verification.

## Added
- `src/connector-verification.js`
- `GET /api/connector-verification`
- Admin-only `POST /api/connector-verification/probe` for manual read-only live checks with dashboard CSRF/idempotency protection
- Deployment dashboard Connector & OAuth Verification panel
- Go-Live advisory integration
- Connector regression tests

## Connector checks
- Discord required configuration and runtime/API diagnostics
- Naver Client configuration, OAuth connection state, authenticated profile probe when connected
- Naver callback/public HTTPS origin consistency
- CHZZK Client/Channel configuration and channel lookup probe
- Public HTTPS `/healthz` probe

## Safety
- No secrets, OAuth tokens, profile identifiers, Discord IDs, or raw upstream payloads are returned by the report.
- Active probes are read-only, user initiated, admin-only, and use POST so the existing dashboard CSRF/idempotency protections apply.
- Optional Naver/CHZZK integrations remain non-blocking for core launch unless a configured OAuth callback is invalid; a configured CHZZK probe reports FAIL when the requested channel is not returned.
- No new Gateway Intent, Administrator permission, persistent data file, or data schema change.
