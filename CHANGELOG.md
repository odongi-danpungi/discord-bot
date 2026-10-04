## v5.1.6 — 모든 Discord 서버의 공통 방송 채널 자동 연결

- 운영자 최초 CHZZK 동의의 사용자 조회 결과에서 공통 인증 대상 채널 ID·이름을 자동 저장합니다. 오래된 환경변수의 채널 ID 때문에 최초 연결을 거절하던 문제를 해결했습니다.
- 모든 서버의 팔로워 조회, 인증 상태, 재시작 복구와 패널 게시가 저장된 공통 방송 채널을 사용합니다. 역할은 기존처럼 서버별로 자동 준비합니다.
- 이미 연결된 채널을 다른 계정으로 자동 교체하지 않아 기존 인증 역할과 대상이 달라지는 것을 방지합니다. 운영자 인증·CSRF·참가자/서버 바인딩·토큰 암호화는 유지합니다.
- 인증 전용 배포는 CHZZK_CHANNEL_ID 없이 시작할 수 있으며, 방송 감지를 사용하는 경우에는 기존 대상 설정을 계속 요구합니다. 미연결 상태는 실제 검증 성공으로 표시하지 않습니다.
- 대시보드에 공통 대상 링크, 참여 서버 수와 실제 역할 준비 서버 수를 표시하고 잘못된 재연결을 안내합니다.
- v5.1.5 롤백 시 자동 저장된 채널 ID를 CHZZK_CHANNEL_ID에 맞춰야 인증을 계속 사용할 수 있습니다. 설정을 맞추기 전에는 인증을 비활성화하세요. 기존 데이터 스키마와 암호화 키는 유지합니다.

## v5.1.5 — 서버별 CHZZK 인증 자동 준비

- 서버 입장·재시작 시 권한 없는 인증 역할을 자동 생성하고 서버별로 저장·재사용합니다. 역할 ID 수동 입력은 선택 사항입니다.
- `/치지직인증` 전역 명령을 서버 설치 범위에 추가하고 OAuth 요청과 인증 결과를 서버별로 구분합니다.
- 기존 Queue/게임/네이버 기능의 기본 서버 경계와 기존 인증 패널을 유지합니다. 인증 대상 방송 채널은 모든 서버에서 공통입니다.
- 관리자 대시보드에 자동 준비 서버 수와 최소 권한 인증 봇 초대 링크를 추가했습니다.
- 역할 생성의 미확정 결과를 영속 저장해 비정상 종료 후 중복 생성을 차단하며, 권한 상승/이름만 같은 역할 재사용을 거부합니다.
- 롤백 시 v5.1.4는 역할 ID 필수이므로 기본 서버 자동 생성 역할 ID를 CHZZK_VERIFY_ROLE_ID에 지정하거나 인증 기능을 비활성화해야 합니다.

## v5.1.4 — CHZZK follower verification

- Discord 팔로워 인증 패널, 본인 전용 일회용 링크, CHZZK OAuth 로그인/동의 및 내 연동 상태 재확인.
- 방송 채널 소유자 별도 동의, 팔로워 조회의 상한·공유 캐시·429 대기, 미확정 상태의 역할 부여 차단.
- 계정 중복 차단, atomic 저장, 방송 OAuth 토큰 AES-GCM 암호화, 역할 권한/순서 확인, 닉네임 실패 구분.
- 관리자 Dashboard에 채널 연결·인증 패널 게시 페이지 추가. 기본 비활성, 실제 인증과 배포 검증은 별도 필요.
- 재인증과 토큰 갱신의 동시 저장 충돌, 닉네임 설정 변경 후 오래된 인증 상태, 재발급된 링크의 진행 중 Callback을 보완.
- 인증 패널 게시를 저장까지 직렬화하고 Discord 메시지 수정 직전에 운영 잠금을 재확인.
- CHZZK 인증 저장소 복구를 시작 감사·Dashboard·Runtime Health에 반영하고 전체 ZIP에 Railway 설정·CI·안내 문서를 포함.

## v5.1.3 — Participant operations and form login

- Add HTTPS form login with bounded HttpOnly sessions, login CSRF challenge, rate limiting, logout, expiry and credential-change invalidation; retain Basic auth compatibility.
- Add integrated Queue ready checks and private participant responses, preserving existing participant self-service.
- Add revision-checked, persistent, single-use undo for the last Queue reorder (5 minutes).
- Add isolated browser-only practice workflow and hierarchical navigation links.

## v5.1.2 — Reference dashboard layout

- Wide broadcast/bot connection bar, left bot summary and Queue, central operating notices, and right live activity feed.
- Preserve light styling, separate service navigation, mobile layout, real status data and all existing controls.

## v5.1.1 — Business dashboard workspaces

- Separate Naver account, search, monitoring, participation and publishing pages; independent Discord operations and unified broadcast/Queue navigation.
- Light administrative theme, preserving OBS output and existing controls.
- HTTPS exposure warning now uses Express trusted-proxy request security and administrator authentication instead of host binding alone.
- Preserve unsaved Naver draft guards on the new pages.

## 5.1.0 - Complete GitHub Integration

- Restore the complete v4.17.5 baseline and preserve v4.17.6 monitoring and v4.18.0 community/dashboard improvements; data schema remains v2.
- Preserve older skeleton documentation under docs/github-import-history and retain its compatible preflight script.
- Add Linux/Windows CI on Node 22.22.2 and 24 with pinned Actions, clean dependency installation and full regression verification.
- Add Railway volume entrypoint/configuration, production environment/E2E/rollback checklist, and executable LF shell files.
- Run Node directly as the container process for shutdown signal delivery; keep private key/environment files out of Git.
- Block overlapping personal menu panel requests until the saved message reference is available; add concurrency/error-release regression coverage.
- Normalize manifest directory inspection across POSIX and Windows so malformed source roots fail with the same sanitized validation error.

## 4.18.0 - Community Operations

- Add seven dashboard workflows for recruitment links, participant panels, announcements, fair selection, recap drafts, opt-in notification roles, FAQ and private inquiries.
- Reuse the existing authenticated queue, guide publishing, persistent store and admin security middleware.
- Persist per-target announcement delivery, block ambiguous retries, enforce topic cooldowns and reject unsafe notification roles.
- Reject stale recruitment links and derive Secure viewer cookies from the configured public HTTPS origin.
- Fix UI test module loading and startup test readiness race; add community service/API/DOM regressions.
- Preserve schema v2, existing connectors and production monitoring; add no dependency.

## 4.17.6 - Production Monitoring & Operational Readiness

- Added bounded, read-only connector monitoring with fail-closed current-state gate, recent probe history, expiry, shared cooldown and opt-in server scheduling.
- Added Deployment panel and sanitized deployment contract comparison command.
- Fixed incomplete Discord diagnostics, Naver probe token-refresh side effects, public health false positives, private-address probes and upstream error-code disclosure.
- Respect upstream 429 cooldowns; reject redirects carrying connector credentials.
- Fixed Windows backup/release fsync handle mode, viewer CSRF/idempotency ordering, and silent omission of unreadable files from code manifests.
- Preserve all previous features and data schema v2; add no Discord permissions or Gateway Intents.
- Harden Docker secret exclusions and include deployment files in the packaging script.
- Refresh integration fixtures to exercise real dashboard modules and distinguish Windows crash recovery from POSIX shutdown.

## 4.17.5 - Production Cutover Smoke & Stabilization Verification
- Added explicit post-cutover verification after the Step 5 Production Acceptance gate.
- Added read-only `GET /api/production-cutover` preview plus admin-only CSRF/idempotency-protected `POST /api/production-cutover/verify`.
- Requires explicit `trafficOpened=true` operator acknowledgement; the bot does not mutate DNS, reverse-proxy, provider routing, Discord, Naver Cafe, CHZZK, queue/session, or release state.
- Re-runs current Production Acceptance live probes in the same request instead of trusting a stale acceptance result.
- Adds fail-closed checks for Runtime Health failure, active CRITICAL incidents, Release restart/rollback/recovery/failure states, current code Manifest availability, and graceful-drain state.
- Adds the Deployment dashboard **Production Cutover & Stabilization** panel with explicit traffic-switch acknowledgement and local JSON export.
- Preserved data schema v2, existing environment variables, Discord permissions/Intents, all Discord + Naver Cafe + CHZZK functionality, Queue, mobile control, Recovery/Emergency Lock, Preflight, Runbook/Handoff/Automation/Closeout, Archive/Performance, Host Bootstrap, Secrets validation, connector verification, and Production Acceptance behavior.

## 4.17.4 - Production Acceptance & Cutover Verification
- Added fail-closed final Production acceptance over Deployment Gate, Go-Live readiness, live connector verification, Release Center transition state, and graceful-drain state.
- Added read-only `GET /api/production-acceptance` preview plus admin-only CSRF/idempotency-protected `POST /api/production-acceptance/verify` for current read-only live verification.
- Added Deployment Dashboard **Production Acceptance & Cutover** panel with displayed-result JSON export and a 15-minute verification validity window.
- Reused only Step 4 read-only probes; no Discord mutation, Naver Cafe write/comment, CHZZK write/chat, queue/session mutation, release apply, or rollback is performed.
- Fails closed when core readiness or Release Center state is unavailable; restart/rollback/recovery/Smoke failure states block cutover while optional connector failures preserve the existing advisory policy.
- Preserved data schema v2, existing environment variables, Discord permissions/Intents, all Discord + Naver Cafe + CHZZK functionality, Queue, mobile control, Recovery/Emergency Lock, Runbook, Archive/Performance, Host Bootstrap, Secrets validation, and connector verification behavior.

## 4.17.3 - Production Connector & OAuth Connectivity Verification
- Added read-only production connector verification for Discord, Naver OAuth/API, CHZZK API, and public HTTPS health.
- Added admin-only active probe flow via CSRF/idempotency-protected POST and kept GET status strictly read-only.
- Hardened unknown Discord runtime handling, CHZZK target-channel matching, OAuth/public-origin validation, and credential/privacy boundaries.

## 4.17.2
- Added **Production Secrets & Environment Validation** with a startup gate before process-lock, storage initialization, Discord login, or external connector activity.
- Added privacy-safe read-only `GET /api/environment-validation`, Deployment Dashboard **SECRETS & ENVIRONMENT** card, and integration into Production Gate / Go-Live readiness.
- Added `npm run env:check` for host-side pre-start validation.
- Validates Discord credentials/IDs, Dashboard/operator credential policy, external `BROADCAST_TOKEN`, HTTPS public/viewer URLs, Naver OAuth callback/token encryption setup, CHZZK credentials/channel ID, and cross-secret reuse.
- Optional Naver/CHZZK integrations remain non-blocking when completely absent; malformed configured integrations are surfaced before production startup.
- Validation output never serializes Bot/OAuth credentials, Dashboard passwords, `NAVER_TOKEN_KEY`, `BROADCAST_TOKEN`, CSRF values, or participant identifiers.
- Preserved data schema v2, existing Discord permissions/Intents, Naver Cafe + CHZZK behavior, Queue/Runbook/Recovery/Release Center semantics, and v4.17 host bootstrap behavior.

## 4.17.1
- Added **Production Host Bootstrap & Deployment Configuration** with a read-only runtime contract for host binding, public HTTPS, reverse-proxy trust, health checks, graceful shutdown, and persistent storage.
- Added `PUBLIC_BASE_URL` and bounded `TRUST_PROXY_HOPS` configuration; forwarded client information is trusted only when an exact proxy hop count is explicitly configured.
- Added provider-neutral host detection plus a non-root production Dockerfile, `.dockerignore`, local healthcheck script, and production deployment examples.
- Added a Dashboard **HOST BOOTSTRAP** card and integrated failed external-host bootstrap into the existing Go-Live core blockers.
- Kept `/healthz` at 200 ready / 503 draining and preserved SIGTERM/SIGINT shutdown, atomic persistence, Discord/Naver/CHZZK behavior, existing permissions/Intents, and data schema v2.
- Host bootstrap output contains no dashboard password, Bot/OAuth secrets, participant identifiers, CSRF values, or raw environment secrets.

