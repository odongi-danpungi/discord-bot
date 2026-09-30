# Feature Review v4.17.2 — Production Secrets & Environment Validation

## Scope
v4.17 Step 3 adds a server-start gate and privacy-safe dashboard report for production environment variables and secrets. It validates deployment configuration before process-lock, storage initialization, Discord login, or external API activity.

## Added
- `src/production-environment.js` with a safe `daengdaeng-production-environment-v1` report.
- Startup validation immediately after `loadConfig()` and before process-lock / persistent-store initialization. Blocking production errors stop startup with check names only; no secret values are logged.
- Read-only `GET /api/environment-validation` and a Dashboard **SECRETS & ENVIRONMENT** card integrated into Production Gate and Go-Live readiness.
- `npm run env:check` for host-side validation before `npm start`.
- Production deployment examples now enumerate required secret names without embedding real credentials.

## Validation coverage
- Discord Bot Token presence/placeholder/basic minimum policy plus Application/Guild ID format.
- Dashboard admin/operator credential pairing, minimum password policy, default-admin advisory, and cross-secret reuse detection.
- External-host `BROADCAST_TOKEN` and HTTPS `PUBLIC_BASE_URL` requirements.
- HTTPS Viewer URL validation and cross-origin advisory.
- Naver Client credentials, OAuth callback path/origin, 32-byte token-encryption key, and Cafe/Menu target advisory.
- CHZZK Client credentials, 32-character channel ID, and monitor-enabled advisory.

## Security / reliability
- Reports contain only labels, status, safe explanatory text, and counts; Bot Token, Password, Client Secret, `NAVER_TOKEN_KEY`, `BROADCAST_TOKEN`, OAuth tokens, CSRF values, and participant identifiers are never serialized.
- Different credential classes may not reuse the same value in production.
- Optional Naver/CHZZK integrations remain advisory when completely absent; once configured, invalid credentials/configuration are treated as startup errors where appropriate.
- A configured Naver OAuth callback must use `/naver/callback`; when `PUBLIC_BASE_URL` is set, the callback must use the same origin.
- No new Discord Gateway Intent, Administrator permission, persistent data file, mutation API, or data-schema change.
