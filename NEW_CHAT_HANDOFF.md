# Current handoff — v5.2.0 candidate

Baseline main is v5.1.7, commit 7898f1d98b2df3164a2427503ff373a213af4403. Preserve every existing Discord/Naver/CHZZK module. Data schema remains 2. New workspaces use separate files; legacy creator data stays in place.

The current user decision is each operator runs their own Discord server and their own broadcast channel. The older shared-broadcaster design remains only in legacy mode. Creator diagnostics/deployment/recovery are not user portal capabilities.

Read docs/workspace-accounts.md and docs/workspace-review-v520.md for scope, verification and blockers. MULTI_WORKSPACE_ENABLED is false by default. Real OAuth, cross-server broadcaster E2E and positive follower verification are still PENDING. The user has no separate participant test account; do not imply that verification passed.

User setup needed: register PUBLIC_BASE_URL origin + /portal/auth/callback in Discord OAuth2; store DISCORD_CLIENT_SECRET in Railway. Preserve all existing tokens, encryption keys and the /app/data volume. Keep one replica and back up the entire volume including workspaces/. Do not enable the portal before actual account tests.

Node requirement >=22.22.2. npm ci, npm run env:check and npm run verify:final are the production preparation commands. A local demo or mocked OAuth pass does not certify production credentials.
