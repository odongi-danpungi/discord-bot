# Feature Review v4.17.1 — Production Host Bootstrap & Deployment Configuration

## Scope
v4.17 Step 2 turns the Step 1 readiness plan into an explicit production-host runtime contract without tying the bot to one provider.

## Added
- Read-only `GET /api/host-bootstrap` with binding, public HTTPS origin, reverse-proxy trust, health check, graceful shutdown and persistent-storage guidance.
- `PUBLIC_BASE_URL` and bounded `TRUST_PROXY_HOPS=0..5` configuration. Express trusts forwarded client information only when an exact hop count is explicitly configured.
- Provider-safe runtime detection for Railway/Render/Fly/Cloud Run plus generic/container operation; provider environment values are used only for non-secret status derivation.
- Production Dockerfile running as the unprivileged `node` user, `.dockerignore`, built-in `/healthz` healthcheck script, and provider-neutral deployment examples under `deploy/`.
- Deployment dashboard Host Bootstrap card. The existing Go-Live gate now treats an unready external host contract as a core blocker.

## Security / reliability
- No secret values are returned by the host bootstrap model.
- `.env`, runtime data, Git metadata and release archives are excluded from Docker build context.
- External production binding requires a resolvable HTTPS public origin; reverse-proxy trust defaults to disabled and cannot exceed five hops.
- Health contract remains 200 while ready and 503 while draining; existing SIGTERM/SIGINT graceful shutdown and persistent-store flush semantics are unchanged.
- No new Discord Gateway Intent, Administrator permission, mutation API, external credential, or data schema change.