## 4.17.0
- Started **v4.17 Production Go-Live** with a privacy-safe, read-only Go-Live readiness action plan layered on top of the existing deployment gate.
- Added `GET /api/go-live-readiness` and downloadable JSON reporting for production profile, Discord readiness, backup/Soak state, unresolved incidents, Emergency Lock, network exposure, delegated operator setup, Naver Cafe integration, memo-board targeting, and CHZZK monitoring.
- Added a PC Dashboard **GO-LIVE ACTION PLAN** panel that separates blocking tasks from recommended setup work and links each item to the existing management surface.
- Kept Naver/CHZZK/viewer/operator integrations advisory rather than silently disabling the bot; production profile and Emergency Lock remain hard blockers.
- Hardened privacy so the readiness response exposes only booleans/status text and never credential values, Discord user IDs, OAuth tokens, dashboard passwords, CSRF values, or participant identity data.
- Hardened dashboard reliability with independent Deployment/Go-Live reads so a failure in one readiness endpoint does not hide the other result.
- Preserved data schema v2, existing Discord Gateway Intents/permissions, Naver Cafe + CHZZK behavior, Queue/Runbook/Recovery/Release Center semantics, and all v4.16 broadcast operations.

## 4.16.6
- Finalized **v4.16 Broadcast Operations** after Steps 1-6; Step 7 adds no new integration or mutation scope.
- Added end-to-end regression covering Runbook PRE-LIVE → ON-AIR → POST-LIVE automation, Closeout, Archive reporting, and Performance analytics in one dependency-independent lifecycle test.
- Fixed PC sidebar navigation so entering the Runbook page immediately refreshes the dedicated Runbook endpoint instead of waiting for the periodic refresh/SSE path.
- Hardened new-Runbook replacement UX: replacing any active Runbook now uses the shared high-risk confirmation flow, while an already closed Runbook can start the next Runbook without a redundant archive warning.
- Re-verified that Broadcast Archive/Performance remain read-only, Runbook mutations stay scoped to the existing `broadcast` capability, and Discord + CHZZK + Naver Cafe integrations remain present without Administrator permission.
- Preserved data schema v2, existing Gateway Intents/permissions, canonical Queue, Emergency Lock, recovery, idempotency/concurrency protections, and Release Center behavior.
- Production final verification still requires Node.js >=22.22.2, `npm ci`, and a normal `npm run verify:final` reporting `FINAL PASS`.

## 4.16.5
- 방송 아카이브에 최근 3/5/10회 또는 전체 범위 성과 비교 추가
- 회차당 신청, 당첨자 참석률, 당첨자 노쇼율, 회차당 Runbook 시간 집계 추가
- 최신 방송과 직전 방송의 주요 운영 지표 차이 비교 추가
- 방송별 추세를 개인정보 없는 집계값으로 시각화
- 노쇼·참석률·회차당 신청·운영 시간·Runbook 건너뜀을 기준으로 규칙 기반 운영 인사이트 제공
- 인사이트에 원인 단정 금지 문구와 데이터 부족 상태 추가
- 성과 분석은 기존 읽기 전용 방송 아카이브 응답만 사용하며 새 mutation API/권한/Intent/환경 변수 없음
- Command Palette에서 성과 비교·통계 추세·운영 인사이트 검색 지원
- 프로젝트 버전 4.16.5로 정합성 업데이트

## 4.16.4
- Added **Broadcast Archive & Post-Show Report** for closed Runbooks with privacy-minimized aggregate participation and CHZZK statistics.
- Added read-only `GET /api/broadcast-archive`, scoped to the existing `broadcast` dashboard capability and containing no participant names, Discord IDs, call tokens, OAuth tokens, or raw credential fields.
- Added PC dashboard archive search, broadcast/session summary cards, copyable text summaries, and per-report JSON export generated locally in the browser.
- Reports correlate archived sessions and CHZZK start/end events only inside each Runbook's created-to-closed window, and de-duplicate the currently closed Runbook against the archive.
- Added safe report filename normalization and client-side response normalization; no new mutation endpoint, Gateway Intent, Administrator permission, environment variable, or data-schema version was introduced.

## 4.16.3
- Added **Broadcast Closeout & Next-Show Handoff** so a completed POST-LIVE Runbook can be finalized into an immutable archived record.
- Closeout is server-gated: all checklist items must be handled, the Runbook must be POST-LIVE, no participation session may still be active, and CHZZK must not be known LIVE.
- Finalization stores the closed Runbook and archive copy in one atomic broadcast-operations commit, and duplicate closeout retries do not create duplicate archive entries.
- Closed Runbooks reject checklist and handoff edits; starting the next Runbook does not archive an already archived closed Runbook again.
- Added a generated next-broadcast summary using the latest handoff, next scheduled broadcast, next owner, and credential-redacted operator note.
- Added desktop/mobile closeout controls and read-only closeout summary views, plus a `runbook_closeout` timeline event and best-effort Discord completion notice.
- Preserved data schema v2, existing Discord permissions/Intents, Naver Cafe + CHZZK integrations, Emergency Lock, CSRF/idempotency, and Release Center behavior.

## 4.16.2
- Added **Runbook Automation & Handoff Alerts** with server-authoritative automatic PRE-LIVE / ON-AIR / POST-LIVE phase tracking based on active participation sessions and CHZZK live transitions.
- Added durable runbook phase history and atomic `runbook_phase` timeline entries; unchanged phase checks no longer rewrite `broadcast-ops.json` on every scheduler tick.
- Added Discord handoff notifications for named operator transfers, with delivery status recorded separately so a failed notification never turns an already-committed handoff into an API failure.
- Added a Runbook activity timeline and automatic-phase reason/source visibility to both the PC dashboard and delegated mobile operator surface.
- Hardened privacy by redacting credential-like alert errors before persistence and omitting raw alert error text from delegated operator payloads.
- Emergency Operation Lock continues to allow Runbook metadata automation while live/queue mutations remain blocked; no new Gateway Intent, Administrator permission, environment variable, or data-schema version was introduced.

## 4.16.1
- Added **Broadcast Runbook & Operator Handoff** across the PC admin dashboard and delegated mobile operator control.
- Added a 12-step PRE-LIVE / ON-AIR / POST-LIVE checklist with progress, current owner, safe handoff notes, handoff history, and current-runbook archiving inside the existing `broadcast-ops.json` store.
- Added authenticated `/api/broadcast-runbook` read/mutation endpoints scoped to the existing `broadcast` capability; runbook metadata remains available during Emergency Operation Lock without bypassing live/queue mutation protections.
- Hardened handoff privacy by deriving the sender from the authenticated dashboard identity, redacting credential-like assignments before persistence, sanitizing operator payloads, and keeping archived runbooks out of ordinary dashboard snapshots.
- Hardened reliability by committing each new runbook mutation and its timeline audit entry in the same atomic JSON-store update, so a second timeline write cannot make an already-committed action appear failed.
- Preserved data schema v2, existing Discord Gateway Intents/permissions, Naver Cafe + CHZZK behavior, Queue semantics, Emergency Lock, CSRF, persistent idempotency, and Release Center behavior.

## 4.16.0
- Started **v4.16 Broadcast Readiness** with a server-authoritative, read-only Go-Live Preflight.
- Added a dedicated `#preflight` dashboard page and Home shortcut summarizing Emergency Lock, Incident Workflow, Discord diagnostics, Runtime Health, recent persistence signals, CHZZK monitor state, Discord policy drift, participation-session readiness, pending participant calls, Naver Cafe participation state, and the next broadcast schedule.
- Added pass/warn/fail counts plus a safe recommendation that only navigates to existing management pages; the preflight page itself performs no mutation and its refresh path is GET-only.
- Hardened privacy so preflight output never contains Discord user IDs, participant call tokens, Naver identity hashes, CSRF values, OAuth/bot/dashboard secrets, or release credentials.
- Preserved data schema v2, existing Discord Gateway Intents/permissions, Naver Cafe + CHZZK behavior, Queue semantics, Emergency Lock, idempotency/concurrency protections, and Release Center behavior.

## 4.15.7
- Finalized **v4.15 Dashboard UX** after Steps 1-7; Step 8 adds no new runtime mutation or integration scope.
- Added cross-feature final regressions covering Home/shell/palette navigation consistency, Emergency/CRITICAL recommendation priority, feedback redaction, editable-field shortcut safety, responsive content states, and destructive-command exclusion.
- Re-verified that presentation/search/feedback models do not expose call tokens, raw Discord identifiers, Naver identity hashes, CSRF values, passwords, secrets, or release/admin credentials.
- Preserved data schema v2, Discord Gateway Intents/permissions, Naver Cafe/CHZZK behavior, canonical Queue, recovery/emergency controls, idempotency/concurrency protections, and Release Center behavior.
- Production final verification still requires Node.js >=22.22.2, `npm ci`, and a normal `npm run verify:final` reporting `FINAL PASS`.

## 4.15.6
- Finalized responsive PC-dashboard readability for small screens: the member data table becomes labeled cards below 860px while preserving all displayed fields.
- Added a unified loading/error content-state surface, `aria-busy` snapshot feedback, and a manual retry path that only re-runs the existing read-only snapshot request.
- Hardened metrics, panels, forms, list rows, incident/action rows, long-value wrapping, and coarse-pointer tap targets for tablet/mobile widths.
- Improved empty-state presentation and added a screen-reader caption plus keyboard focus target for the member table.
- No API, data-schema, Discord permission/Intent, Naver/CHZZK integration, environment-variable, or persistent-storage change.

## 4.15.5
- Added keyboard/focus accessibility hardening to the PC dashboard: skip-to-content, visible focus rings, page-change announcements, focus restoration, and focus containment for the command palette and mobile sidebar drawer.
- Global Alt+0/1/2/3 navigation no longer fires while typing in input, textarea, select, or contenteditable controls.
- Added accessible names/descriptions for command-palette search and shortcut hints, plus reduced-motion behavior across the dashboard UX layer.
- No API, data-schema, Discord permission/Intent, Naver/CHZZK integration, environment-variable, or persistent-storage changes.

## 4.15.4
- Added dashboard form dirty-state tracking, unsaved navigation guards, beforeunload protection, and consistent high-risk action confirmation UX.
- Added Naver monitor/article draft protection and a header unsaved-change indicator.
- No API, schema, intent, permission, or environment-variable changes.

# Changelog

## 4.15.3

- Added a unified PC-dashboard **toast feedback stack** for success, informational, warning, and error messages while preserving the existing operation APIs and server-authoritative state.
- Added compact global mutation progress in the header so operators can see when an authenticated POST is in flight; background runtime client-metric telemetry is intentionally excluded.
- Added repeated-message coalescing, maximum visible-toast limits, manual dismissal, auto-dismiss timing, responsive small-screen placement, and reduced-motion support.
- Hardened user-visible feedback rendering by using DOM text nodes instead of HTML interpolation and redacting common credential-like `Authorization`, token, password, secret, CSRF, API-key, and client-secret values.
- Converted persistent Health warnings to one sticky warning feedback item that is removed when the warning clears, preventing the 30-second health poll from creating repeated notification noise.
- Corrected the stale README product title so the documented project release matches the v4.15 dashboard line.
- No data-schema, API-contract, Discord Gateway Intent, Administrator permission, environment-variable, persistent-storage, Naver Cafe, CHZZK, Queue, recovery, or release-flow change was introduced.

