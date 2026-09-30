# Feature Review — v4.13.7 Broadcast Operations Final

## Final scope

v4.13.7 freezes the v4.13 Broadcast Operations feature set after the eight-step roadmap. It does not add another broadcast feature. The purpose of this patch is to verify that the subsystems introduced during v4.13 work together without weakening the v4.11/v4.12 reliability and security guarantees.

## Integrated feature set

- Live Control Dashboard
- canonical participation Queue shared by Discord / Naver / dashboard
- participant call / response / pass / no-show flow
- balanced/random/tier/position team strategies and reshuffle
- transparent OBS Browser Source overlay
- official CHZZK live start/end polling and Discord announcements
- Broadcast Operations Hub presets, schedules, viewer polls, statistics, notification settings, and timeline
- existing Naver OAuth/Cafe write/public-search monitor and Naver memo participation state
- crash-safe JSON persistence, idempotency, corruption recovery, graceful shutdown, Release Center Stage/Apply/Rollback

## Final cross-feature regressions added

1. Naver memo registrations and Discord registrations converge into the canonical participation Queue, preserve ordering, hide the call token from the public Queue summary, and survive a Queue-store restart.
2. Recruitment flows through open → join → close → draw → attendance confirmation → balanced team generation → archive while preserving unique complete teams and zero no-shows when everyone confirms.
3. A CHZZK offline → live transition becomes a durable start event, contributes to Broadcast Operations Hub statistics/timeline, and the active viewer poll survives the Broadcast Ops store restart.

## Compatibility

- Application version: 4.13.7
- Data schema: v2 unchanged
- No migration is required from v4.13.6.
- No new Discord Gateway Intent is required.
- Administrator permission is not required.
- No new environment variable is introduced by the finalization patch.

## Verification summary

- Static JavaScript check: **148/148 files PASS**.
- Final cross-feature regression: **3/3 PASS**.
- Core final verification: **265/265 PASS**.
- Full raw suite in this constrained container: **272 total / 265 PASS / 7 blocked by missing installed dependencies**.
- Release Stage/Apply/Rollback: **PASS**, target manifest **174/174**, rollback manifest **173/173**.

## Deployment gate

A production Final PASS requires:

```bash
node -v   # >= 22.22.2
npm ci
npm run verify:final
```

`npm run verify:final -- --core-only` is useful for constrained/offline verification, but intentionally excludes the external-dependency integration group.
