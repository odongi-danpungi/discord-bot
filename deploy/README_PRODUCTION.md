# Production Host Bootstrap

This release keeps the bot provider-neutral. The production runtime contract is:

- Node.js 22.22.2 or newer
- `npm ci` followed by `npm start`
- `APP_PROFILE=production`
- container/remote host bind: `HOST=0.0.0.0`
- health check: `GET /healthz` (200 ready, 503 while draining)
- SIGTERM/SIGINT graceful shutdown; allow at least 12 seconds before forced kill
- persistent volume for `./data` including `./data/backups`
- public access only through HTTPS; set `PUBLIC_BASE_URL=https://.../`
- when a trusted reverse proxy terminates HTTPS, set the exact `TRUST_PROXY_HOPS` value instead of trusting all proxies

`Dockerfile` provides the runtime image and built-in health check. `.dockerignore` excludes secrets, runtime data, Git metadata and archives.

Before production traffic:

1. Put all real credentials in the hosting provider Secret Manager. Do not commit `.env`.
2. Run `npm ci`.
3. Run `npm run env:check`; any blocking production environment error must be resolved before startup.
4. Run `npm run verify:final` and require `FINAL PASS`.
5. Create a deployment backup, complete a soak test, then verify Deployment > Host Bootstrap, Secrets & Environment, Go-Live, and Connector & OAuth cards.
6. Run Deployment > Production Acceptance & Cutover immediately before enabling live traffic; resolve every blocking item and treat the displayed live verification as valid for 15 minutes.
7. Enable traffic in the hosting provider / reverse proxy manually, then check the dashboard acknowledgement box and run Deployment > Production Cutover & Stabilization. Resolve every blocker and treat the post-cutover result as a 10-minute stabilization snapshot. The bot never switches DNS or provider routing itself.

The environment validator checks presence/placeholder/length policy, secret reuse, Discord IDs, external HTTPS exposure, Naver OAuth callback origin, and CHZZK/Naver conditional configuration. Its JSON/API/CLI output never contains credential values.
