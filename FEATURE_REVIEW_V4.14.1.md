# Feature Review — v4.14.1 Participant Self-Service

## Scope

This is v4.14 Step 2. It extends the existing authenticated viewer dashboard so a linked Discord participant can manage only their own participation state without giving the viewer page administrative queue access.

## Participant flow

- Discord registration panel now labels the existing protected entry point as `시청자 대시보드`.
- The existing 10-minute, one-use login code is exchanged for the same HttpOnly/SameSite viewer session cookie.
- A linked viewer can see the current session, their own canonical Queue entry/status/position, call countdown, and their own next-round reservations.
- Supported actions: current-round join/cancel, next-round and two-round postponement, call join/pass, attendance confirmation, and reservation cancellation.
- Existing poll and race-color features remain in the same viewer dashboard.

## Privacy / security

- `buildParticipantSelfServiceState()` filters the canonical Queue to the logged-in Discord user only.
- Call response tokens remain in the server-side Queue entry and are never returned by the viewer self-service state.
- Viewer mutations retain the existing CSRF check, SameSite session cookie, JSON-only requests, cross-site rejection, and idempotency middleware.
- The viewer never receives Naver identity hashes, other Discord IDs, administrator credentials, bot tokens, CHZZK credentials, or queue call tokens.
- No new Discord Gateway Intent or Administrator permission is required.

## Consistency

Participant actions mutate the existing Operations state and then synchronize the existing canonical Participation Queue. A separate viewer-side participant database was intentionally not introduced.

A reliability issue was also corrected in `ParticipationCallService`: after `pass`, timeout, or manual terminal handling has already committed, failure to deliver the automatically advanced next participant call no longer turns the committed operation into an apparent request failure. The failure is reported/audited separately and the operator can recover by calling the next participant manually.

## Compatibility

- Data schema remains v2.
- Existing v4.14.0 Mobile Live Control remains unchanged.
- Existing v4.13 Discord/Naver/CHZZK/OBS/Broadcast Operations flows remain authoritative.
