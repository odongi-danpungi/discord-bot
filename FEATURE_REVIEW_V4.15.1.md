# Feature Review — v4.15.1 Dashboard Home Step 2

## Scope

Base: **v4.15.0 Dashboard UX Foundation**  
Target: **v4.15.1**  
Roadmap: **v4.15 Dashboard Final UX · Step 2 — Dashboard Home / Broadcast Operations Summary**

## Changes

- Added `home` as the first/default administrator dashboard destination.
- Added consolidated CHZZK, round, applicants, Queue/call, next-schedule, poll, incident, connection, and Emergency Lock visibility.
- Added state-aware recommended navigation without introducing new mutation endpoints.
- Added a privacy-minimized Queue preview and merged recent operations/Broadcast Hub activity feed.
- Added Alt+0 for Home while retaining Alt+1/2/3.

## Bug / UX fixes

- Administrators no longer land directly in the dense Control Center when no explicit deep link is supplied.
- Emergency Lock and active incident state are visible before the operator navigates into a subsystem page.
- Unknown dashboard hashes now fall back to Home instead of a high-density mutation page.

## Compatibility / security

- Home is read-only: all actions are navigation or existing safe refresh calls.
- Queue response tokens, Discord IDs, Naver identity hashes, credentials, CSRF values, and release secrets are not placed in the Home presentation model.
- No API contract, Discord permission, Gateway Intent, environment variable, persistent file, or data migration changed. Data schema remains v2.
