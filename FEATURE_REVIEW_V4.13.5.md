# v4.13.5 Feature Review — CHZZK Broadcast Auto Detection

## Scope

Roadmap: **v4.13 Broadcast Operations Step 6**

This step adds official CHZZK live start/end detection and Discord broadcast notifications. It does not include Step 7 schedules, voting, statistics, or the final Step 8 integration pass.

## Official API basis

- Client authentication against `https://openapi.chzzk.naver.com`.
- `GET /open/v1/channels` validates the configured channel ID.
- `GET /open/v1/lives` returns the current live list, up to 20 entries per request, with `page.next` pagination.
- The documented Session event types are chat/donation/subscription, so this implementation does not invent a stream-start webhook. It polls the official live list at a bounded interval instead.

## Runtime behavior

1. The monitor is disabled unless `CHZZK_MONITOR_ENABLED=true`.
2. The first due/manual run validates the configured channel.
3. The first complete live-list scan creates a baseline only.
4. Later complete scans create `start` or `end` events only when the known state changes.
5. A scan-cap hit is recorded as unknown/warn and never converted to an offline transition.
6. Start/end events are persisted before notification delivery.
7. Discord notifications prefer `🟡・방송안내` and fall back to `📜・로그`.
8. A pending event after abnormal shutdown becomes `uncertain` on restart and is not automatically duplicated.

## Reliability and security

- Uses the existing durable JsonStore write/fsync/backup/corruption recovery layer.
- Bounded retry for transient 429/5xx/network/timeout failures.
- Client secret remains environment-only and is not included in status payloads or audit entries.
- Discord notification payload disables mention parsing.
- No new privileged Gateway Intent or Administrator permission.
- Scan state and live snapshots contain only public broadcast metadata returned by the official API.

## Dashboard

Live Control exposes live/offline/unknown/failure status, last check, current title/category/viewer count, and a manual status check. A detected live transition can automatically move the open dashboard to Live Mode.

## Compatibility

- Existing Discord/Naver/Queue/call/team/OBS features are unchanged.
- Data schema stays v2.
- New durable file: `CHZZK_LIVE_FILE` (default `./data/chzzk-live.json`).
