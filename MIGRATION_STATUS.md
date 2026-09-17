# v5.0 GitHub Migration Status

This file tracks the controlled import of the verified v5.0 Final Release into GitHub.

## Current branch policy

- `main`: keep stable until the complete v5.0 source tree is imported and verified.
- `develop`: verified migration baseline.
- `import-v5-*`: temporary staging branches for each import batch.
- Never commit `.env`, Discord bot tokens, dashboard passwords, private signing keys, `node_modules`, or runtime `data/*.json`.

## Verified on `develop`

Repository/release files:

- `.env.example`
- `.gitignore`
- `CHANGELOG.md`
- `README.md`
- `REVIEW_REPORT.md`
- `NEW_CHAT_HANDOFF.md`
- `package.json`
- `START.cmd`, `DEV.cmd`, `DEMO.cmd`, `SETTINGS.cmd`
- `data/.gitkeep`
- release/preflight/packaging scripts under `scripts/`

Imported runtime modules:

- `src/atomic-file.js`
- `src/broadcast-presets.js`
- `src/broadcast-settings.js`
- `src/broadcast-state.js`
- `src/broadcast.js`
- `src/config.js`
- `src/guide.js`
- `src/incident-workflow.js`
- `src/interactions.js`
- `src/json-store.js`
- `src/messages.js`
- `src/operations-guard.js`
- `src/operations.js`
- `src/profiles.js`
- `src/recovery-continuity.js`
- `src/recovery-drill.js`
- `src/recovery-store.js`
- `src/release-trust-root.js`
- `src/request-deduper.js`
- `src/runtime-health.js`
- `src/sse-hub.js`
- `src/store.js`
- `src/teams.js`
- `src/version.js`
- `src/viewer.js`

## Remaining runtime import

- `src/app.js`
- `src/discord-drift-fix.js`
- `src/discord-permission-audit.js`
- `src/discord-policy.js`
- `src/discord-service.js`
- `src/index.js`
- `src/performance-capacity.js`
- `src/production-readiness.js`
- `src/recovery-audit.js`
- `src/release-center.js`
- `src/restore-transaction.js`
- `src/supply-chain.js`

After the runtime layer, import and verify `package-lock.json`, `public/`, `test/`, and the five PNG design/game assets. Then compare the complete repository file manifest against the v5.0 Final Release before opening the final `develop -> main` PR.

## Verification rule

Every migrated source file must match the v5.0 Final Release byte-for-byte by Git blob SHA before `develop` advances. A failed or mismatched staging object must not be attached to a branch or commit.
