# v4.13.4 Feature Review — OBS Broadcast Overlay

## Scope

This release completes **v4.13 Broadcast Operations Step 5** only. It adds a transparent OBS Browser Source overlay and does not implement Step 6 broadcast auto-detection.

## Added

- `/broadcast/overlay/` transparent Browser Source page.
- Live current/called participant card with response countdown.
- Next waiting participant and queue count.
- Draw winner display.
- Current team board.
- Session game / round / phase indicator.
- Compact live event feed from participation Queue history and session/draw/team milestones.
- `wide`, `compact`, `minimal` overlay layouts.
- Optional `hide=events,teams,winners` composition controls.
- Same-origin dashboard preview and quick-open links.
- Queue-store SSE subscription so Queue-only changes immediately reach broadcast clients.

## Privacy / security

The overlay reuses the existing broadcast read-only authorization model. Local loopback access remains available and remote access still requires `BROADCAST_TOKEN` or dashboard Basic Auth.

The overlay model does not expose:

- Discord user IDs
- Naver identity hashes
- participation call response tokens
- CSRF tokens
- full user/game profiles
- dashboard credentials
- `BROADCAST_TOKEN`

Rendered names and event messages use DOM `textContent`; no participant-provided text is injected as HTML.

## OBS URL examples

```text
http://127.0.0.1:3000/broadcast/overlay/?layout=wide
```

```text
https://your-domain.example/broadcast/overlay/?token=YOUR_BROADCAST_TOKEN&layout=wide
```

Recommended Browser Source size: **1920 × 1080, 30 FPS**.

## Compatibility

- No data schema change (`DATA_SCHEMA_VERSION=2`).
- No new Discord permission.
- No new Gateway Intent.
- No Naver API change.
- Existing `/broadcast/` full-scene director remains unchanged.
- Existing v4.13 Queue/call/team features feed the overlay without duplicating state.

## Validation focus

Regression coverage checks:

- current/next participant selection
- winner/team rendering model
- event feed derivation
- redaction of Discord/Naver identifiers
- transparent Browser Source styling
- SSE reconnect wiring
- participation Queue subscription
- dashboard preview/link wiring
