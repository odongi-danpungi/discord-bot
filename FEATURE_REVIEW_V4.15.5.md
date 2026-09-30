# v4.15.5 Step 6 Feature Review — Dashboard Accessibility / Keyboard / Focus UX

## Scope
This step changes only the PC dashboard presentation/interaction layer. No server API, data schema, Discord Gateway Intent, permission, Naver Cafe/CHZZK integration, credential, or persistent-storage format is changed.

## Added
- Skip-to-content link and explicit `main` landmark target.
- Keyboard-visible focus styling and reduced-motion fallback.
- Page-change live-region announcement plus focus transfer to the updated page heading.
- Command Palette focus containment and restoration to the invoking control.
- Mobile sidebar focus containment, initial focus on close, and restoration to the opener.
- Editable-control protection so Alt+0/1/2/3 cannot unexpectedly navigate while an operator is typing.
- Accessible search label and dialog description for the Command Palette.

## Safety review
The step introduces no new mutation path. Existing CSRF, idempotency, Emergency Lock, delegated roles, concurrency guards, and high-risk confirmations are unchanged. Focus management deliberately avoids forcing focus on initial page load and does not move focus into toast notifications.
