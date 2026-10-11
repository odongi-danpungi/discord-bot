# Current handoff — v5.2.2 candidate

Baseline main is v5.1.7, commit 7898f1d98b2df3164a2427503ff373a213af4403. Preserve every existing Discord/Naver/CHZZK module. Data schema remains 2. New workspaces use separate files; legacy creator data stays in place.

The current user decision is each operator runs their own Discord server and their own broadcast channel. The older shared-broadcaster design remains only in legacy mode. Creator diagnostics/deployment/recovery are not user portal capabilities.

Read docs/workspace-accounts.md and docs/workspace-review-v522.md for scope, verification and blockers. MULTI_WORKSPACE_ENABLED is false by default. Real OAuth, cross-server broadcaster E2E and positive follower verification are still PENDING. The user has no separate participant test account; do not imply that verification passed.

v5.2.2 adds native per-server fairness and call-time settings and a six-step local-only practice screen. Settings must preserve existing roles/channels, session policy and active call deadlines; stale writes are rejected. Call settings use a separate additive store, leaving the registry/schema compatible with code rollback. Practice never reads or writes live participant data and resets on page/server changes.

v5.2.1 adds operator-only /w/:guildId/readiness based on local saved configuration, onboarding and a PII-free text handoff. It must never infer production acceptance from token presence. The view performs no connector probes, refreshes, role changes, posting or state changes; Discord membership is still checked by platform authorization. The full project ZIP is authoritative for docs; v2 update JSON is unsigned and excludes docs per the release allowlist. Preserve the signature policy.

User setup needed: register PUBLIC_BASE_URL origin + /portal/auth/callback in Discord OAuth2; store DISCORD_CLIENT_SECRET in Railway. Preserve all existing tokens, encryption keys and the /app/data volume. Keep one replica and back up the entire volume including workspaces/. Do not enable the portal before actual account tests.

Node requirement >=22.22.2. npm ci, npm run env:check and npm run verify:final are the production preparation commands. A local demo or mocked OAuth pass does not certify production credentials.
