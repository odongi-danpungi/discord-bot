# v4.15.4 Feature Review — Form Safety & Navigation Guard

## Scope
- Track unsaved dashboard form changes for broadcast settings, automation, notification routing, Discord policy monitor, release trust policy, Naver monitor settings, and Naver article drafts.
- Warn before leaving a dashboard section with unsaved changes and before browser/tab close or refresh.
- Add a visible unsaved-change badge in the dashboard header.
- Standardize high-risk confirmation copy for destructive actions such as broadcast preset deletion, round/recruitment ending, Naver disconnect, and Naver article publication.

## Safety
- No mutation API was added.
- Existing CSRF, persistent idempotency, concurrency guards, emergency lock, and approval flows remain authoritative.
- Form protection runs entirely client-side and never stores secrets or drafts outside the current browser page.
- No Discord permissions, intents, environment variables, or data schema changes.
