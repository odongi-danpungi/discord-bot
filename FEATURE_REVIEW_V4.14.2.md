# Feature Review — v4.14.2 Delegated Operator Access Step 3

Base: **v4.14.1 Participant Self-Service Step 2**  
Target: **v4.14.2**  
Scope: **v4.14 Step 3 — Operator Roles / Delegated Broadcast Controls**

## Goal

Allow a trusted broadcast helper to operate the phone-first Live Control without sharing the full administrator credential or gaining access to recovery, release, account-linking, Discord configuration, or other high-impact administration functions.

## Implemented

- Optional second Basic Auth identity: `operator`.
- Capability groups: `live`, `queue`, `broadcast`, `discord`.
- Operator access is restricted to Mobile Live Control static assets and an explicit API allow-list.
- Full administrator account retains all existing behavior.
- Operator snapshot/state responses are privacy-minimized and do not expose registration records, Discord IDs, Naver identity hashes, poll voter hashes, Naver cafe/menu/article identifiers, call-response tokens/message references, or winner/profile ID arrays.
- SSE snapshots are generated per authenticated identity; cache keys include role, username, and capabilities.
- Persistent idempotency scope is split by dashboard role and username.
- Delegated audit entries record the authenticated operator username and `dashboardRole`.
- Broadcast preset open requires both `broadcast` and `live` for an operator.
- Standalone all-member draw is administrator-only; delegated `live` can draw only the current participation session.
- Mobile action availability follows the authenticated capability set.

## Compatibility

- Existing Discord + Naver Cafe + CHZZK integrations are preserved.
- Canonical participation Queue, participant call/no-show flow, teams, OBS overlay, CHZZK monitor, Broadcast Operations Hub, viewer self-service, recovery, atomic JsonStore, and Release Center remain authoritative.
- No data-schema migration is needed; schema remains v2.
- No new Discord Gateway Intent or Administrator permission is introduced.
- Existing installations that do not set `DASHBOARD_OPERATOR_*` behave as before.

## Security review

- Administrator and operator usernames must differ.
- Administrator and operator passwords must differ, and the operator password must be at least 12 characters.
- Unknown capability names fail configuration validation.
- Operator requests outside the capability allow-list return 403.
- Operator cannot open the full desktop admin dashboard.
- High-impact recovery/release/Naver-account/Discord-setup APIs remain administrator-only.
- Runtime diagnostics do not serialize dashboard passwords; Windows launcher log redaction also includes the operator password.

## Deployment note

Use a unique operator password and grant only the capability groups the helper actually needs. Do not reuse the administrator password. After deployment, run the normal production verification gate on Node.js >=22.22.2 with dependencies installed.