## 4.15.2

- Added a global **Quick Actions / Command Palette** to the PC administrator dashboard, opened from the header or with `Ctrl+K` / `⌘K`.
- Added keyboard-first search across all administrator pages using Korean and English operational aliases such as 시참, Queue, Naver, CHZZK, Discord, 복구, OBS, 릴리스, and 배포.
- Added Arrow Up/Down selection, Enter execution, Escape close, accessible listbox/dialog semantics, and responsive small-screen presentation.
- Added safe quick actions for refreshing the current page or the main Snapshot/Health state. The palette intentionally contains no destructive or state-mutating broadcast command.
- Added direct shortcuts to Mobile Live Control, Game Studio, and the OBS/Broadcast screen without changing their existing authentication or token handling.
- Existing deep links, Alt+0/1/2/3 navigation, Discord + Naver Cafe + CHZZK integrations, Emergency Lock, delegated access, API contracts, Gateway Intents, and data schema v2 remain unchanged.

## 4.15.1

- Added a dedicated **Dashboard Home** as the default PC administrator landing page, summarizing CHZZK live state, the current participation round, eligible applicants, canonical Queue/call state, the next broadcast schedule, and operational alerts.
- Added a safe recommendation card that routes administrators to Live Mode, Control Center, Incident Center, or Recovery depending on the current authoritative state; the Home page itself introduces no new state-changing API.
- Added compact connection/health visibility for Discord, dashboard SSE, Runtime Health, active incidents, Discord Policy drift, and Emergency Operation Lock.
- Added next-schedule and active viewer-poll summaries plus a merged recent activity feed from operations history and Broadcast Operations timeline.
- Added Queue preview and current participant call countdown without exposing Discord IDs, response tokens, Naver identity hashes, CSRF values, or credentials.
- Added Alt+0 and `#home` navigation while preserving Alt+1/2/3 and all existing deep links; unknown/empty dashboard hashes now safely land on Home.
- Preserved all existing Discord + Naver Cafe + CHZZK integrations, Queue semantics, recovery/emergency controls, API contracts, permissions, Gateway Intents, and data schema v2.

## 4.15.0

- Started **v4.15 Dashboard Final UX** with a unified responsive administration shell while preserving all Discord + Naver Cafe + CHZZK runtime behavior.
- Grouped the large left navigation into Broadcast Operations, Participants, System Status, and Deployment/Security sections without changing existing page IDs or API routes.
- Added a mobile/tablet navigation drawer with focus-visible controls, overlay dismissal, Escape close, and no dependency on JavaScript frameworks.
- Added stable deep links for dashboard tabs (`#live`, `#operate`, `#runtime`, etc.) and restores a valid hash on page load; invalid hashes safely fall back to the control center.
- Added Alt+1 / Alt+2 / Alt+3 keyboard shortcuts for Live Mode, Control Center, and Broadcast Scene Settings.
- Replaced the stale hard-coded sidebar version label with the server-reported runtime version and added a section context label in the header.
- Data schema remains v2. No new Discord Gateway Intent, Administrator permission, credential, persistent file, or API mutation was introduced.


## 4.14.7

- Finalized **v4.14 Mobile Operations** after Steps 1-7; Step 8 adds no new runtime feature scope.
- Added cross-feature final integration regressions for delegated mobile least-privilege/privacy, participant self-service + canonical Queue/call persistence, emergency-lock restart continuity with participant-call deadline preservation, and shared mobile Broadcast/Health/Recovery presentation boundaries.
- Re-ran the v4.14 core regression suite together with v4.11-v4.13 durability, crash recovery, persistent idempotency, corruption recovery, canonical Queue, Naver Cafe, CHZZK, OBS overlay, Broadcast Operations, Release Center, viewer self-service, delegated operator access, concurrent-control safety, Runtime Health/Incident Center, and Emergency Recovery coverage.
- Data schema remains v2. Existing Discord permissions, Gateway Intents, Naver/CHZZK credentials, dashboard secrets, and persistent storage formats remain unchanged.
- Production final deployment verification still requires Node.js >=22.22.2, `npm ci`, and a normal `npm run verify:final` reporting `FINAL PASS`; `--core-only` remains a dependency-independent gate only.

## 4.14.6

- Added a fourth **Recovery** tab to the mobile control surface with administrator-only self-check, verified restore points, recovery audit, manual checkpoint creation, restore-point application, backup export, and diagnostics export.
- Added persistent **Emergency Operation Lock** state to the existing RecoveryStore. Lock activation creates an automatic restore point before locking writes.
- Emergency lock blocks dashboard/operator mutations, viewer self-service writes, and state-changing Discord interactions while leaving health/incident investigation available.
- Automatic operations ticks pause during an emergency lock, preventing auto-close, scene expiry, and due-schedule mutation while recovery is in progress.
- Participant-call timers now support pause/resume; an active call deadline is extended by the lock duration so incident-response time cannot cause an accidental no-show or auto-advance.
- Emergency lock/unlock use the existing Basic Auth, CSRF, persistent idempotency, administrator authorization, and one-time action-bound two-step approval guard.
- Added `GET /api/mobile-recovery`, `POST /api/emergency/lock`, `POST /api/emergency/unlock`, and a pure `mobile-recovery-model.js` presentation module.
- Existing Discord + Naver Cafe + CHZZK integrations, canonical Queue, viewer self-service, OBS overlay, Broadcast Hub, delegated operator controls, Runtime Health/Incident Center, crash recovery, atomic persistence, and data schema v2 remain intact.

## 4.14.5

- Added a third **Health** tab to `/mobile-control.html` with phone-first Runtime Health and Incident Center views.
- Added mobile health metrics for uptime, API error rate, memory, event-loop P95, SSE connections, storage recovery/failure state, and overall runtime status.
- Added privacy-minimized Discord, Naver Cafe monitor, CHZZK live monitor, storage, and SSE service cards.
- Added an active incident queue and recent incident timeline. Administrators can acknowledge/assign, resolve, and reopen incidents from mobile; delegated operators are read-only.
- Added authenticated `GET /api/mobile-health` so operators can see sanitized operational health without access to raw administrator Runtime Health/Incident APIs or sensitive workflow context.
- Added a safe diagnostic-summary copy action that exports only the sanitized mobile model.
- Incident actions intentionally bypass the live-session SSE freshness/revision guard while still requiring online connectivity, Basic Auth, CSRF, persistent idempotency, and administrator authorization. This avoids the circular failure where an SSE outage creates an incident but also blocks acknowledging it.
- Corrected incident/Discord Policy audit attribution to use the authenticated dashboard identity.
- Added `mobile-health-model.js` and focused regressions for health formatting, delegated read-only access, admin-only incident mutations, safe non-live mutation wiring, and static asset protection.
- Existing Discord + Naver Cafe + CHZZK integrations, canonical Queue, participant self-service, OBS overlay, delegated operator controls, Mobile Broadcast Hub, concurrent-control safety, and data schema v2 remain unchanged. No new Discord Gateway Intent, Administrator permission, environment variable, or persistent file is required.

## 4.14.4

- Expanded `/mobile-control.html` with a **Mobile Broadcast Hub** tab so broadcast presets, schedules, viewer polls, unified notification preferences, CHZZK manual checks, broadcast statistics, and the recent broadcast timeline can be operated from the same phone-first surface.
- Added capability-aware mobile rendering: delegated operators without `broadcast` see a denied state, while starting a recruitment preset requires both `broadcast` and `live` exactly like the server route.
- Added one-tap preset start/delete controls plus current-session-to-custom-preset save. A new preset cannot start while another session is still active.
- Added mobile broadcast schedule creation and scheduled/completed/cancelled status controls, with locale-safe datetime rendering and preset selection.
- Added mobile viewer-poll creation/close controls and live vote-count/progress rendering compatible with both administrator `votes[]` payloads and privacy-minimized operator `voteCount` payloads.
- Added mobile unified notification toggles for CHZZK broadcast alerts, schedule notices, participation notices, Naver Cafe monitor alerts, and system notices.
- Added the 12 most recent merged broadcast timeline events and summary statistics to the mobile surface.
- Broadcast-only mutations reuse CSRF, persistent idempotency, capability enforcement, Basic Auth, SSE freshness locking, and the existing BroadcastOpsStore; they do not incorrectly opt into Operations/Queue revision guards. Preset start remains revision-guarded because it mutates the live session.
- Added a pure `mobile-broadcast-model.js` module and focused regressions for delegated permissions, poll-count sanitization compatibility, datetime handling, static-asset access, and mobile Hub API wiring.
- Existing Discord + Naver Cafe + CHZZK integrations, canonical Queue, participant self-service, OBS overlay, delegated operator access, concurrent Live Control safety, and data schema v2 remain unchanged. No new Discord Gateway Intent, Administrator permission, environment variable, or persistent file is required.

## 4.14.3

- Added **optimistic concurrency protection for Mobile Live Control** using the current Operations revision and canonical Participation Queue revision.
- Mobile mutations now send `X-Live-Operations-Revision` and `X-Live-Queue-Revision`; stale requests are rejected before mutation with `409 STALE_LIVE_STATE` and current safe revision metadata.
- Added a serialized revision-aware mutation gate so two different mobile/operator requests that pass initial network handling cannot both mutate from the same stale snapshot.
- Kept persistent idempotency ahead of the concurrency gate so a retry of an already-completed identical request replays the saved result instead of being misclassified as stale.
- Queue mutation responses now include canonical `controlRevisions`, preventing false stale locks while waiting for the next SSE push after call/status changes.
- Added mobile connection safety mode: write controls lock while offline, while SSE is disconnected, or when no snapshot/heartbeat has arrived for 35 seconds; a manual refresh control is shown for recovery.
- Added heartbeat freshness tracking and explicit no-auto-retry handling for stale mutations.
- Added confirmation prompts for draw, replacement draw, team reshuffle, round end, and no-show actions to reduce accidental touch operations.
- Existing admin/operator capability enforcement, CSRF, persistent idempotency, Queue serialization, crash recovery, Discord/Naver/CHZZK integrations, and data schema v2 are preserved. No new Discord Gateway Intent or Administrator permission is required.

## 4.14.2

- Added optional **delegated Mobile Live Control operator access** with separate `DASHBOARD_OPERATOR_USER` / `DASHBOARD_OPERATOR_PASSWORD` credentials; existing administrator credentials and behavior are unchanged when the operator account is not configured.
- Added four least-privilege operator capabilities: `live`, `queue`, `broadcast`, and `discord`, configured with `DASHBOARD_OPERATOR_CAPABILITIES`.
- Restricted operator accounts to `/mobile-control.html` and its static assets; the full administration dashboard, recovery/release tools, Discord setup/voice tools, Naver OAuth/account administration, nickname management, and other unassigned APIs remain administrator-only.
- Added capability enforcement for delegated API requests plus privacy-minimized operator snapshots/responses that omit registration records, Discord user IDs, Naver identity hashes, response tokens/message references, poll voter hashes, Naver publication identifiers, winner IDs, and participant profile details.
- Added per-identity SSE snapshots and per-role/per-user idempotency scopes so delegated sessions cannot inherit another dashboard identity's access metadata or request keys.
- Added delegated audit attribution with the operator username and role for Queue, broadcast, CHZZK, scene, and live-operation changes.
- Hardened delegated draw/preset behavior: operators cannot run the standalone all-member draw, and opening recruitment from a broadcast preset requires both `broadcast` and `live` capability.
- Added mobile role/capability rendering and capability-aware action disabling without changing the authoritative Queue, operations, CHZZK, Naver, OBS, recovery, or storage schemas.
- No new Discord Gateway Intent or Discord Administrator permission is required. Data schema remains v2.

