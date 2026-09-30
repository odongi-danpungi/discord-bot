# Feature Review — v4.16.5 Broadcast Performance Trends & Operational Insights

## Scope

Step 6 extends the read-only Broadcast Archive with cross-broadcast comparison and operational trend analysis. It does not add a new server mutation surface or collect participant-level analytics.

## Added

- `public/broadcast-performance-model-v416.js` pure analytics model.
- Range selection for latest 3, 5, 10, or all closed broadcasts.
- Aggregate metrics: broadcasts, sessions, applicants/session, winner attendance rate, winner no-show rate, winner selection rate, and Runbook minutes/session.
- Latest-vs-previous comparison for applicants/session, attendance, no-show rate, and operating pace.
- Time-ordered privacy-minimized trend rows.
- Up to four deterministic rule-based operational insights.
- Command Palette aliases for performance, trends, and insights.

## Safety / privacy

- Analytics consume only already-sanitized archive report aggregates.
- No participant names, Discord user IDs, queue/call tokens, Naver identity hashes, OAuth/Bot tokens, passwords, API keys, or raw error payloads are introduced.
- Insights explicitly avoid causal conclusions; low sample size is surfaced as insufficient comparison data.
- No new POST/PUT/PATCH/DELETE endpoint, Gateway Intent, Administrator permission, environment variable, or data-schema migration.

## Reliability

- Pure model is deterministic and separately testable without browser or Discord dependencies.
- Zero denominators resolve to 0 instead of NaN/Infinity.
- Range values are bounded to supported dashboard choices.
- Trend ordering is deterministic by `endedAt`.

## Testing

See `REVIEW_REPORT.md` for final counts and release verification.
