# Feature Review — v4.14.5 Mobile Runtime Health & Incident Center Step 6

Base: **v4.14.4 Mobile Broadcast Hub Step 5**  
Target: **v4.14.5**  
Scope: **v4.14 Step 6 — Mobile Runtime Health & Incident Center**

## Goal

Expose the established Runtime Health and Incident Workflow on the phone-first control surface without weakening the Step 4 stale-state guard or giving delegated operators administrator-only recovery powers. The mobile surface should remain useful during a dashboard SSE incident, which is exactly when Live Control mutations are intentionally locked.

## Implemented

- Added a third `Health` tab to `/mobile-control.html`.
- Added mobile runtime summary metrics for overall state, uptime, API error rate, RSS memory, event-loop P95, SSE client count, and storage recovery/failure counts.
- Added privacy-minimized connector/service cards for Discord, Naver Cafe monitor, CHZZK live monitor, durable storage, and dashboard SSE.
- Added an active Incident Center with severity/status/occurrence/last-seen information plus a recent incident-workflow timeline.
- Administrator accounts can acknowledge/assign, resolve, and reopen incidents from mobile. Delegated operators receive the same operational visibility but remain read-only.
- Added safe diagnostic-summary clipboard export containing only the already-sanitized mobile health model.
- Added `GET /api/mobile-health`, an authenticated read endpoint that combines sanitized RuntimeHealth, IncidentWorkflow, Naver monitor, CHZZK monitor, storage, and SSE state without exposing secrets, policy contexts, voter identities, participant identifiers, or raw connector credentials.
- Added `mobile-health-model.js` as a pure presentation model for health cards, incident sorting, formatting, and shareable summary text.

## Reliability / safety behavior

- Live Control and Broadcast Hub mutations remain locked whenever SSE is offline/disconnected/stale.
- Incident acknowledgement/resolution/reopen intentionally uses a separate non-live mutation path. It still requires network connectivity, Basic Auth, CSRF, persistent idempotency, and administrator authorization, but does **not** require a healthy live-session SSE revision because IncidentWorkflow does not mutate Operations or the Participation Queue.
- This prevents a circular failure mode where an SSE outage would both create an incident and prevent the administrator from acknowledging that incident on mobile.
- Delegated operators can call only `GET /api/mobile-health`; existing `/api/incidents/:id/*` mutations remain unmapped to operator capabilities and therefore administrator-only.
- Operator mobile health payloads omit incident owner/note fields and all raw IncidentWorkflow context.
- Mobile health refresh is independent from SSE and automatically refreshes every 15 seconds while the Health tab is open.
- Incident actions use explicit prompts/confirmation and do not auto-retry mutations.

## Bug / consistency fixes found during review

- Fixed mobile mutation plumbing so non-live administrative workflows can opt out of SSE freshness checks without opting out of CSRF, idempotency, or online-state validation.
- Corrected Incident/Discord Policy workflow audit attribution to use the authenticated dashboard identity instead of always attributing actions to the configured default administrator username.
- Adjusted disabled Naver/CHZZK monitor presentation so an intentionally disabled connector reports an idle state rather than a misleading configuration warning.

## Compatibility

- Existing Discord + Naver Cafe + CHZZK integrations are preserved.
- Canonical participation Queue, call/response/no-show, team assignment, OBS overlay, viewer self-service, delegated operator access, concurrent-control safety, Mobile Broadcast Hub, crash recovery, and Release Center behavior remain intact.
- No new persistent file, database migration, environment variable, Discord Gateway Intent, or Administrator permission is introduced.
- Data schema remains **v2**.