## 4.14.1

- Expanded `/viewer/` from the race-color page into a unified participant self-service dashboard.
- Added authenticated self-service state for the logged-in Discord participant only: current session, own canonical Queue entry, reservations, call deadline, and permitted actions.
- Added self-service actions for join/leave, next/next-next postponement, participant-call join/pass, attendance confirmation, and reservation cancellation.
- Kept participant call tokens server-side; viewer payloads never include another participant's name/ID or response token.
- Reused the existing viewer one-time-code session, CSRF validation, idempotency middleware, Operations store, canonical Participation Queue, and crash-safe JSON persistence.
- Fixed a reliability edge case where a committed pass/no-show/manual resolution could be reported as failed when the subsequent automatic next-participant Discord delivery failed. The committed state now remains successful and the auto-advance error is reported separately for operator recovery.
- No new Discord Gateway Intent, Administrator permission, environment variable, or data migration is required.

## 4.14.0

- Added a dedicated mobile-first Live Control page at `/mobile-control.html` protected by the existing dashboard Basic Auth.
- Added real-time SSE synchronization with the PC dashboard and shared server state.
- Added large one-tap controls for next participant call, join/pass/no-show resolution, close/reopen, draw, attendance, replacement draw, team assignment/reshuffle, Discord sync, and round end.
- Added mobile call countdown, queue preview, CHZZK live indicator, and current round/game/attendance metrics.
- Reused existing CSRF, persistent idempotency, operation consistency, queue, crash recovery, and atomic storage protections; no new data schema or privileged Discord intent was added.

## 4.13.7

- Finalized **v4.13 Broadcast Operations** after Steps 1-7; no new runtime feature scope was added in this release.
- Added cross-feature final integration regressions for Naver memo participation + Discord canonical queue persistence, recruitment/draw/attendance/team/archive flow, and CHZZK live-transition integration with the Broadcast Operations Hub.
- Re-ran the dependency-independent v4.13 core regression suite together with crash recovery, idempotency, corruption recovery, durable atomic writes, queue/call flows, OBS overlay, team balancing, Naver, CHZZK, and Release Center coverage.
- Re-verified strong-integrity release Stage / Apply / target-manifest / Rollback from a clean v4.13.6 base.
- Data schema remains v2. Discord permissions, Gateway Intents, OAuth secret handling, and persistent file formats remain unchanged.
- Normal final deployment verification still requires Node.js >=22.22.2, a successful `npm ci`, and `npm run verify:final`; `--core-only` is intentionally not labeled as a full external-dependency pass.

## 4.13.6

- Added the **Broadcast Operations Hub** to Live Mode: game-operation presets, broadcast schedules, viewer polls, broadcast statistics, unified notification preferences, and a merged broadcast timeline.
- Added durable `BROADCAST_OPS_FILE` (default `./data/broadcast-ops.json`) using the existing JsonStore commit queue, atomic write, fsync, backup recovery, and corruption handling.
- Added three built-in operation presets (칼바람 시참 / 협곡 내전 / 이터널 리턴 시참) plus up to 12 custom presets saved from the current recruitment form. Presets can start a recruitment session directly from Live Mode.
- Added broadcast schedules with title/start time/preset/note, status transitions, one-shot due detection, and optional Discord schedule notices. Repeated scheduler ticks do not rewrite the file when no reminder is due.
- Added one active viewer poll at a time with 2-8 options. Linked viewers vote through the existing authenticated viewer dashboard; voter identities are stored only as SHA-256 hashes and dashboard responses expose counts only.
- Added cumulative broadcast statistics derived from session archives, the canonical participation queue, and CHZZK live-transition events.
- Added a merged broadcast timeline combining Broadcast Hub events, operation history, and CHZZK live start/end events.
- Added an integrated notification center. The broadcast toggle updates CHZZK Discord alert routing, the Naver toggle updates the existing Naver monitor Discord-alert setting, and schedule notices can be enabled/disabled independently.
- Added safe Discord broadcast-operation notices for poll starts and due schedules; mention parsing remains disabled.
- Added regression coverage for persistence, schedule one-shot reminders, one-vote-per-viewer poll semantics, merged statistics/timeline, dashboard wiring, and viewer poll UI. Data schema remains v2.

## 4.13.5

- Added official **CHZZK broadcast start/end detection** using Client-authenticated `GET /open/v1/lives` polling.
- Validates `CHZZK_CHANNEL_ID` once through the official channel lookup API before establishing the first live baseline.
- The first successful scan creates a baseline only; it does not announce an already-running broadcast, preventing notification floods after deployment/restart.
- Added bounded pagination over the official live list (`size=20`, `page.next`) with `CHZZK_LIVE_SCAN_MAX_PAGES`; hitting the scan cap produces an **unknown** state instead of falsely declaring a broadcast ended.
- Added bounded retry/backoff for CHZZK `429`, `5xx`, network failures, and timeouts.
- Added durable `data/chzzk-live.json` state with pending/sent/failed/uncertain/suppressed notification events, restart recovery, atomic writes, fsync, backup recovery, and corruption handling through the existing JsonStore reliability layer.
- Added Discord broadcast notifications for live start/end. The bot prefers `🟡・방송안내` and safely falls back to `📜・로그`; start notifications include title/category/viewer count/thumbnail and never parse mentions.
- Added Live Control CHZZK status, manual status check, Runtime Health reporting, Recovery Audit entries, and automatic dashboard Live Mode activation when a live broadcast transition is detected.
- Added `CHZZK_CLIENT_ID`, `CHZZK_CLIENT_SECRET`, `CHZZK_CHANNEL_ID`, `CHZZK_MONITOR_ENABLED`, `CHZZK_MONITOR_INTERVAL_MINUTES`, `CHZZK_MONITOR_DISCORD_ALERTS`, `CHZZK_LIVE_SCAN_MAX_PAGES`, and `CHZZK_LIVE_FILE`.
- No new Discord Gateway Intent or Administrator permission is required. Data schema remains v2.

## 4.13.4

- Added a dedicated transparent **OBS Browser Source overlay** at `/broadcast/overlay/` for the v4.13 Broadcast Operations workflow.
- The overlay shows the current/called participant, next waiting participant, waiting count, draw winners, current teams, session/game/round state, and a compact live event feed.
- Added `wide`, `compact`, and `minimal` layouts plus optional `hide=events,teams,winners` query controls for stream-scene composition.
- Reused the existing protected broadcast read-only API and `BROADCAST_TOKEN`; no new write API, Discord permission, Gateway Intent, or secret is introduced.
- Extended the broadcast snapshot with a privacy-minimized overlay model: Discord user IDs, Naver identity hashes, call response tokens, CSRF values, and profile details are not exposed to the overlay.
- Broadcast SSE now also subscribes to canonical participation-queue changes so call/join/postpone/no-show/reorder updates reach OBS without waiting for an operations-state mutation.
- Added safe overlay event messages derived from bounded participation history plus draw/team/session milestones.
- Added a dashboard OBS section with same-origin preview, Browser Source paths, layout shortcuts, and token handling guidance.
- Added dedicated regression coverage for overlay privacy, queue selection, winners/teams/event feed, transparent UI, SSE reconnect, route wiring, and dashboard integration. Data schema remains v2.

## 4.13.3

- Added four team assignment strategies: `balanced`, `tier`, `position`, and `random`.
- `balanced` now minimizes team tier-score spread, Rift main-lane duplication, and repeated teammate pairs from recent archived sessions.
- Added configurable recent-history depth (`0 / 3 / 5 / 10 / 20` sessions) using only same-game/same-mode `sessionArchive` team results.
- Added `팀 재섞기` / `reshuffle` operation; the current team arrangement receives a stronger repeat penalty so a new composition is preferred when alternatives exist.
- Added durable `teamMeta` with strategy, tier spread, lane-duplicate count, repeat-pair count, history samples, generated time, reshuffle count, and manual-adjustment marker.
- Manual `swap` now marks the generated team metadata as manually adjusted; archived sessions retain the final team metadata.
- Added Live Mode and normal dashboard selectors for team strategy and previous-team avoidance depth, plus a visible team-balance summary.
- Discord team result messages now include a compact balance summary without adding permissions or Gateway Intents.
- Added regression coverage for all strategies, uniqueness/team size, cost improvement, previous-team repeat reduction, operation metadata, and reshuffle behavior. Data schema remains v2.

## 4.13.2

- Added **broadcast participant call / response / no-show automation** on top of the v4.13 canonical participation Queue.
- Added `다음 참가자 호출`, per-row call/recall, call cancel, manual join confirmation, and no-show controls to Live Mode.
- Discord-origin participants receive `참가합니다` and `이번판 패스` buttons in the existing 시참 channel; only the originally called Discord user can respond.
- Added a configurable response window with `PARTICIPATION_CALL_TIMEOUT_SECONDS` (15-300 seconds, default 60). Expired calls become `no_show` and automatically advance to the next waiting participant.
- `이번판 패스` moves the participant to `postponed_next` and automatically calls the next waiting participant. A successful `참가합니다` response marks the Queue entry `joined` and stops automatic advancement.
- Added durable call metadata (deadline, attempt, Discord message reference) in the existing participation Queue file while keeping the private response token out of dashboard/API summaries.
- Added restart recovery: an unexpired call resumes its countdown; an expired persisted call is converted to no-show and the next waiting participant is called. Duplicate persisted `called` states are normalized to one active call.
- Recalling edits the existing Discord call message when possible instead of intentionally creating duplicate call messages. Completed/cancelled calls have their buttons removed.
- Naver/dashboard participants can still be called by name in the Discord 시참 channel, but because they have no Discord user identity, the streamer confirms participation/no-show from Live Mode.
- Existing reservation/draw/session compatibility, atomic JsonStore durability, fsync, corruption recovery, and Discord least-privilege configuration are preserved. No new Gateway Intent or Discord permission is required.
- Added regression coverage for response ownership, pass/timeout auto-advance, recall/cancel behavior, restart recovery, token redaction, timeout configuration, and dashboard/API wiring. Data schema remains v2.

## 4.13.1

- Added a durable **canonical participation queue** shared by Discord, Naver, and dashboard-origin registrations.
- Added explicit queue states: `waiting`, `called`, `joined`, `postponed_next`, `postponed_next2`, `cancelled`, and `no_show`. Step 3 automation for call/response/no-show is intentionally not included yet.
- Added source-aware identities while minimizing stored personal data: Discord uses the existing user ID; Naver/dashboard name identities are SHA-256 normalized keys rather than extra account identifiers.
- Queue registrations are serialized through the existing JsonStore commit queue, preserve request arrival sequence, survive restart, and reuse the existing atomic write/fsync/corruption-recovery layer.
- Existing Discord applicants/reservations/postponed/confirmed state is mirrored through a compatibility layer so the new queue does not replace or silently rewrite the established draw/session model.
- Existing Naver memo participation entries are mirrored into the canonical queue; Naver reset cancels active Naver queue entries without scraping or unofficial comment automation.
- Added dashboard queue controls for direct registration, reorder, cancel, return, next-round postpone, and two-round postpone. Discord mutations are mirrored back to the current open operation session.
- Added `PARTICIPATION_QUEUE_FILE` (default `./data/participation-queue.json`) and regression coverage for concurrency, deduplication, restart persistence, compatibility sync, privacy-preserving Naver identity, and UI/API wiring.
- No new Discord permission or Gateway Intent is required. Data schema remains v2.

## 4.13.0

