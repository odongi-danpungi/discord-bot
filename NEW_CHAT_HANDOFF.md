# NEW CHAT HANDOFF · Discord Game Roster Bot v5.0

## Current baseline

- Version: **5.0.0 · Final Release**
- Previous baseline: **4.16.0 · Full Integration / Stress / Security Test**
- Data schema: **v2**
- Backup container: **v3 + SHA-256 integrity**
- Restore transaction journal: **daengdaeng-restore-transaction-v1**
- Dashboard: grouped PC Final UX + Live Director + Recovery/Delivery/Discord centers
- Release bundle generation: **v2 strong-integrity** or **v3 Ed25519 signed**
- Primary deliverables: full v5.0 ZIP, v4.16→v5.0 Update JSON, final `REVIEW_REPORT.md`

## v5.0 finalization changes

1. Aligned package, lockfile and shared application version to 5.0.0.
2. Improved the Windows setup wizard so reconfiguration can retain existing secrets without displaying them.
3. Fixed the Windows launcher configuration forwarding list so Discord Policy, Incident Workflow, Restore Transaction and Recovery Continuity settings are no longer silently omitted from the spawned process environment.
4. Added explicit defaults for all modern persistence/recovery settings to new `config.local.json` files.
5. Added `npm run preflight` for runtime/version/supply-chain/deployment/config validation without modifying Discord.
6. Removed unused `public/avatar-legacy.js` after reference verification.
7. Removed creation of insecure legacy v1 update bundles from the release-bundle generator. New bundles are v2 strong-integrity or v3 Ed25519 signed. Release Center can still read legacy bundles for migration safety.
8. Rewrote README around the v5.0 operating model and moved detailed historical release notes to CHANGELOG.
9. Updated dashboard/game studio visible version labels to v5.0.
10. Added Final Release regression tests.

## Compatibility

- Existing v4.16 `data/` and `config.local.json` remain compatible.
- Data schema remains v2; no data migration is required for v4.16 → v5.0.
- Backup format remains v3; existing legacy v2 backups remain readable by the recovery layer.
- No new Discord permission or Privileged Gateway Intent was added.
- Existing stored legacy draw/race records remain viewable; v5.0 only removes dead code and new v1 update creation.

## Security baseline

- Never place Discord Bot Token, dashboard password, broadcast token or Ed25519 private key in ZIP/Git/logs.
- Dashboard POST paths retain CSRF/same-origin protections.
- Viewer sessions remain HttpOnly + SameSite=Strict.
- Release Apply/Rollback/Trust changes remain localhost-only + two-step approval.
- Update path traversal, protected path and symlink defenses remain active.
- Production release bundles should use a trusted Ed25519 v3 signature when the real private key is available.

## Project status

The planned v4.10 → v4.16 stabilization roadmap and v5.0 Final Release are complete. Future work should be treated as post-5.0 maintenance or a new roadmap, not as unfinished Final Release scope.
