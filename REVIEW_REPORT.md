# 최신 검토: v5.2.5 마감 후 호출 패스·예약 복구 배포 후보

현재 검토 결과는 [호출 패스·예약 복구 보고서](docs/workspace-review-v525.md)에 정리했습니다. 추첨 전 마감된 모집의 정확한 호출에 다음판 패스 예약을 지원하고, Operations 결정과 Queue 적용을 분리해 실패·재시작·중복 응답에서 복구합니다. 여러 파일을 하나의 원자적 트랜잭션으로 저장하는 기능은 아닙니다. 호출별 자동 진행·회차 경계·잠금·종료·flush와 참가자 응답의 개인정보 경계를 검증합니다. 미완료 기록이 있는 롤백은 수동 검토 대상이며 자동 차단 게이트를 추가했다고 주장하지 않습니다. [v5.2.4 참가자 접수 안내](docs/workspace-review-v524.md), [v5.2.3 접수 설정](docs/workspace-review-v523.md)과 기존 검토 기록을 보존합니다. 계정 분리 기반은 [v5.2.0 보고서](docs/workspace-review-v520.md), 운영 시작 안내는 [v5.2.1 보고서](docs/workspace-review-v521.md), 선발 규칙·호출 시간·연습은 [v5.2.2 보고서](docs/workspace-review-v522.md)에 있습니다. 새 포털은 기본 비활성이며 실제 계정 OAuth·서버 분리·팔로워 역할 부여와 새 버전 Railway 배포는 PENDING입니다. 아래 내용은 이전 버전의 검토 기록입니다.

---

# v4.17 Step 6 Review Report — Production Cutover Smoke & Stabilization Verification

## Version
- Base: 4.17.4
- Target: 4.17.5
- Data schema: 2 (unchanged)

## Scope completed
- Added explicit post-cutover smoke/stabilization verification after Step 5 Production Acceptance.
- Added read-only `GET /api/production-cutover` preview.
- Added admin-only `POST /api/production-cutover/verify` requiring explicit `trafficOpened=true` acknowledgement.
- Added Deployment dashboard **Production Cutover & Stabilization** panel with traffic-switch acknowledgement, current verification, and local JSON export.
- Added command-palette aliases for post-cutover, smoke, stabilization, and traffic-switch operations.
- Updated production host runbook guidance with the manual external traffic-switch + post-cutover verification sequence.

## Safety / fail-closed behavior
- The bot does not change DNS, hosting-provider routing, reverse-proxy routing, Discord state, Naver Cafe content, CHZZK state/chat, Queue/session state, Release apply/rollback state, or Emergency Lock state.
- A POST without `trafficOpened=true` is rejected; a preview or unchecked dashboard cannot be mistaken for completed traffic cutover.
- The POST performs a fresh Step 5 Production Acceptance verification in the same request, so a stale browser acceptance result cannot authorize a post-cutover PASS.
- Runtime Health `fail`, active CRITICAL incidents, Release restart/rollback/recovery/failure states, unavailable/malformed current code Manifest, and draining state are blockers.
- Non-critical active incidents remain warnings. `Release Center = idle` is advisory because provider-native deployments may not have been applied through the in-app Release Center.
- A successful report is a 10-minute operational snapshot and is not persisted as an authorization token.

## Security / privacy review
- POST verification is admin-only and remains behind existing dashboard authentication, CSRF, same-site, JSON-body, persistent idempotency, and audit controls.
- Diagnostic verification remains callable during Emergency Lock, but the fresh Production Acceptance result fails while the lock is active.
- The report contains bounded status/check text plus the current project Manifest file count/digest only.
- Bot Token, OAuth access/refresh tokens, Client Secrets, Dashboard password, CSRF values, participant identities, Naver profile identifiers, call tokens, and raw upstream payloads are not serialized.
- No new environment variable, Discord Gateway Intent, Administrator permission, persistent data file, or data-schema migration was added.

## Bug / consistency review
- Prevented a stale Step 5 acceptance result from being reused as post-cutover authorization by recomputing acceptance and connector probes in the same POST request.
- Prevented an unchecked/implicit traffic switch from producing a post-cutover result by requiring an explicit boolean acknowledgement.
- Added fail-closed handling for missing Incident state, Runtime Health state, Release state, and current code Manifest.
- Preserved external/native deployment compatibility by treating Release Center `idle` as WARN instead of falsely blocking an otherwise healthy provider deployment.

## Verification
- `npm run check`: 208 JavaScript files PASS.
- Focused production/release/recovery/runtime/dashboard regression: 111/111 PASS.
- `npm run verify:final -- --core-only`: 430/430 PASS across 101 dependency-independent test files.
- Raw `npm test`: 437 total / 430 PASS / 7 environment-blocked failures.
- The 7 raw-test failures are caused by unavailable sandbox dependencies (`express`, `discord.js`, `dotenv`, `jsdom` and related imports), not failing Step 6 assertions.
- Normal `npm run verify:final` correctly fails the production environment gate because this sandbox runs Node.js 22.16.0 while the project requires Node.js >=22.22.2.

## Release verification
- Update format: `daengdaeng-update-v2` (strong SHA-256 integrity, unsigned).
- Update comparison: 2 add / 10 change / 0 delete / drift 0.
- Dependency review: PASS.
- Stage: PASS (`staged`).
- Apply: PASS (`restart-required`).
- Target manifest: 236/236, digest `2386712794aa8b769e53ebdf31519709a3b63e50cdd569e9d9858fd8f24c5227`, MATCH.
- Rollback: PASS (`rollback-restart-required`).
- Base manifest: 234/234, digest `701076252f0ccc8a031bae2c8e89290ed0230af1cc76c4b11ee855e9afe91bda`, MATCH.

## Production host limitation
This sandbox does not contain the real production Discord Bot Token, Naver/CHZZK secrets, connected Naver OAuth state, deployed public HTTPS hostname, or control of the hosting provider/reverse proxy. Therefore no real external traffic switch or third-party post-cutover PASS is fabricated here. The verification path and safety controls are regression-verified; the actual result must be executed on the deployed production host after the operator enables traffic externally.

## Production cutover procedure
On the actual host, use Node.js >=22.22.2, run `npm ci`, `npm run env:check`, and normal `npm run verify:final`, then start the service. Run Step 4 connector verification and Step 5 Production Acceptance immediately before cutover. Enable production traffic in the hosting provider or reverse proxy manually. Then check the traffic-switch acknowledgement in Deployment > **Production Cutover & Stabilization** and run the Post-Cutover Smoke verification. Resolve every blocker and re-run if the 10-minute stabilization snapshot expires.