- Added a dedicated **Broadcast Live Mode** dashboard tab optimized for one-screen stream operation.
- Added live KPIs for round/game, eligible applicants, winners/confirmed, reservations/postponed, Discord connectivity, and SSE sync state.
- Added one-tap phase-aware controls for close, reopen, draw, attendance, replacement draw, team assignment, Discord publish, voice-channel creation, and session end.
- Added phase-aware recommended next action with automatic button locking based on the current durable session state.
- Added quick-start presets for ARAM, Rift in-house, and Eternal Return using the existing protected `open` operation path.
- Added live participant queue, winner/attendance strip, team board, and recent activity feed.
- Added `public/live-control.js` as a pure model layer plus dedicated regression tests for action gating and dashboard wiring.
- Existing idempotency, crash recovery, semantic consistency checks, atomic JSON writes, Discord permissions, and Gateway Intents are unchanged.
- Data schema remains v2.

## 4.12.5

- Reworked the Naver **칼바람 시참** dashboard workflow around five explicit server-side controls: `칼바람 시참 열기`, `참가 등록`, `참가 취소`, `마감`, and `초기화`.
- `칼바람 시참 열기` makes the server bot post the fixed `칼바람 시참` article through the existing official Naver Cafe article-write API, then opens the local participation queue.
- `참가 등록` writes the participant into the durable queue in server request-arrival order; Enter on the name field triggers the same action.
- Added a dedicated participant selector + `참가 취소` button while keeping per-row cancel actions for quick operation.
- Added a true **close** state: `마감` locks further registration/cancellation while preserving the final ordered list and article link.
- `초기화` is now separate from close; it archives the current session/list and returns to READY for the next session.
- Closed sessions survive restart because the state is persisted through the existing atomic JsonStore durability layer.
- Added regression coverage for close-state persistence, post-close mutation blocking, archive/reset behavior, and dashboard wiring.
- Naver comment write/list automation remains unsupported because the official Cafe Open API does not document those endpoints; no scraping or cookie/browser automation was added.
- Data schema remains v2 and no Discord permission or Gateway Intent changes are required.

## 4.12.4

- Added a dedicated **칼바람 시참** memo-board workflow to the Naver settings dashboard.
- The dashboard can post a fixed `칼바람 시참` article to a configured Naver Cafe menu through the existing official Cafe article-write API.
- Added `NAVER_MEMO_MENU_ID` for a dedicated memo-board menu, with `NAVER_MENU_ID` as a fallback, and `NAVER_PARTICIPATION_FILE` for persistent queue state.
- Added an atomic, crash-recoverable participation queue: each dashboard registration receives the next immutable sequence number in server arrival order; cancelled sequence numbers are not reused.
- Added duplicate active-name protection, cancel, close/reset, bounded history, Runtime/Recovery integration, and persistent storage using the existing JsonStore durability layer.
- A crash while the remote Naver article POST result is unknown is recovered as `uncertain` and is not auto-retried, avoiding accidental duplicate memo posts.
- Naver's official Cafe Open API still does **not** document comment write/list endpoints. Therefore the dashboard does not fake comment automation or scrape pages; it provides `댓글 문구 복사 + 메모글 열기` to assist a manual comment instead.
- No new Discord permission or Gateway Intent is required. Data schema remains v2.

## 4.12.3

- Added an unauthenticated lightweight `GET /healthz` endpoint for Railway deployment healthchecks.
- `/healthz` returns 200 only while the application is ready to serve requests and returns 503 after graceful shutdown drain mode begins.
- Healthcheck output is intentionally minimal and contains no Discord/Naver credentials or operational data.
- Kept the existing authenticated `/api/health` endpoint for full dashboard diagnostics.
- Re-verified startup ordering and graceful shutdown order: mutation drain → HTTP drain → runtime/Discord close → persistent flush → process-lock release.

## 4.12.2
- v4.12 Naver Integration Step 3: production hardening and final integration verification for the official NAVER connector.
- official Cafe Search GET requests now use bounded retries for 429/5xx/timeouts/transient network failures, including capped `Retry-After` handling.
- unsafe Cafe join/write POST operations are never auto-retried on 5xx, avoiding duplicate side effects; explicit upstream 401 triggers at most one token refresh + retry.
- concurrent token refresh is single-flight so simultaneous expiring-token callers do not race or overwrite refreshed credentials.
- NAVER upstream 401/403/429/5xx status is preserved for Runtime Health instead of collapsing every client/upstream failure to generic 400/502.
- Discord Cafe alert readiness now checks client readiness, log-channel existence, and View Channel + Send Messages permissions before delivery.
- newly detected articles remain persisted as `failed` when Discord routing is unavailable so they can be explicitly retried after remediation.
- monitor failures emit bounded Recovery Audit metadata; API status now includes the monitor summary and request reliability policy.
- configuration validation now rejects `NAVER_MENU_ID` without `NAVER_CAFE_ID` and validates `NAVER_TOKEN_KEY` as exactly 32 bytes in 64-hex or Base64 form before startup.
- added regressions for bounded 429 retries, unsafe POST no-retry, refresh single-flight, 401 refresh/retry, Discord channel readiness failure, monitor audit/backoff, and config fail-fast behavior.
- data schema remains v2; no new Discord Gateway Intent or Administrator permission is requested.

## 4.12.1
- v4.12 Naver Cafe Integration Step 2: official public Cafe Search API polling monitor + Discord log-channel alerts.
- added `NaverMonitorStore` (`data/naver-monitor.json`) on the hardened JsonStore durability/corruption-recovery layer.
- monitor settings include enable/disable, required search query, optional exact `https://cafe.naver.com/...` Cafe URL filter, 1/5/15/30/60-minute interval, and Discord alert routing.
- first successful poll creates a baseline only, preventing a burst of alerts for old search results.
- later polls deduplicate by SHA-256 of the public article URL and retain a bounded seen-set/event journal.
- Discord alerts are sent only to the existing log channel with `allowedMentions` disabled; no new Discord permission or Gateway Intent is requested.
- a crash while an alert is pending is recovered as `uncertain`; it is not auto-retried to avoid duplicate Discord notifications, and the dashboard provides an explicit retry action.
- monitor failures use bounded exponential backoff up to one hour while successful polls return to the configured interval.
- dashboard now shows monitor health, next/last run, dedup count, recent detections, failed/uncertain retry controls, and manual `지금 점검`.
- added `NAVER_MONITOR_ENABLED`, `NAVER_MONITOR_QUERY`, `NAVER_MONITOR_CAFE_URL`, `NAVER_MONITOR_INTERVAL_MINUTES`, `NAVER_MONITOR_DISCORD_ALERTS`, and `NAVER_MONITOR_FILE`.
- monitoring remains official-API-only: NAVER Search API requires a query and does not provide a documented Cafe-specific new-post webhook or `clubid` filter, so exact Cafe filtering uses the `cafeurl` field returned by the official public Search API.
- data schema remains v2; existing v4.11 reliability safeguards and v4.12.0 OAuth/join/write behavior are preserved.

## 4.12.0
- v4.12 Naver Cafe Integration Step 1: official NAVER Open API integration foundation added to the existing Discord bot/dashboard.
- added OAuth 2.0 connect / refresh / revoke flow with one-time CSRF `state` and a dedicated `/naver/callback` handler.
- OAuth tokens are never written in plaintext: `data/naver-auth.json` stores AES-256-GCM ciphertext protected by `NAVER_TOKEN_KEY`.
- added official public Cafe article search (`/v1/search/cafearticle.json`) using Client ID/Secret headers.
- added official Cafe join and Cafe article write operations using OAuth Bearer tokens.
- Korean Cafe write form data is encoded to CP949/MS949 through `iconv-lite` to match NAVER Cafe API guidance.
- added dashboard settings panels for NAVER connection state, profile check, public Cafe search, Cafe join, and article write.
- added unified Recovery Audit entries for NAVER connect/disconnect/join/write operations while excluding credentials, tokens, article bodies, and secrets.
- comments and notice pin/unpin are explicitly shown as unsupported because the current official Cafe Open API exposes Cafe join and article write, not comment/notice-management endpoints. No scraping, password automation, browser bypass, or unofficial login automation is used.
- added `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`, `NAVER_REDIRECT_URI`, `NAVER_CAFE_ID`, `NAVER_MENU_ID`, `NAVER_TOKEN_KEY`, and `NAVER_AUTH_FILE` configuration.
- `iconv-lite` is now a direct runtime dependency and final verification checks for it.
- Data & Reliability v4.11 safeguards remain in place; operations data schema stays at v2.

## 4.11.6
- v4.11 Data & Reliability Finalization final integration verification release
- added `npm run verify:final` / `scripts/final-verify.js` to make the release-level verification repeatable
- final verifier enforces Node.js >=22.22.2 and installed `express`, `discord.js`, `dotenv/config`, and `jsdom` before a normal full-integration run
- `--core-only` mode runs syntax + dependency-independent regressions for constrained/offline validation, while clearly refusing to label that as a full final pass
- repeated Step 1-6 reliability regressions covering concurrent JSON commits, idempotency persistence, crash recovery, reservation/draw/session consistency, corruption salvage, and durable atomic writes
- release bundle Stage / Apply / target-manifest / rollback verification repeated from a clean v4.11.5 base
- data schema v2 retained; Discord permissions, Gateway Intents, and secret handling unchanged
- no runtime feature expansion in this release; v4.11 development scope is frozen after final verification

## 4.11.5
- Data & Reliability Finalization Step 6: fsync / atomic-write ordering / backup consistency finalization
- added `src/durable-file.js` for file fsync, atomic rename/replace, parent-directory fsync, durable copy, and durable remove operations
- JsonStore commit protocol fixed to new-value `.tmp` fsync → old primary `.bak.tmp` fsync → atomic `.bak` promotion → atomic primary rename → directory fsync
- backup replacement no longer copies directly over `.bak`, removing the truncate-and-copy crash window
- valid `.bak.tmp` is treated as the previous committed generation and outranks uncommitted primary `.tmp` only when primary and `.bak` are unusable
- valid primary remains authoritative over all staging files; stale `.tmp` and `.bak.tmp` are quarantined rather than replayed
- missing or corrupt `.bak` is rebuilt from a validated primary to restore redundancy
- post-primary-rename directory fsync failures no longer return a false mutation failure that could encourage duplicate retries; Runtime Health records a durability warning instead
- known unsupported directory-fsync behavior is handled portably while file fsync + atomic rename remain enforced
- ProcessLock owner creation now fsyncs the immutable lock and directory; lifecycle sidecar updates are atomic
- Release Center state/trust/journal/staging, rollback snapshots, apply/restore writes and deletions now use durable atomic filesystem helpers
- Production Backup bundles and Windows `config.local.json` writes now use durable atomic writes
- crash-window regression tests added for pre-commit temp, backup staging, backup promotion, post-primary-rename, and backup-temp salvage states
- data schema v2 retained; Discord permissions/intents unchanged
- next and final v4.11 activity is the full integration/finalization verification pass

## 4.11.4
- Data & Reliability Finalization Step 5: file corruption detection / recovery hardening
- JsonStore startup inspection expanded from primary + `.bak` to primary + `.bak` + `.tmp` candidates
- empty file, invalid UTF-8, malformed JSON, store-schema validation failure, and 128 MiB default size limit are treated as corruption candidates
- recovery priority fixed to healthy primary → validated `.bak` → validated `.tmp` salvage → fail closed
- a healthy primary always wins over leftover `.tmp`, preventing replay of an uncommitted interrupted write
- corrupt primary/backup/temp files are preserved with timestamp + random-suffix recovery artifacts before overwrite
- healthy primary + corrupt `.bak` now preserves the damaged backup and rebuilds backup redundancy from primary
- unrecoverable primary/backup/temp combinations raise `EDATA_CORRUPT` without modifying any candidate
- Runtime Health now tracks file corruption count and distinct `file_corruption_detected`, `backup_repaired`, `temporary_salvage` incidents
- startup file-integrity recovery summaries are persisted into Recovery Audit as `data_file_integrity_recovery`
- strict file-corruption regression tests added, including corrupted primary, dual corruption + temp salvage, stale temp isolation, fail-closed, UTF-8, size-bound, and telemetry cases
- data schema v2 retained; Discord permissions/intents unchanged
- fsync / atomic-write ordering / backup consistency remains Step 6

