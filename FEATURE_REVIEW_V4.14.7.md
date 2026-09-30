# Feature Review — v4.14.7 Mobile Operations Final Step 8

Base: **v4.14.6 Mobile Recovery & Emergency Controls Step 7**  
Target: **v4.14.7**  
Scope: **v4.14 Step 8 — final integrated verification**

## Goal

Freeze the v4.14 mobile-operations feature set without adding new runtime behavior, then verify that the mobile administrator/operator/viewer paths still share the existing durable Discord + Naver Cafe + CHZZK operations state safely.

## Final integration coverage

- Delegated Mobile Live Control keeps least-privilege capabilities and privacy-minimized snapshots across Live Control, Broadcast Hub, Runtime Health, and Recovery presentation boundaries.
- Participant Self-Service responds to an active canonical Queue call without exposing the server-side call token, creates the expected next-round reservation, and keeps Queue status after restart.
- Emergency Operation Lock and participant-call pause state survive restart, and unlocking extends the active call deadline by the paused duration instead of creating an accidental no-show.
- Operators can see the fact/reason of an emergency lock in their live snapshot while checkpoint IDs, administrator identity, and Recovery authority remain hidden/admin-only.
- Existing v4.11-v4.13 reliability mechanisms remain part of the final regression set: serialized JsonStore writes, atomic rename + fsync, backup/temp salvage, corruption quarantine, persistent idempotency, crash recovery, canonical Queue consistency, Naver/CHZZK integrations, OBS overlay, Broadcast Operations, and Release Center rollback.

## Compatibility / security

- No new runtime API, persistent file, environment variable, data migration, Discord Gateway Intent, or Administrator permission is introduced in Step 8.
- Data schema remains **v2**.
- Dashboard administrator/operator credentials, Discord Bot Token, Naver credentials, CHZZK credentials, Broadcast token, participant call token, voter hashes, and release signing key are not embedded in public/mobile payloads.
- Production rollout still requires the dependency-backed final gate on Node.js >=22.22.2.
