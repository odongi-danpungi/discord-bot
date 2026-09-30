# v4.16.0 Step 1 Feature Review — Go-Live Preflight

## Scope
v4.16 starts a broadcast-readiness line on top of the completed v4.15 dashboard UX. Step 1 adds a read-only **Go-Live Preflight** that summarizes whether the bot is in a safe state to begin or continue a broadcast participation session.

## Checks
The server-side preflight model evaluates existing authoritative state only:
- Emergency Operation Lock
- active/critical Incident Workflow state
- cached or freshly requested Discord diagnostics
- Runtime Health and recent persistence failure/recovery signals
- CHZZK official Open API monitor configuration/baseline/status
- Discord policy baseline drift acknowledgement/maintenance state
- active participation session readiness and eligible applicant count
- pending participant call
- Naver Cafe participation registration vs OAuth connection state
- next Broadcast Operations schedule

`fail` is reserved for conditions that should be resolved before normal broadcast mutations (for example Emergency Lock, CRITICAL incident, verified Discord disconnect, or recent storage failure). `warn` is advisory and does not block existing operation APIs.

## Dashboard
- Added `#preflight` to the PC administrator dashboard under Broadcast Operations.
- Added Home shortcuts and a compact preflight status indicator.
- Added a dedicated checklist page with pass/warn/fail counts and links to the existing page responsible for each issue.
- Added `방송 준비`, `사전 점검`, `go live`, and `preflight` aliases to the global Command Palette.
- Manual refresh is a GET-only operation; the page itself introduces no mutation.

## Privacy / security
The preflight output contains operational labels/counts and, when a participant call is active, the existing display name only. It does not expose Discord user IDs, call response tokens, Naver identity hashes, CSRF values, OAuth tokens, dashboard credentials, bot tokens, or release keys. Existing Basic Auth, CSRF, persistent idempotency, concurrency guard, Emergency Lock, and role boundaries are unchanged.

## Compatibility
- Data schema remains `v2`.
- No new persistent file.
- No new environment variable.
- No new Discord Gateway Intent or Administrator permission.
- Existing Discord + Naver Cafe + CHZZK behavior is unchanged.
