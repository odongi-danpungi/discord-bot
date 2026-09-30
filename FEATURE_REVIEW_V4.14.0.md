# Feature Review — v4.14.0 Mobile Live Control

## Scope
This is v4.14 Step 1 only. It introduces a mobile-first administrator control surface without adding a second state model or bypassing the existing operations APIs.

## Security
- `/mobile-control.html` is served after the existing dashboard Basic Auth middleware.
- Mutations require the server-issued CSRF token and a fresh `Idempotency-Key`.
- All state changes continue through the existing operations/queue services.
- No Discord token, NAVER secret, CHZZK secret, participant response nonce, or other secret is rendered into the page.

## Synchronization
The page performs an authenticated `/api/snapshot` bootstrap and then subscribes to `/api/events`. This means PC and phone views reflect the same authoritative server state.

## Mobile controls
- Next participant call
- Mark called participant joined
- Postpone called participant to next round
- No-show resolution
- Close/reopen recruitment
- Draw / attendance / replacement draw
- Team assignment / reshuffle
- Discord synchronization
- Round end

## Out of scope
Participant self-service, operator roles, backup UI, and broadcast shutdown automation remain later v4.14 steps.
