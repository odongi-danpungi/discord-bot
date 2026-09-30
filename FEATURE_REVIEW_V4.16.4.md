# Feature Review — v4.16.4 Broadcast Archive & Post-Show Report

## Scope
- Read-only archive reports for closed Runbooks.
- Aggregate session and CHZZK statistics correlated to each Runbook time window.
- PC dashboard search, summary copy, and local JSON export.

## Privacy and security
- Report payload contains aggregate counts and sanitized next-show metadata only.
- No participant display names, Discord IDs, call/response tokens, Naver identity hashes, CSRF values, OAuth/Bot tokens, passwords, release keys, or raw error strings are exported.
- Endpoint is GET-only and uses the existing `broadcast` dashboard capability.
- No new Discord intents, Administrator permission, environment variables, or schema migration.

## Reliability
- Current closed Runbook is de-duplicated against stored archive entries.
- Session and CHZZK event correlation is bounded to Runbook createdAt..closedAt.
- Browser export is generated from the already-sanitized report payload and does not call a mutation API.
