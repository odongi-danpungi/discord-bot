# Feature Review — v4.14.4 Mobile Broadcast Hub Step 5

Base: **v4.14.3 Concurrent Live Control Safety Step 4**  
Target: **v4.14.4**  
Scope: **v4.14 Step 5 — Mobile Broadcast Hub**

## Goal

Bring the established v4.13 Broadcast Operations Hub onto the phone-first control surface without creating a second source of truth. The mobile surface must preserve delegated capability boundaries, fail closed when real-time synchronization is unhealthy, and continue using the existing BroadcastOpsStore/API contracts.

## Implemented

- Added a `Live Control / Broadcast Hub` tab switch inside `/mobile-control.html`; no second administrator site or parallel state store is introduced.
- Added mobile broadcast summary metrics and the next scheduled broadcast.
- Added game-preset list/start/delete controls plus “save current session as preset”. Built-in presets remain undeletable.
- Added a schedule form with datetime-local input, optional preset mapping, note, and scheduled/completed/cancelled state controls.
- Added viewer-poll creation/close UI with live counts and percentage progress. The model accepts administrator `votes[]` and delegated-operator `voteCount` shapes without exposing voter hashes in operator mode.
- Added unified notification toggles for broadcast, schedule, participation, Naver, and system notices.
- Added CHZZK manual live-state recheck and the latest 12 merged broadcast timeline events.
- Added `mobile-broadcast-model.js` as a pure presentation/permission model for testable mobile behavior.
- Added the new model module to the delegated static allowlist while keeping the full dashboard (`/`, `index.html`, `app.js`) administrator-only.

## Permission / safety behavior

- A delegated operator needs `broadcast` to use Hub mutations.
- Recruitment preset start requires both `broadcast` and `live`, matching the existing server-side route.
- Preset start is disabled while an unfinished live session exists so the phone does not offer an action the authoritative Operations state will reject.
- BroadcastOps-only mutations still require Basic Auth, CSRF, persistent idempotency, server capability checks, and a healthy SSE connection.
- Schedule/poll/notification/preset-save/delete mutations intentionally omit live Operations/Queue revision headers because they do not mutate those stores; this avoids false `STALE_LIVE_STATE` failures caused by unrelated Queue/live changes.
- Preset **open** keeps the Step 4 live revision guard because it creates a new Operations session and synchronizes the Queue.
- High-impact actions retain explicit confirmations where destructive or replacement behavior is involved.

## Reliability / UX review

- Hub rendering is signature-gated so the 1-second Live Control timer does not continuously rebuild form fields and erase an operator's in-progress mobile input.
- Poll options are normalized from comma/newline input and duplicate labels are removed case-insensitively before submission.
- Dynamic poll progress uses the native `<progress>` element instead of inline style attributes, preserving the existing dashboard CSP (`style-src 'self'`).
- Schedule datetime values use local-time conversion instead of treating `datetime-local` input as UTC.
- All user-controlled preset, schedule, poll, and timeline strings are HTML-escaped before insertion into list markup.

## Compatibility

- Existing Discord + Naver Cafe + CHZZK integrations are unchanged.
- Canonical participation Queue, participant call/response/no-show, team assignment, OBS overlay, viewer self-service, delegated operator access, Step 4 concurrency guard, crash recovery, and Release Center behavior remain intact.
- No environment variable, database migration, or new persistent file is introduced.
- Data schema remains **v2**.
- No new Discord Gateway Intent or Administrator permission is required.