## 4.11.3
- Data & Reliability Finalization Step 4: reservation / draw / session state consistency
- `src/operations-consistency.js` 추가: session, 예약, 회차, 당첨, 참석, 팀 관계를 중앙 검증
- 같은 게임/사용자의 중복 예약은 마지막 예약만 유지하도록 정규화
- 현재 회차 이하의 stale 예약을 신청자에 반영한 뒤 예약 큐에서 소비
- 미래 예약과 `session.applicants` / `session.postponed` 연결을 자동 복구
- 예약이 사라진 `postponed` 사용자는 현재 추첨으로 되돌리지 않고 다음 회차 예약을 보수적으로 재생성
- 현재 session/보관 회차보다 낮은 `rounds`를 복구해 회차 번호 역행 방지
- 당첨자∉신청자, 미루기∩당첨자, 참석자∉당첨자 등 결과를 추측해야 하는 손상은 fail closed 처리
- 파생 팀 데이터가 중복/누락/비당첨자를 포함하면 winners/confirmed를 보존하고 teams만 초기화
- 빈자리 추가 추첨 후 stale attendance deadline 제거
- 팀 자동 편성 입력 record의 중복 당첨자 ID를 차단
- OperationsStore 시작 시 결정 가능한 의미적 drift를 1회 자동 복구·재저장
- 의미적 복구를 `.bak` 복구와 분리해 Runtime Health `state_consistency_recovery` incident로 기록
- 예약/상태 일관성 집중 회귀 테스트 추가
- 데이터 스키마 v2 유지
- 파일 손상/복구 고도화와 fsync/atomic write/backup ordering은 다음 단계로 보류

## 4.11.2
- Data & Reliability Finalization Step 3: abnormal shutdown / interrupted process recovery
- stale process PID lock를 단순 삭제하지 않고 이전 비정상 종료 신호로 보존·감지하도록 변경
- 살아 있는 PID의 lock은 대시보드 응답 여부와 무관하게 두 번째 프로세스를 차단하고, 막 생성된 불완전 lock도 grace window 동안 stale로 삭제하지 않아 동시 시작 위험 제거
- process lock의 소유자 파일은 실행 중 immutable하게 유지하고 `.pid.state` sidecar에 `starting / data-ready / recovered / running / stopping / fatal / shutdown-incomplete` 단계와 마지막 revision 기록
- 비정상 종료 감지 시 현재 JSON 저장소를 모두 다시 검증한 뒤 자동 Restore Point와 감사 로그 생성
- 재시작 직후 예약 타이머를 1회 즉시 평가해 중단 시간 동안 지난 자동 마감 시점을 재처리
- 관리자 `Idempotency-Key`를 `data/idempotency.json`에 SHA-256 token/fingerprint만 저장하는 지속형 journal 추가
- 이전 프로세스에서 완료된 mutation은 재실행하지 않고 409 + `recovered-completed`로 차단
- crash 시 pending mutation은 `uncertain`으로 전환해 자동 재실행을 막고 현재 상태 확인을 요구
- 서로 다른 explicit key가 같은 in-flight mutation으로 병합된 경우 alias key도 지속형 journal에 함께 완료 기록
- `JsonStore.flush()` 추가 및 종료 시 모든 persistent store queue drain 후 process lock 제거
- Graceful shutdown 순서를 `draining/SSE 중지 → 기존 HTTP 요청 완료 대기 → runtime close → persistence flush → lock 해제`로 수정
- uncaught exception / unhandled rejection은 best-effort 안전 종료 후 fatal lock marker를 남겨 다음 부팅에서 복구 감지
- `IDEMPOTENCY_FILE` 설정과 Startup Preflight 쓰기 경로 검증 추가
- 데이터 스키마 v2 유지
- 예약/추첨 상태 일관성, 파일 손상/복구 고도화, fsync/atomic write 강화는 다음 단계로 보류

## 4.11.1
- Data & Reliability Finalization Step 2: duplicate API request / idempotency protection
- 관리자 변경 API에 `Idempotency-Key` 기반 재처리 방지 계층 추가
- 동일 키 + 동일 요청은 최초 결과를 재사용하고, 처리 중 재전송은 한 요청으로 병합
- 동일 키를 다른 URL/본문에 재사용하면 409로 차단
- 키가 없는 동일 요청도 처리 중 및 짧은 중복 클릭 구간에서 병합해 이중 실행 위험 완화
- 대시보드/게임 스튜디오/시청자 화면이 변경 요청마다 idempotency key를 전송하도록 수정
- 네트워크 결과가 불확실한 경우 2분 동안 같은 키를 보존해 재시도 시 같은 작업으로 처리
- 운영 `/api/operations/*`의 기존 지속형 `requestId` 보호는 그대로 유지하고 HTTP 계층 보호를 추가
- 시청자 로그인은 같은 idempotency key 재시도 시 최초 세션 쿠키를 재전송해 single-use 코드 소실 방지
- 동일 mutation이 서로 다른 explicit key로 동시에 들어와 fingerprint 병합된 경우 두 번째 key도 최초 결과에 바인딩해 이후 재시도 중복 실행 방지
- 시청자 logout replay guard를 세션 검증보다 앞에 배치해 최초 logout으로 세션이 폐기된 뒤 네트워크 재시도가 401로 바뀌는 문제 수정
- 비정상/짧은 `Idempotency-Key`는 route 실행 전에 400으로 거부
- 중복 요청 guard 단위 테스트와 브라우저 mutation client 정적 회귀 테스트 추가
- API 통합 회귀 테스트에 닉네임 side effect 1회 실행, key 충돌 409, viewer login replay 케이스 추가
- 프로젝트 버전 4.11.1로 정합성 업데이트, 데이터 스키마 v2 유지
- 비정상 종료 복구, 예약/추첨 상태 일관성, 파일 손상/복구, fsync/atomic write 강화는 다음 v4.11 하위 단계로 보류

## 4.11.0
- Data & Reliability Finalization Step 1: JSON 동시 저장 / 요청 직렬화
- `JsonStore`를 파일 경로 단위 공유 commit queue로 변경해 다중 인스턴스의 동시 read-modify-write를 직렬화
- 동일 `.tmp` 경합으로 발생할 수 있던 `ENOENT` 및 stale state 마지막-writer 덮어쓰기 문제 수정
- 실패한 저장/검증 요청 뒤에도 다음 commit 요청이 계속 실행되도록 queue recovery 유지
- 동일 파일을 사용하는 store 구독 이벤트를 공유 coordinator 기준으로 동기화
- 프로세스 PID lock을 모든 지속형 JSON/백업 초기화보다 먼저 획득하도록 startup 순서 수정
- 동시 시작의 `open(..., wx)` `EEXIST`를 중복 실행 오류로 처리
- 주요 persistent JSON 설정 경로가 서로 겹치면 시작 전에 차단
- JSON 동시성 및 startup lock ordering 회귀 테스트 추가
- 프로젝트 버전 4.11.0으로 정합성 업데이트
- 데이터 스키마 v2 유지
- 중복 API idempotency, 비정상 종료 복구, 예약/추첨 상태 일관성, 파일 손상 복구, fsync/atomic write 강화는 다음 v4.11 하위 단계로 보류

## 4.10.0
- Incident Workflow & Alert Escalation Center 추가
- Runtime Health warn/error와 Discord Policy drift를 하나의 지속형 Incident 큐로 통합
- Incident 상태 OPEN / ACKNOWLEDGED / RESOLVED 및 담당자·메모 기록 추가
- 동일 장애 3회 반복 또는 15분 이상 미해결 시 CRITICAL 자동 승격
- Discord MANUAL drift는 일반 운영에서 CRITICAL, SAFE-only drift는 WARNING으로 분류
- Maintenance Mode 중 Policy drift escalation 보류 및 종료 후 즉시 재평가
- Runtime 이벤트 10분 무발생 시 자동 해소 처리
- 수동 해결 후 동일 과거 Runtime 이벤트 때문에 즉시 재오픈되던 경계값 문제 방지
- Incident 등록/승격/확인/해결/재오픈/자동 해소 Timeline 추가
- Control Center 운영 경고에 미확인/CRITICAL Incident 수 연결
- Production Readiness에 Incident Workflow gate 추가
- 진단 JSON에 비밀값/상세 오류 문자열 없이 Incident 상태 메타데이터만 포함
- `INCIDENT_WORKFLOW_FILE` 설정과 `data/incidents.json` 저장소 추가
- Startup Preflight가 Discord Policy/Incident 저장 경로 쓰기 권한까지 점검
- 관리자 Incident UI 필터, 담당 처리, 해결/재오픈 조작 추가
- 프로젝트 버전 4.10.0으로 정합성 업데이트
- 데이터 스키마 v2 유지

## 4.9.0
- Discord Alert Routing & Maintenance Center 추가
- Discord 로그 알림 범위를 OFF / MANUAL drift / 전체 drift로 분리
- drift 해소 알림 별도 설정 추가
- 15/30/60/120분 계획 작업 Maintenance Mode 추가
- Maintenance 중 drift 감지/Journal 기록은 유지하고 Runtime/Discord 외부 경고만 보류
- Maintenance 자동 만료 및 종료 직후 남은 drift 재경고 처리 추가
- 현재 drift digest 단위 Acknowledge/해제와 메모 기능 추가
- drift digest 변경 또는 해소 시 acknowledgement 자동 해제
- 경고 보류 횟수/최근 보류 사유 실시간 표시
- Monitor 설정 저장 시 v4.8 discordAlerts boolean을 새 alertMode로 하위 호환
- `지금 점검` 응답이 점검 전 monitorState를 반환해 마지막 점검/알림 상태가 잠시 stale하던 오류 수정
- Discord 알림 라우팅 OFF 전환 후 이전 전송 실패 문구가 남던 상태 오류 수정
- Maintenance/Acknowledge 해제 후 동일 drift가 남아 있어도 Runtime 경고가 다시 생성되지 않던 억제 상태 오류 수정
- Maintenance 시작/종료, drift 확인/해제를 Change Journal 및 관리자 감사 로그에 기록
- Control Center에서 Maintenance/확인된 drift를 실제 미확인 drift 경고와 분리
- 관리자 Policy UI에 Alert Route, Maintenance, Acknowledgement 상태/조작 패널 추가
- 프로젝트 버전 4.9.0으로 정합성 업데이트
- 데이터 스키마 v2 유지

