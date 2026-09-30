# Feature Review — v4.15.2 Global Quick Actions Step 3

## Scope

Base: **v4.15.1 Dashboard Home Step 2**  
Target: **v4.15.2**  
Roadmap: **v4.15 Dashboard Final UX · Step 3 — Global Quick Actions / Command Palette & Search UX**

## Changes

- Added an administrator command palette available from the dashboard header and `Ctrl+K` / `⌘K`.
- Added search across every existing dashboard page with Korean/English aliases for Discord, Naver Cafe, CHZZK, OBS, Queue, recovery, deployment, release, and broadcast operations.
- Added keyboard navigation (Arrow Up/Down, Enter, Escape), current-page refresh, global Snapshot/Health refresh, and existing external broadcast-tool links.
- Added an isolated pure search/catalog module so command ranking and privacy boundaries are regression-testable without DOM dependencies.

## Safety / UX review

- The command palette intentionally does not expose draw, no-show, round-end, recovery-restore, emergency-lock, release-apply, Naver disconnect, or other state-mutating commands.
- Quick refresh commands reuse existing authenticated read paths and page-specific refresh functions.
- Existing Alt+0/1/2/3 shortcuts and hash deep links remain unchanged.
- Search metadata contains only static page/feature labels; participant data, Discord IDs, Naver identifiers, tokens, credentials, and CSRF values are never indexed into the palette.

## Compatibility

- No new API route, environment variable, persistent file, Discord permission, Gateway Intent, or data migration.
- Data schema remains v2.
