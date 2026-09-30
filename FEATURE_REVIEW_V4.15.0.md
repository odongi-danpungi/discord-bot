# Feature Review — v4.15.0 Dashboard UX Foundation Step 1

## Scope

Base: **v4.14.7 Mobile Operations Final**  
Target: **v4.15.0**  
Roadmap: **v4.15 Dashboard Final UX · Step 1**

## Changes

- Unified the PC administration shell into four navigation groups while retaining every existing `data-tab` destination.
- Added responsive drawer navigation for widths below 900px.
- Added URL hash deep-linking and safe fallback to `operate`.
- Added keyboard shortcuts Alt+1/2/3 for the three most common broadcast pages.
- Added dynamic sidebar version display sourced from the existing server version payload.
- Added header section context so the current area remains clear even when the sidebar is closed.

## Compatibility / security

- No API contract, database schema, credential handling, Discord permission, Gateway Intent, Naver/CHZZK integration, Queue semantics, or recovery behavior changed.
- Existing Basic Auth / CSRF / idempotency / delegated operator boundaries are unaffected.
- All existing dashboard page IDs and mutation handlers remain intact.