## 4.8.0
- Discord Policy Monitor & Alert Center 추가
- Policy Baseline을 1/5/15/30/60분 간격으로 자동 점검하는 스케줄러 추가, 기본값 5분
- 자동 감시는 Discord 구성을 변경하지 않고 drift 탐지/상태 기록만 수행하도록 분리
- Policy Monitor 상태를 메인 Control Center SSE snapshot과 Discord 권한 감사 화면에 실시간 연결
- drift 발생/변경/해소를 Runtime Health 장애 타임라인에 연동
- 선택적 `📜・로그` Discord 알림 추가, 기본 OFF 및 상태 변화 때만 1회 전송
- Discord 알림은 mention을 전부 비활성화하고 최대 5개 변경 요약만 전송
- 알림 전송 실패와 Policy 비교 실패를 분리해, 로그 채널 장애가 모니터 자체를 FAIL로 오판하지 않도록 수정
- 기준선에 `/연동`·`/setting`이 없고 현재도 없을 때 허위 command drift가 발생하던 문제 수정
- 기준선에 없던 프로젝트 명령이 새로 등장했을 때 destructive SAFE 복구가 아니라 MANUAL drift로 분류
- 첫 drift가 `drift 변경`으로 기록될 수 있던 상태 전이 오류를 `drift 감지`로 수정
- 동일 comparison digest 관측 시 불필요한 `discord-policy.json` 재저장을 피하도록 개선
- Discord Audit Log 60초 캐시가 최초 `sinceAt`에 의해 잘려 이후 더 오래된 기준선 조회에서 항목을 놓칠 수 있던 문제 수정
- Demo Discord service에 남아 있던 실서비스 전용 중복 메서드를 정리
- 프로젝트 버전 4.8.0으로 정합성 업데이트
- 데이터 스키마 v2 유지

## 4.7.0
- Discord Change Journal & Policy Baseline 추가
- 프로젝트 핵심 Discord 구성을 SHA-256 정상 기준선으로 저장하는 `data/discord-policy.json` 추가
- 기준선 대비 채널/Guild Command/봇 권한/Intent/Install drift 비교 추가
- SAFE drift만 기존 Safe Fix 범위로 2단계 승인 후 복구 가능하도록 연결
- 기준선 채널 ID를 이용해 이름 변경된 핵심 채널을 추적하고 중복 생성 위험 수정
- 채널 이름/위치/topic/permission overwrite와 역할/Developer Portal 변경은 MANUAL 유지
- 선택적 View Audit Log 조회로 최근 채널/역할 변경 주체 보조 표시
- View Audit Log를 권장 최소 설치 권한에는 추가하지 않아 least-privilege 유지
- 동일 drift digest의 Change Journal 중복 기록 방지
- Discord Policy 데이터 파일을 Runtime/Capacity 저장소 크기 측정에 포함
- `.env.example`에 선택적 `DISCORD_POLICY_FILE` 경로 추가
- 데이터 스키마 v2 유지
- 구형 전투 추첨과 전용 관리 페이지를 제거하고 신규 추첨 모드를 레이스/사다리/즉시 추첨으로 정리
- 레이스 스튜디오와 시청자 레이스 색상 프로필로 UI 범위를 정리하고 과거 저장 기록은 결과 요약만 하위 호환
- 프로젝트 버전 4.7.0으로 정합성 업데이트

## 4.6.0
- Discord Permission Audit에 `Discord Drift & Safe Fix` Dry Run 패널 추가
- 현재 Discord 상태 차이를 SAFE / MANUAL / BLOCKED로 분류
- 누락된 `🎮 시참` 핵심 카테고리와 `🎟️・시참`, `⚔️・내전`, `📜・로그` 채널만 최소 범위로 생성하는 Safe Fix 추가
- 동일 핵심 채널이 다른 카테고리에 이미 있으면 중복 생성하지 않고 MANUAL 위치 drift로 전환
- 프로젝트 소유 Guild Slash Command `/연동`, `/setting`만 개별 생성·수정하는 안전 동기화 추가
- 다른 Guild Command 삭제/덮어쓰기 방지
- `/연동` default member permission drift와 `/setting` 관리자 역할/Manage Guild 기준 permission drift 진단·수정
- Administrator, 역할 hierarchy, Developer Portal scope/Intent, ADMIN_ROLE_ID, 채널 permission overwrite는 자동 변경 금지
- permission overwrite 자동 수정을 위해 ManageRoles를 추가 요구하지 않도록 최소 권한 정책 유지
- Dry Run plan digest와 기존 Operations Guard 2단계 승인 문구를 결합해 적용 대상 고정
- 승인 준비와 실제 적용 직전에 Discord 상태를 재조회해 TOCTOU drift 차단
- Safe Fix 각 작업을 독립 실행하고 부분 성공/실패를 결과와 감사 로그에 명확히 기록
- Discord 감사 강제 새로고침 후 같은 상태를 다시 중복 조회하던 대시보드 흐름 감소
- Demo 모드에서는 Dry Run만 허용하고 Discord 변경 차단
- 관리자/게임 스튜디오 버전 표시를 v4.6으로 정리
- 데이터 스키마 v2 유지
- 프로젝트 버전 4.6.0으로 정합성 업데이트

## 4.5.0
- 관리자 대시보드에 `🛡️ Discord 권한 감사` 센터 추가
- 실제 봇 역할의 서버 권한과 시참/내전/로그 채널 최종 권한(permission overwrite 반영) 검사 추가
- Guilds Gateway Intent 사용 여부와 불필요한 GuildMembers/Presence/Message Content privileged intent 탐지 추가
- Developer Portal 애플리케이션 플래그를 이용한 privileged intent 활성 상태 점검 추가
- Guild Install / bot / applications.commands scope와 기본 설치 permission 점검 추가
- `/연동`, `/setting` Guild Application Command 등록 상태와 `/setting` 기본/런타임 권한 검사 추가
- ADMIN_ROLE_ID 역할 존재 여부 검사 추가
- 봇 역할 hierarchy와 닉네임 변경 제약 안내 추가
- Administrator 권한 사용 시 최소 권한 위반 경고 추가
- 권장 최소 설치 permission 정수와 scopes 표시 추가
- Discord 구성 감사 결과를 Self-Check/Production Readiness에 연동
- Discord 감사 결과 30초 캐시와 수동 강제 재검사 지원
- guild.members.me 캐시가 비어 있을 때 기존 diagnostics가 권한을 잘못 판단할 수 있던 문제를 fetchMe() fallback으로 수정
- 데이터 스키마 v2 유지
- 프로젝트 버전 4.5.0으로 정합성 업데이트

## 4.4.0
- Dependency & Supply Chain Guard 센터 추가
- package.json/package-lock.json 직접 의존성 정합성 검사 추가
- npm lockfile v3, package/lock 버전 일치 검사 추가
- Registry resolved 출처와 SHA-512 integrity 검증 추가
- git/http/file/link 직접 의존성 차단
- 루트 install lifecycle script 차단, lockfile hasInstallScript 탐지 및 경고
- 직접 의존성·install script·라이선스·lock digest 대시보드 표시
- `daengdaeng-sbom-v1` SBOM JSON 다운로드 추가
- Release Center에서 의존성 파일 변경 시 동시 변경과 대상 공급망 검증 강제
- 신규 직접 의존성/범위 변경/제거/신규 install script를 Release 검증 항목에 추가
- 업데이트 적용 직전 공급망 재검증 추가
- Release Smoke Test에 의존성 공급망 점검 추가
- Windows 자동 설치 전에 공급망 검증 후 `npm ci --ignore-scripts` 실행
- 데이터 스키마 v2 유지
- 프로젝트 버전 4.4.0으로 정합성 업데이트

## 4.3.0
- `daengdaeng-update-v3` Ed25519 서명 업데이트 형식 추가
- v3가 v2의 기준 SHA-256/base Manifest/TOCTOU/트랜잭션 보호를 그대로 상속하도록 구현
- 패키지 Manifest digest에 stable/beta channel과 createdAt을 포함하고 서명 대상에 결합
- v3 channel은 stable/beta만 허용하고 잘못된 channel/createdAt은 생성·검증 단계에서 차단
- 내장 릴리스 공개키와 사용자 신뢰 공개키 저장소 추가
- 신뢰되지 않은 v3 공개키는 서명이 유효해도 스테이징 차단하고 candidate fingerprint 표시
- Release Trust Center에서 신뢰 키 추가/삭제 및 WARN/SIGNED REQUIRED 정책 관리
- 신뢰 키/정책 변경을 localhost + 2단계 승인으로 제한하고 감사 로그 기록
- apply 직전에 서명과 현재 Trust Policy를 다시 검증해 스테이징 이후 신뢰 변경 우회 차단
- Release Center에 SIGNED/TRUSTED/keyId 및 신뢰 키 목록 표시
- `npm run release:keygen` Ed25519 키 생성 도구 추가
- `release:bundle --sign-key`로 v3 서명 패키지 생성 지원
- 개인키는 프로젝트 코드/Update JSON/대시보드에 저장하지 않도록 분리
- v1/v2 하위 호환 유지, SIGNED REQUIRED 정책에서는 무서명 패키지 차단
- 데이터 스키마 v2 유지
- 프로젝트 버전 4.3.0으로 정합성 업데이트

## 4.2.0
- Release 패키지 `daengdaeng-update-v2` 형식 추가 및 v1 호환 유지
- 변경/삭제 파일에 기준 SHA-256과 전체 base Manifest digest를 포함하는 강한 기준 무결성 검증 추가
- 로컬 코드 수정(drift)이 있으면 패키지 스테이징과 적용을 차단
- 스테이징 후 적용 직전에 기준 SHA-256/전체 Manifest를 다시 확인해 TOCTOU 변경 차단
- 적용 완료 후 대상 파일 SHA-256 및 삭제 상태를 다시 검증한 뒤 재시작 상태로 전환
- 코드 적용/롤백 트랜잭션 저널 추가
- 파일 전환 중 프로세스가 종료되면 다음 시작 시 rollback snapshot으로 자동 복구 시도
- rollback snapshot 자체 SHA-256 검증 추가
- 검증 실패 패키지가 이전의 정상 staged package를 그대로 남기던 혼동/오적용 위험 수정
- 실패한 패키지 검증 결과의 상세 checks를 브라우저에서 그대로 표시하도록 API 오류 payload 전달 개선
- Release Center에 STRONG/LEGACY 기준 무결성 상태와 drift 표시 추가
- `release:bundle`은 기본 v2를 생성하고 `--legacy`로 v4.1 호환 v1 패키지 생성 지원
- v4.1 → v4.2 대시보드 업데이트용 Update JSON 제공 기반 완성
- 데이터 스키마는 v2 유지
- 프로젝트 버전 4.2.0으로 정합성 업데이트

## 4.1.0
- 관리자 대시보드에 Release & Update Center 추가
- DaengDaeng Update JSON의 기준/대상 버전, schema, 허용 경로, SHA-256, manifest digest 검증 추가
- 현재 코드와 업데이트 패키지의 추가/수정/삭제 파일 Diff 표시
- data/.env/config.local/node_modules/.git 및 프로젝트 밖 경로 코드 업데이트 차단
- 심볼릭 링크 경로 업데이트 차단
- 코드 적용/롤백을 localhost 전용 + 2단계 승인으로 제한
- 코드 적용 직전 운영 데이터 백업과 Recovery 복원 지점 자동 생성
- 변경 파일 코드 rollback snapshot 및 업데이트 실패 시 자동 원복 추가
- 새 버전 재시작 후 자동 Smoke Test와 수동 재검사 추가
- 이전 코드 파일 복원 후 재시작하는 코드 rollback 지원
- 현재 코드 SHA-256 manifest 다운로드 추가
- `npm run release:bundle` 업데이트 패키지 생성 도구 추가
- 명시적 4xx 오류 상태 코드가 일반 400으로 바뀔 수 있던 Runtime Health 분류 수정
- 관리자/게임 스튜디오 버전 표시를 v4.1 기준으로 정리
- 데이터 스키마는 v2 유지
- 프로젝트 버전 4.1.0으로 정합성 업데이트

