# Feature Review — v4.14.3 Concurrent Live Control Safety Step 4

Base: **v4.14.2 Delegated Operator Access Step 3**  
Target: **v4.14.3**  
Scope: **v4.14 Step 4 — Concurrent Control Guard / Mobile Connection Safety**

## Goal

Prevent an older PC/mobile/operator view from applying a live-broadcast mutation after another control surface has already changed the authoritative operations or participation Queue state. Also make the phone UI fail closed when real-time synchronization is unavailable.

## Implemented

- Mobile writes carry both the current Operations revision and canonical Participation Queue revision.
- The server accepts revision-aware writes only when both supplied revisions still match the authoritative stores.
- Stale writes fail with `409 STALE_LIVE_STATE` before the target operation executes; the client refreshes and requires a new user action instead of retrying automatically.
- Different revision-aware mutations are serialized through a lightweight mutation gate and freshness is checked after the request reaches the gate, preventing a time-of-check/time-of-use race between concurrent control surfaces.
- Existing persistent idempotency runs before the concurrency gate so a network retry of an already-completed request can still replay the saved result.
- Queue mutation responses include `controlRevisions` for both stores, so a successful call/status mutation immediately advances the mobile revision baseline before the next SSE snapshot arrives.
- Mobile write controls lock when the browser is offline, the SSE connection is down, or no snapshot/heartbeat has been observed for 35 seconds.
- The safety banner provides an explicit state refresh action. Visibility/online recovery refreshes the snapshot and reconnects SSE when required.
- High-impact touch actions now request confirmation for draw, replacement draw, reshuffle, round end, and no-show.

## Compatibility

- The revision guard is opt-in per request: existing clients that do not send the live revision headers continue to use the established API contract.
- Administrator and delegated operator capability checks are unchanged.
- Discord + Naver Cafe + CHZZK integrations, canonical Queue, participant call flow, team assignment, OBS overlay, Broadcast Operations Hub, viewer self-service, and Release Center remain intact.
- No new environment variable or persistent data file is introduced.
- Data schema remains **v2**.
- No new Discord Gateway Intent or Administrator permission is required.

## Reliability review

- Guard ordering intentionally preserves idempotency replay semantics.
- The mutation gate closes the race where two different control requests could otherwise both validate the same revision before the first request committed.
- Stale responses expose only numeric revisions; no participant identity or secret is added to the error payload.
- Mutation retries remain user-driven after a fresh snapshot; the client does not replay a possibly dangerous action automatically.
