# Feature Review — v4.14.6 Mobile Recovery & Emergency Controls Step 7

Base: **v4.14.5 Mobile Runtime Health & Incident Center Step 6**  
Target: **v4.14.6**  
Scope: **v4.14 Step 7 — Mobile Recovery & Emergency Controls**

## Goal

Make the phone-first control surface usable for real incident recovery without exposing Release Center or other workstation-only administration. Recovery actions must remain administrator-only, use the existing two-step approval system for destructive/state-changing recovery, and preserve participant call time while an emergency lock is active.

## Implemented

- Added a fourth `Recovery` tab to `/mobile-control.html`.
- Added administrator-only mobile self-check summary, verified restore-point list, recovery audit timeline, manual checkpoint creation, restore-point application, full-backup download, and sanitized runtime-diagnostics download.
- Added a persistent **Emergency Operation Lock** to the existing RecoveryStore. Activating the lock automatically creates a verified restore point first and records the authenticated administrator and reason.
- Emergency lock blocks dashboard/operator API writes except recovery/incident-safe paths, blocks viewer self-service writes, blocks state-changing Discord interactions, pauses the automatic operations tick, and pauses participant-call expiry/auto-advance.
- Participant-call pause/resume extends the active call deadline by the lock duration so emergency response time cannot turn into an accidental no-show.
- Unlock requires the same one-time, action-bound, two-step approval guard and resumes the call timer only after the administrator explicitly unlocks.
- Added `GET /api/mobile-recovery`, `POST /api/emergency/lock`, and `POST /api/emergency/unlock` as administrator-only endpoints.
- Added `mobile-recovery-model.js` and focused regression coverage.

## Safety and compatibility

- Emergency state is stored inside the existing recovery JSON file using a backward-compatible optional field; data schema remains v2 and no new persistent file is introduced.
- Monitoring/diagnostic reads and Incident Center actions stay available during emergency lock so the administrator can investigate the problem that caused the lock.
- Naver/CHZZK/Discord health monitoring remains active; automatic game/session mutations and participant call timers are paused.
- Restore-point application keeps the existing auto-before-restore checkpoint and two-step approval mechanism.
- Operators can load the shared mobile static assets but cannot call recovery/emergency APIs.
- No new Discord Gateway Intent, Administrator permission, environment variable, token, or credential is required.