## 4.0.0
- 관리자 대시보드에 Production Readiness & Deployment Center 추가
- 시작 전 Node.js/프로필/호스트 노출/인증/파일 쓰기/디스크/포트 Preflight 추가
- production / development / demo 실행 프로필 분리 및 `DEV.cmd` 추가
- `npm run dev`가 `--dev` development 프로필을 사용하도록 수정
- 자동/수동 배포 백업과 보존 개수·기간·자동 간격 설정 추가
- 오래된 백업을 새 백업 생성 여부와 무관하게 정리하도록 보존 정책 수정
- Runtime Health 기반 1~60분 Soak Test와 Production Gate 통합 판정 추가
- 중지된 Soak Test에서 이미 5xx/저장 실패가 관측된 경우 실패 판정 유지
- 복원/위험 작업 중 자동 백업을 건너뛰고 수동 배포 백업을 차단해 혼합 시점 백업 방지
- graceful shutdown 순서를 개선해 진행 중 HTTP/Discord 작업을 최대 10초까지 마무리한 뒤 Discord 연결 종료
- 배포 진단에서 최근 백업, Soak 상태, graceful shutdown 상태를 민감정보 없이 내보내도록 확장
- 게임 스튜디오/관리자 UI 버전 표시를 v4.0 기준으로 정리
- 데이터 스키마는 v2 유지
- 프로젝트 버전 4.0.0으로 정합성 업데이트
## 3.9.0
- 관리자 대시보드에 Performance & Capacity Center 추가
- 최근 1시간 15초 간격 메모리 RSS / Event Loop / API 추세 샘플링 추가
- 최근 15분 API P95/P99, 요청 속도, 오류율 및 500ms 이상 Slow API 탐지 추가
- 메모리 증가 속도는 최소 5분 관측 후 시간당 증가량으로 평가해 짧은 GC 변동 오탐을 줄임
- 관리자 SSE 12개 / 방송 SSE 8개 연결 용량과 사용률 표시
- registrations / operations / recovery JSON 파일 크기와 참가자 수 용량 진단 추가
- JSON 저장소 25MB 주의 / 100MB 위험 임계값과 운영 권장 조치 추가
- Runtime 진단 JSON에 민감정보 없는 Performance & Capacity 요약 포함
- 방송 SSE write/heartbeat 실패 시 연결 정리 누락 가능성 수정
- Runtime Health 페이지의 중복 metrics 컨테이너 마크업 수정
- Self-Check에 방송 SSE 연결 용량 점검 추가
- 프로젝트 버전 3.9.0으로 정합성 업데이트

## 3.8.0
- 관리자 대시보드에 Runtime Health & Incident Center 추가
- API 요청/오류/5xx/응답시간 및 상태코드별 런타임 지표 집계
- Discord 작업 호출/실패/지연 및 작업 종류별 지표 집계
- JSON 저장 성공/실패와 `.bak` 자동 복구 관측 기능 추가
- SSE 연결/해제/클라이언트 재연결/오류/stale/지연 통계 추가
- 스케줄러 실행/실패/처리시간, 메모리, Event Loop 지연 진단 추가
- 소스/심각도 필터가 있는 장애 타임라인 및 60초 중복 이벤트 압축 추가
- warn/error 런타임 장애를 Recovery Audit의 `runtime` 카테고리에 연결
- 민감정보와 참가자 원본 데이터를 제외한 진단 JSON 내보내기 추가
- Control Center 운영 경고에 Runtime Health 상태 연동
- SSE write 실패 시 heartbeat/stream 정리 누락 가능성 수정
- 저장소 오류를 500, Discord 오류를 502, 내부 프로그램 오류를 500으로 분류하도록 오류 처리 개선
- JsonStore 백업 자동 복구/읽기·쓰기 실패를 진단 계층에서 관측하도록 개선
- 게임 스튜디오와 관리자 UI의 버전 표시를 v3.8 기준으로 정리
- 프로젝트 버전 3.8.0으로 정합성 업데이트

## 3.7.0
- Operations Guard & Safe Deploy 패널 추가
- 버전/스키마 변경 감지 시 업데이트 직전 자동 복원 지점 생성
- 운영 데이터 `schemaVersion`/`appVersion` 기록 및 v1 → v2 자동 마이그레이션
- 오래된 방송 설정/프리셋/자동화와 운영 배열 구조 정규화
- 과거 복원 지점/백업 적용 시 현재 스키마로 자동 변환
- 업데이트 기준점 이후 비밀값 제외 설정 Diff 표시
- 복원 지점 적용/삭제, 전체 백업 복원, 수동 마이그레이션에 2분 유효 2단계 승인 적용
- 승인 요청을 작업 종류와 대상 digest/revision에 결합하고 1회 사용 후 폐기
- 마지막 정상 복원 지점 삭제 차단
- 현재 프로그램보다 새로운 백업 데이터 스키마 사전 차단
- 업데이트 후 자동 Self-Check 실행 및 감사 로그/`safeDeploy.postUpdateCheck` 기록
- 앱 버전을 `src/version.js`로 중앙화
- 정상 `session:null`을 반복 마이그레이션 대상으로 오인하던 기본값 판정 오류 수정
- 복원 후 과거 스키마가 그대로 남을 수 있던 문제 수정
- 관리자/게임 스튜디오의 오래된 v3.6 표시 문구 수정
- 프로젝트 버전 3.7.0으로 정합성 업데이트

## 3.6.0
- 관리자 대시보드에 Recovery & Audit Center 추가
- 참가자/운영 데이터를 함께 저장하는 복원 지점 최대 10개 지원
- 복원 지점 SHA-256 무결성 검증 및 손상 복원 차단
- 최초 v3.6 실행 시 초기 보호 지점 자동 생성
- 복원 직전 자동 보호 지점 생성 및 실패 시 직전 상태 롤백 시도
- 전체 JSON 백업 파일 검증 및 검증 통과 백업 복원 API/UI 추가
- Self-Check에 저장소, 회차 참조, Node.js, 외부 노출, 방송 토큰, Discord, SSE, 복원 무결성 점검 추가
- 운영/방송/복구/멤버/안내문/게임 설정 관리자 감사 로그 추가(최대 500건)
- 감사 상세에서 token/password/secret/CSRF/Authorization 계열 필드 제외
- 복원 중 SSE 중간 snapshot 억제 후 완료 상태만 push하도록 수정
- 안내문/무기 설정/setup/voice/publish 경로의 최상위 revision 누락 수정
- 시작할 때 guildId가 이미 저장된 운영 파일을 불필요하게 다시 쓰던 동작 수정
- 메인 및 게임 스튜디오의 오래된 버전 표시 수정
- API JSON 상한을 2MB로 조정해 전체 백업 검증/복원 지원
- `RECOVERY_FILE` 설정과 `data/recovery.json` 저장소 추가
- 프로젝트 버전 3.6.0으로 정합성 업데이트

## 3.5.0
- 방송 화면 설정 프리셋 저장/업데이트/적용/삭제 기능 추가(최대 12개)
- 소환사의 협곡/칼바람 나락/이터널 리턴/기본 컨텍스트별 자동 프리셋 매핑 추가
- 방송 장면 강제 고정 및 0~300초 자동 해제 기능 추가
- 회차 종료 장면 0~60초 유지 후 대기 화면 자동 복귀 기능 추가
- 방송 설정·프리셋 JSON 내보내기/가져오기 추가
- export 파일에서 Discord 토큰, 대시보드 비밀번호, BROADCAST_TOKEN 등 비밀값 제외
- 방송 snapshot에서 현재 자동 프리셋과 장면 override를 서버에서 계산하도록 변경
- 장면 고정 적용 시 게임별 프리셋 매핑이 지워질 수 있던 내부 정규화 오류 수정
- 자동화 입력을 수정할 때 일반 방송 설정이 '저장되지 않음'으로 오인 표시되던 이벤트 범위 오류 수정
- 자동화 저장 시 활성 장면 고정 상태가 의도치 않게 해제되지 않도록 수정
- 프리셋 삭제 시 연결된 게임별 자동 매핑을 자동 정리
- 프로젝트 버전 3.5.0으로 정합성 업데이트

## 3.4.0
- 관리자 대시보드에 Broadcast Scene Customizer 추가
- Midnight/Aurora/Warm Studio 테마 및 Cinematic/Compact 레이아웃 추가
- Fade/Slide/Cut 전환과 선택형 Soft/Arcade 효과음 추가
- 브랜드/푸터/대기 화면 문구 및 당첨자 공개 시간 설정 추가
- 헤더/푸터/텔레메트리/최근 신청자/카운트다운 표시 옵션 추가
- 모집/추첨 준비/당첨자/참석/팀/종료 장면별 자동 표시 설정 추가
- same-origin 관리자 방송 미리보기 iframe 지원
- 방송 설정 저장 API에 입력 검증과 정규화 추가
- SSE를 통한 방송 설정 실시간 반영
- 경기 데이터 일시 조회 실패 시 다음 동기화에서 재시도하도록 수정
- 헤더/푸터 숨김 시 남던 빈 그리드 공간 수정
- 손상되거나 오래된 방송 설정을 snapshot에서 안전하게 정규화
- 프로젝트 버전 3.4.0으로 정합성 업데이트

## 3.3.0
- 방송/OBS 전용 `/broadcast/` 실시간 화면 추가
- 모집 → 추첨 → 당첨 → 참석 → 팀 결과 → 종료 화면 자동 전환
- 방송 전용 SSE heartbeat, 자동 재연결, 8초 안전 폴링 추가
- 큰 추첨 프레임을 별도 `/broadcast/api/draw/:id`로 분리해 SSE 반복 전송 감소
- 방송 API에서 Discord User ID를 `p1`, `p2` 별칭으로 치환하고 관리자/프로필 데이터 제거
- OBS 투명 배경(`transparent=1`) 및 재생 속도(`speed`) 옵션 추가
- 동일 표시 이름 참가자의 참석 상태가 잘못 연결될 수 있던 방송 이름 매핑 오류 수정
- Live Director 1프레임 재생 진행률 0 나눗셈 방어
- Windows 첫 설정의 하드코딩 Discord 애플리케이션/서버 ID 제거 및 직접 입력 검증 추가
- Windows 첫 설정에서 BROADCAST_TOKEN 자동 생성 및 로그 비밀값 마스킹 추가
- 관리자 대시보드에 방송/OBS 바로가기와 Browser Source 주소 안내 추가
- 프로젝트 버전 3.3.0으로 정합성 업데이트

## 3.2.0
- 메인 Control Center에 통합 Live Director 추가
- 전투/레이스/사다리/즉시 추첨 인라인 미리보기 및 결과 재생
- 레이스 선두·랩·격차·진행률 실시간 텔레메트리 추가
- 전투 생존 인원·진행률 표시
- 일시 정지, 같은 경기 다시 보기, 팝업 연출 제어 추가
- 저장 경기/연습 경기를 메인 대시보드에서 바로 재생
- 추첨 모드·맵·서킷·랩 변경을 Live Director 미리보기와 동기화
- v3.2.0 버전 정합성 및 Live Director 회귀 테스트 추가

## 3.1.0
- SSE heartbeat 및 자동 재연결 안정화
- 실시간 동기화 진단 패널 추가
- 참석 전원 확인 시 팀 편성 추천 로직 수정
- 프로젝트 버전 3.1.0, discord.js 의존 범위 ^14.27.0으로 정리

## 4.17.3 - Production Connector & OAuth Connectivity Verification
- Added read-only production connector verification for Discord, Naver OAuth/API, CHZZK API, and public HTTPS health.
- Added optional admin-only active probe flow via CSRF/idempotency-protected POST; probes perform read-only external checks without persisting credentials or connector payloads.
- Added deployment dashboard connectivity panel and Go-Live advisory integration.
- Added regression tests for OAuth/public-origin consistency, privacy, read-only probe behavior, unknown Discord runtime state, CHZZK target-channel mismatch, and GET/POST probe separation.
