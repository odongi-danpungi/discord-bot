# 댕댕봇 v5.1.7 — 통합 방송 운영 · 공통 CHZZK 채널 자동 연결

운영자가 관리자 페이지 `/chzzk-verification.html`에서 방송 채널 소유자로 한 번 동의하면 공통 인증 대상 채널 ID가 자동 저장됩니다. 봇이 초대된 모든 Discord 서버는 같은 방송 채널을 인증하며, 서버마다 채널 ID나 역할 ID를 입력하지 않습니다. 역할 관리 권한으로 초대하면 인증 역할을 자동 생성·재사용하고 참가자는 `/치지직인증`으로 본인 동의를 진행합니다. 기존 Discord 패널과 선택적 닉네임 동기화도 유지합니다. 기능은 기본 비활성이며 [인증 설정 및 실제 검증 절차](docs/chzzk-follower-verification.md)를 먼저 확인하세요.

v5.1.7에서는 인증 역할 부여와 닉네임 변경의 권한 검사를 분리하고, `/치지직인증` 본인 전용 응답에 **내 연동 상태** 재확인 버튼을 추가했습니다. 새 환경변수와 데이터 마이그레이션은 없습니다.

v4.17.5 전체 기능을 보존하고 v4.17.6 운영 모니터링 및 v4.18.0 커뮤니티·계층형 대시보드를 통합했습니다. GitHub의 이전 v5.0 skeleton보다 실제 기능이 완성된 코드가 기준입니다. 데이터 스키마는 v2입니다.

Node >=22.22.2에서 `npm ci` → `npm run verify:ci` → `npm run demo`로 외부 서비스 없이 확인합니다. 실제 실행은 환경변수 설정 후 `npm start`입니다. `.env.example` 및 `deploy/production.env.example`을 참고하세요.

운영 연결·Railway 트래픽 검증은 실제 인증정보가 준비되기 전까지 PENDING입니다. `docs/PRODUCTION_CHECKLIST.md`에 운영/E2E 절차를 기록합니다. 비밀값을 Git에 넣지 마세요.

이전 GitHub 문서는 `docs/github-import-history/`에 보존했습니다. 해당 문서의 완료 표시는 과거 기록이며 현재 운영 검증 결과가 아닙니다.

---
# 댕댕봇 4.18.0 · 커뮤니티 운영

운영 대시보드 → 커뮤니티 운영에서 아래 기능을 버튼으로 사용합니다. 기존 v4.17.6 운영 모니터링과 모든 기존 모듈을 유지합니다. 데이터 스키마는 2이며 새 설정은 기존 operations 저장소의 community 영역에 저장됩니다.

1. 모집 연결: 열린 회차 → 신청 링크 초안 → 미리보기 → Discord/카페 선택 게시. 참가자는 Discord 연동 후 일회용 코드로 로그인하여 기존 통합 대기열에 신청합니다. 카페 댓글 자동 수집은 없습니다.
2. 내 시참: 공지 채널에 패널 게시·갱신 → 참가 신청/취소, 다음 판 예약, 호출 응답, 본인 기록·문의 확인. 프로필 수정은 /연동을 사용합니다.
3. 통합 공지: 일반 안내/일정/변경/휴방/결과 양식 → 초안 → 개별 또는 두 곳에 게시. 대상별 결과가 저장되며 성공한 대상은 재게시하지 않습니다.
4. 공정성: 오늘 미참가 우선(KST), 접수 순서, 연속 참가 제한, 신규 자리 설정. 다음 회차부터 적용되며 모집 시작 시 기준을 고정합니다. 신규 판단은 보관된 최근 최대 50회 기록 범위입니다. 인원이 부족하면 기준을 임의로 완화하지 않습니다.
5. 방송 후기: 종료 회차 선택 → 신청/참가 확인 인원 통계와 후기 초안 → 검토 후 게시. 개인 노쇼 내역을 포함하지 않습니다.
6. 게임 알림: 권한 없는 알림 전용 역할을 선택하고 참가자가 직접 구독/해제합니다. 커뮤니티 공지의 주제 역할만 멘션합니다. DM 대량 발송은 없습니다. 기존 CHZZK 자동 알림은 기존 동작을 유지합니다.
7. 규칙·FAQ·문의: 공통 안내 편집·게시, 참가자의 개인 문의 접수, 관리자 답변·처리 완료.

## 실행과 설정

Node >=22.22.2, npm ci 후 npm start. 연습은 npm run demo (기본 http://127.0.0.1:3001/community.html). 연습 데이터는 data/demo에 분리됩니다.
기존 .env.example 변수와 운영 데이터를 유지하세요. 새 필수 환경변수는 없습니다. PUBLIC_BASE_URL은 실제 공개 HTTPS 주소여야 합니다.
알림 구독을 사용하려면 봇의 Manage Roles 권한과 봇보다 낮은 알림 전용 역할이 필요합니다. 역할에는 서버 권한과 채널 접근 허용을 부여하지 마세요. Administrator 및 새 Privileged Intent는 요구하지 않습니다.
카페 게시에는 기존 공식 API OAuth 연결 및 대상 카페/게시판 쓰기 권한이 필요합니다. 초안을 만드는 것만으로는 외부에 게시되지 않습니다.

## 검증·복구

npm run check, npm test, npm run verify:final, node scripts/final-verify.js --core-only.
새 집중 테스트: node --test test/community.test.js test/community-api.test.js test/community-ui.test.js.
게시 결과가 불확실하면 실제 대상에서 확인하고 사유와 결과를 기록한 뒤 재시도하세요. 임의 자동 재시도는 중복 게시를 일으킬 수 있어 차단합니다.
문의는 본인과 관리자에게만 표시되며 공개 후기에는 통계만 포함합니다. 비밀값을 문의/공지에 입력하지 마세요.
배포 전 operations 파일을 포함한 운영 데이터와 환경변수를 백업하세요. 코드 롤백은 이미 전송한 외부 게시물이나 역할 변경을 되돌리지 않습니다.

---
이전 버전 운영 문서:

# 댕댕봇 4.17.6 · Production Monitoring & Operational Readiness · Step 7

운영 대시보드의 Deployment 탭에 Discord / Naver / CHZZK / Public HTTPS 모니터링을 추가했습니다. 기존 모든 기능과 데이터 스키마 v2를 유지합니다.

- GET /api/production-monitoring: 외부 호출 없이 최근 결과와 현재 런타임·장애·릴리스·잠금·draining 상태 조회.
- POST /api/production-monitoring/probe: 관리자 전용, 기존 인증·CSRF·동일 사이트·멱등성·감사 보호 적용. 읽기 전용 검사만 실행합니다.
- 2분 TTL, 메모리 이력 최대 20회, 최소 30초 간격, 동시 요청 병합, 서비스별 timeout, 429 Retry-After 대기. 재시작 후에는 새 검사 전까지 승인 차단.
- PRODUCTION_MONITOR_INTERVAL_SECONDS=0: 자동 검사 해제(기본). 60~3600초로 설정하면 서버에서 주기 검사. 계속 유효한 상태를 관측하려면 60초 권장; 120초 이상은 검사 사이 만료 구간이 생깁니다.
- 새 운영 게이트는 네 연결 모두 실제 성공해야 통과합니다. 선택 연동을 사용하지 않는 일반 기능은 그대로 실행되지만, 이 프로젝트의 전체 Production Acceptance는 미설정 연결을 통과 처리하지 않습니다.
- restart/rollback/recovery 대기, 알 수 없는 릴리스 상태, 불완전한 장애 정보, 긴급 잠금, draining, 환경 검증 비정상은 차단합니다. 자동 복구가 감지된 부팅은 확인 후 깨끗하게 재시작해야 합니다.
- Naver 검사에서는 기존 토큰으로 GET profile만 수행합니다. 자동 토큰 갱신·카페 글쓰기·가입은 하지 않습니다. 만료 토큰은 재연결/정상 인증 흐름으로 해결하세요.
- Public HTTPS는 HTTP 200뿐 아니라 health JSON, v4.17.6 버전, ready=true, emergencyLocked=false를 확인합니다. 리다이렉트·사설/로컬 DNS 대상·인증정보 포함 URL을 거부합니다. 공개 URL은 루트 origin을 사용하세요.
- Acceptance / Cutover / Connector / Monitoring은 같은 검사 조정기를 사용합니다. 검사를 연달아 실행하면 429 대기가 정상입니다. 대기 후 다음 검증을 실행하세요.
- 결과는 현재 상태를 보여주는 진단 자료이며 실제 트래픽 전환 또는 외부 서비스 쓰기 권한을 부여하는 토큰이 아닙니다. /healthz는 기존 호스트 수신 상태 의미를 유지하고, 전체 운영 승인은 관리자 진단 API에서 확인합니다.

## 배포 설정 대조

scripts/expected-deployment.example.json을 프로젝트 밖의 파일로 복사하고, 배포하려는 version·릴리스 manifestDigest·PUBLIC_BASE_URL·NAVER_REDIRECT_URI·HOST·PORT를 입력합니다. 실제 값은 비교 JSON에 재출력하지 않습니다.

~~~sh
npm ci --ignore-scripts
npm run env:check
npm run verify:final
npm run deployment:compare -- /secure/location/expected-deployment.json
~~~

manifestDigest는 릴리스의 target-manifest-v4.17.6.json 또는 Step 7 보고서에서 가져오세요. URL은 config의 정규화 형식(공개 주소 끝 / 포함)과 정확히 일치해야 합니다. 이 검사는 현재 프로세스 설정·코드를 대조하며, 호스팅 서비스 라우팅이 실제로 전환됐는지는 별도로 확인해야 합니다.

## 업그레이드와 플랫폼 주의사항

v4.17.5의 Windows 파일 복사 fsync 버그를 v4.17.6에서 수정했습니다. 그러나 업데이트 적용 코드는 이미 실행 중인 이전 버전이 수행하므로 Windows에서는 v4.17.5의 앱 내부 Update JSON 적용을 사용하지 말고, 봇을 정지한 뒤 전체 ZIP을 새 디렉터리에 배치하고 기존 환경 설정·데이터를 안전하게 이전하세요. 이전 폴더와 데이터 백업을 보존하세요. 신규 인스턴스와 이전 봇을 동시에 운영하지 마세요.

Update JSON은 기존 Release Center 허용 경로(src/public/scripts/test 및 지정 루트 파일)를 대상으로 합니다. .dockerignore와 FEATURE_REVIEW 문서는 그 범위 밖이므로 전체 ZIP을 사용하거나 별도로 반영하세요. 특히 Docker 빌드에는 새 .dockerignore를 적용해 config.local.json / config.json / *.pem / *.key가 이미지에 들어가지 않게 해야 합니다. Update JSON은 SHA-256 무결성 형식 v2이며 배포자 전자서명은 없습니다. 서명 필수 정책을 낮추지 말고 기존 신뢰 키로 서명하세요.

Windows 자동화 테스트의 SIGTERM은 강제 종료 및 crash recovery를 검증합니다. Linux의 POSIX graceful shutdown은 실제 Linux 호스트에서 별도로 확인해야 합니다.

## 이전 릴리스 기록




## v4.17.5 · Step 6 — Production Cutover Smoke & Stabilization Verification

Step 5의 최종 Production Acceptance 이후 실제 호스트/Reverse Proxy에서 실서비스 트래픽을 전환한 뒤, 같은 인스턴스가 정상적으로 안정화되었는지 다시 검증합니다. 이 단계는 DNS나 호스팅 라우팅을 자동 변경하지 않으며 운영자의 명시적 전환 확인 후 read-only 검증만 수행합니다.

- `GET /api/production-cutover` 읽기 전용 preview와 관리자 전용 `POST /api/production-cutover/verify` 실제 Post-Cutover 검증 추가
- POST는 `trafficOpened=true` 명시 확인이 없으면 거부하여 단순 클릭을 실제 트래픽 전환으로 오인하지 않음
- 같은 요청에서 Step 5 Production Acceptance를 다시 실제 검증해 15분 이전 결과를 재사용하지 않고 현재 Discord/Naver/CHZZK/Public HTTPS 상태를 확인
- Runtime Health FAIL, 활성 CRITICAL Incident, Release 재시작/롤백/복구 대기, Smoke 실패, Manifest 계산 실패, graceful shutdown/draining을 fail-closed blocker로 처리
- 비 CRITICAL 활성 장애와 Release Center `idle`은 외부 배포 환경을 고려해 WARN으로 유지하되 운영자가 계속 관측하도록 표시
- 현재 코드 Manifest를 read-only로 계산해 파일 수와 SHA-256 digest를 검증 보고서에 포함
- Dashboard **Production Cutover & Stabilization** 카드, 전환 확인 checkbox, Post-Cutover Smoke 실행, 현재 결과 JSON 저장 추가
- 결과는 10분 동안의 안정화 판단 자료이며 영구 승인 토큰이나 자동 traffic switch로 사용하지 않음
- Bot Token, OAuth Token/Secret, Dashboard Password, CSRF, 참가자 식별정보, Naver profile identifier, raw upstream payload는 보고서에 포함하지 않음
- 데이터 스키마 v2, 환경 변수, Discord Gateway Intent, Administrator 권한, 기존 영구 데이터 파일 변경 없음


## v4.17.4 · Step 5 — Production Acceptance & Cutover Verification

Step 4의 Discord/Naver/CHZZK/Public HTTPS 실제 연결 검증을 Production Gate·Go-Live·Release 상태와 결합해 실서비스 전환 직전의 최종 승인 판정을 제공합니다. 검증 자체는 외부 서비스에 쓰기 작업을 하지 않습니다.

- `GET /api/production-acceptance` 읽기 전용 사전 점검과 관리자 전용 `POST /api/production-acceptance/verify` 실제 검증 추가
- 실제 검증은 Step 4의 Discord 진단, 연결된 Naver Profile GET, CHZZK Channel GET, Public HTTPS `/healthz` GET만 재사용
- Production Gate, Go-Live launchable 상태, 실제 connector probe 실행 여부, Release/rollback 상태, draining 상태를 하나의 fail-closed 판정으로 집계
- 핵심 readiness 또는 Release Center 데이터가 누락되면 false positive가 아니라 차단으로 처리
- staged/verify-failed는 현재 실행 버전을 막지 않는 WARN, restart/rollback/transaction recovery/Smoke 실패는 cutover blocker
- Naver/CHZZK 선택 연동은 기존 정책을 유지해 core launch blocker로 승격하지 않고 경고로 표시
- Dashboard **Production Acceptance & Cutover** 카드, 15분 유효 안내, 현재 결과 JSON 저장 추가
- 관리자 POST는 기존 CSRF·Same-Site·Idempotency·Audit 보호를 그대로 사용하며 Emergency Lock 중에도 진단은 가능하지만 Go-Live 판정 때문에 acceptance는 통과하지 않음
- Bot Token, OAuth Token/Secret, Dashboard Password, CSRF, Naver profile identifier, Discord member ID, participant identity, raw upstream payload를 보고서에 포함하지 않음
- 데이터 스키마 v2, 환경 변수, Gateway Intent, Administrator 권한, 영구 데이터 파일 변경 없음

## v4.17.3 · Step 4 — Production Connector & OAuth Connectivity Verification

- Discord 런타임/API, Naver OAuth/Profile, CHZZK Channel API, Public HTTPS `/healthz`를 read-only 방식으로 실제 확인
- `GET /api/connector-verification`은 상태 조회 전용, 실제 외부 검증은 관리자 전용 CSRF/Idempotency 보호 `POST /api/connector-verification/probe`로 분리
- Naver callback과 Public HTTPS origin/path drift를 차단하고, CHZZK API 성공이어도 설정 채널 미반환은 FAIL 처리
- Secret/OAuth token/profile identifier/raw upstream payload 비노출, 새 Intent/권한/스키마 변경 없음

## v4.17.2 · Step 3 — Production Secrets & Environment Validation

실서비스 서버가 저장소나 Discord/API 연결을 시작하기 전에 환경변수와 Secret 구성을 먼저 검증합니다. 실제 비밀값은 출력하지 않고 설정 상태와 수정 항목만 보여 줍니다.

- `loadConfig()` 직후, process-lock·JSON 저장소·Discord 로그인 전에 Production 환경 검증 실행
- `GET /api/environment-validation` 읽기 전용 API와 Deployment Dashboard **SECRETS & ENVIRONMENT** 카드 추가
- 기존 Production Gate와 Go-Live 판정에 환경 검증 결과 통합
- `npm run env:check`로 배포 서버에서 `npm start` 전에 동일한 검증 실행 가능
- Discord Token 및 Application/Guild ID, Dashboard 관리자/운영자 인증, 외부 Broadcast Token, HTTPS Public/Viewer URL 검증
- Naver Client/OAuth callback/Token Key/Cafe 대상과 CHZZK Client/Channel/Monitor 설정 검증
- 서로 다른 Dashboard/Broadcast/Naver/CHZZK 비밀값 재사용을 Production 차단 항목으로 감지
- Naver OAuth callback을 설정한 경우 `/naver/callback` 경로와 `PUBLIC_BASE_URL` 동일 origin 확인
- Naver/CHZZK가 완전히 미설정이면 선택 기능으로 WARN만 표시하고 핵심 Discord 봇 시작은 차단하지 않음
- 검증 API/CLI에는 Bot Token, Password, Client Secret, OAuth Token, `NAVER_TOKEN_KEY`, `BROADCAST_TOKEN`, CSRF, 참가자 식별정보를 포함하지 않음
- 새 mutation API, Gateway Intent, Administrator 권한, 영구 데이터 파일, 데이터 스키마 변경 없음

## v4.17.1 · Step 2 — Production Host Bootstrap & Deployment Configuration

실서비스 호스트에서 봇이 안전하게 시작·종료·복구되기 위한 실행 계약을 명시했습니다. 특정 호스팅 업체에 종속시키지 않고 Railway 같은 컨테이너 호스트에서도 같은 규칙으로 상태를 확인할 수 있습니다.

- `GET /api/host-bootstrap` 읽기 전용 API와 Deployment Dashboard Host Bootstrap 카드 추가
- 외부 호스트는 HTTPS `PUBLIC_BASE_URL`을 요구하고, Reverse Proxy 신뢰는 `TRUST_PROXY_HOPS=0..5`의 정확한 hop 수만 허용
- `/healthz`를 플랫폼 health check 계약으로 고정: 정상 200, draining 503
- SIGTERM/SIGINT graceful shutdown과 10초 내부 drain, 최소 12초 외부 종료 유예 권장
- `./data`와 `./data/backups` 영속 볼륨 요구사항 표시
- Node 22.22.2 기반 non-root Dockerfile, `.dockerignore`, `npm run healthcheck`, `deploy/production.env.example` 추가
- Railway/Render/Fly/Cloud Run 환경은 공개 도메인처럼 비밀이 아닌 배포 메타데이터만 읽어 플랫폼 상태를 유도
- Host bootstrap 실패는 기존 Go-Live core blocker로 통합되며 새 mutation API는 추가하지 않음
- Bot/OAuth Secret, Dashboard Password, CSRF, 참가자 식별정보, 원본 환경 비밀값은 응답에 포함하지 않음
- Discord Gateway Intent/권한, Naver Cafe/CHZZK, Queue/Runbook/Recovery/Release Center, 데이터 스키마 v2 유지


## v4.17.0 · Step 1 — Production Go-Live Readiness & Action Plan

v4.16의 방송 운영 기능을 그대로 유지하면서 실제 배포 직전에 사용자가 확인해야 할 항목을 하나의 읽기 전용 Go-Live 판정으로 정리합니다. 기존 Production Gate를 대체하지 않고, 그 결과와 Discord/Naver/CHZZK/접근 설정을 함께 보여 주는 상위 실행 체크리스트입니다.

- `GET /api/go-live-readiness` 읽기 전용 API와 JSON 보고서 다운로드 추가
- Production profile, Discord 연결/최소 권한, 최근 백업, Soak Test, 장애 상태, Emergency Lock을 핵심 시작 조건으로 집계
- 외부 네트워크 노출, Viewer HTTPS URL, 위임 운영자 계정을 별도 접근·운영 체크로 표시
- Naver Cafe OAuth/메모 게시판 대상과 CHZZK Open API/Monitor 상태를 별도 통합 체크로 표시
- FAIL은 실서비스 시작 전 필수 해결, WARN은 선택/권장 설정으로 분리해 사용자가 해야 할 작업을 바로 표시
- 각 작업은 기존 Dashboard 탭으로 이동하며 새 mutation API를 추가하지 않음
- Go-Live 응답은 설정 여부/상태만 포함하고 Bot/OAuth Secret, Dashboard Password, CSRF, 참가자 식별정보를 포함하지 않음
- Deployment readiness와 Go-Live readiness를 독립적으로 읽어 한쪽 요청 실패가 다른 점검 화면을 숨기지 않도록 보강
- 데이터 스키마 v2, Discord Gateway Intent/권한, 기존 Naver Cafe·CHZZK·Queue·Runbook·Recovery·Release Center 동작 변경 없음


## v4.16.6 · Step 7 — Broadcast Operations Final

v4.16.0~v4.16.5에서 추가된 방송 준비·Runbook·인수인계·자동 단계·마감·아카이브·성과 분석을 하나의 운영 흐름으로 최종 검증했습니다. 새 기능 범위를 확장하지 않고 최종 회귀 테스트와 PC Dashboard UX 정합성 수정에 집중했습니다.

- PRE-LIVE → ON-AIR → POST-LIVE → Closeout → Archive → Performance 분석을 연결한 통합 회귀 테스트 추가
- Runbook 메뉴를 직접 열면 전용 `GET /api/broadcast-runbook`을 즉시 새로고침하도록 수정
- 활성 Runbook 교체는 공통 고위험 확인 UX를 항상 거치도록 보강
- 이미 마감된 Runbook에서 다음 Runbook을 시작할 때 중복 보관 경고를 표시하지 않도록 수정
- Broadcast Archive/Performance 읽기 전용 정책과 기존 `broadcast` 위임 권한 범위 재검증
- Discord + CHZZK + Naver Cafe, canonical Queue, Recovery/Emergency Lock, Release Center 보존
- 데이터 스키마 v2, Gateway Intent, Administrator 권한, 환경 변수 변경 없음

## v4.16.5 · Step 6 — Broadcast Performance Trends & Operational Insights

마감된 방송 아카이브를 기반으로 여러 방송의 운영 성과를 비교합니다. 새 개인정보를 수집하지 않고 기존 집계값만 사용하며, 인사이트는 규칙 기반 참고 정보로 제공되어 원인이나 시청자 행동을 단정하지 않습니다.

- 최근 3/5/10회 또는 전체 방송 범위 선택
- 회차당 신청, 당첨자 참석률, 당첨자 노쇼율, 회차당 Runbook 시간 집계
- 최신 방송과 직전 방송의 주요 지표 차이 표시
- 방송별 추세 막대와 시간순 비교
- 노쇼/참석률/신청량/운영 시간/Runbook 건너뜀 기반 최대 4개 운영 인사이트
- 데이터가 0~1회인 경우 추세를 과장하지 않고 데이터 부족 상태 표시
- 기존 `GET /api/broadcast-archive`만 재사용하며 새 mutation API 없음
- 참가자 이름, Discord ID, Naver identity hash, Token/Secret 등 개인·비밀 데이터 추가 노출 없음
- 새 Gateway Intent, Administrator 권한, 환경 변수, 데이터 스키마 변경 없음

## v4.16.4 · Step 5 — Broadcast Archive & Post-Show Report

마감된 Runbook을 방송별 **Post-Show Report**로 조회할 수 있는 읽기 전용 아카이브를 추가했습니다. 보고서는 Runbook 생성~마감 시간 안의 종료 회차와 CHZZK 시작/종료 이벤트만 집계합니다.

- 종료 방송별 Runbook 완료/건너뜀, 회차 수, 신청·당첨·참석·노쇼, 게임별 회차 수, CHZZK 시작/종료 횟수 집계
- 참가자 이름, Discord ID, Call Token, Naver identity hash, OAuth/Bot Token 등 개인·비밀 식별정보는 보고서 API에 포함하지 않음
- PC 대시보드에 방송 아카이브 전용 화면과 검색 추가
- 보고서 요약 복사 및 개인정보 최소화 JSON 내보내기
- JSON 파일명 정규화 및 API 응답 클라이언트 정규화
- 기존 `broadcast` 위임 운영자 권한 범위 안에서 읽기 전용 접근
- 새 mutation API, Gateway Intent, Administrator 권한, 환경 변수, 데이터 스키마 변경 없음


## v4.16.3 · Step 4 — Broadcast Closeout & Next-Show Handoff

방송 종료 후 Runbook을 실제 운영 기록으로 확정할 수 있도록 **Closeout / 보관 / 다음 방송 인수인계 요약**을 추가했습니다. 기존 `broadcast-ops.json` 안의 선택 필드만 확장하며 데이터 스키마 버전은 그대로 v2입니다.

- 12개 Runbook 항목이 모두 `완료` 또는 `건너뜀` 상태이고 서버가 `POST-LIVE`를 확인했을 때만 Closeout 가능
- 진행 중 시참 회차 또는 CHZZK LIVE 상태에서는 서버가 `409`로 마감을 거부하여 UI 우회를 방지
- Closeout 시 현재 Runbook을 `closed` 읽기 전용 상태로 전환하고 동일 atomic JSON commit에서 archive에 1회만 보관
- 중복/재전송된 Closeout은 이미 완료된 결과를 반환하며 archive를 중복 생성하지 않음
- 마감 후 체크리스트·인수인계 수정은 차단되고 새 Runbook 시작만 허용
- 최신 인수인계와 사용자가 입력한 다음 방송 메모를 기반으로 다음 담당자·다음 일정·요약을 자동 생성
- 다음 방송 요약의 Token/Password/Secret/API Key 형태 credential은 기존 규칙으로 `[REDACTED]` 처리
- PC 관리자와 모바일 운영자 Runbook 화면에 마감 상태, 다음 담당, 다음 일정, 다음 방송 인수인계 요약을 표시
- Closeout 알림 전송 실패는 이미 저장된 마감을 되돌리지 않고 Runtime Incident로만 기록
- 새 Gateway Intent, Administrator 권한, 환경 변수, 별도 영구 파일 없음

## v4.16.2 · Step 3 — Runbook Automation & Handoff Alerts

Broadcast Runbook이 수동 체크리스트에만 머물지 않도록 **자동 단계 감지, 운영자 교대 알림, Runbook Timeline 연동**을 추가했습니다. 기존 `broadcast-ops.json` 내부 선택 필드만 확장하므로 별도 저장 파일이나 데이터 스키마 변경은 없습니다.

- 활성 시참 회차 또는 CHZZK LIVE 상태를 감지하면 Runbook을 `ON-AIR`로 자동 전환하고, 방송/회차 종료 신호가 Runbook 생성 이후 확인되면 `POST-LIVE`로 전환
- 자동 단계 전환의 source/reason/detectedAt과 최근 phase history를 서버 상태에 저장하고 PC/모바일에서 동일하게 표시
- 단계 전환은 `runbook_phase` Timeline 항목과 같은 atomic JSON commit으로 기록
- 동일 단계인 경우 scheduler tick이 `broadcast-ops.json`을 다시 쓰지 않아 불필요한 3초 주기 디스크 write를 방지
- 다음 담당자가 지정된 인수인계는 기존 Discord 방송 알림 채널로 전달하고 `pending/sent/failed/suppressed` 상태를 기록
- Discord 알림 실패는 이미 저장된 인수인계를 실패로 되돌리지 않으며 Runtime Incident에 별도로 기록
- Runbook 화면에 최근 자동 단계·체크리스트·인수인계 활동 Timeline을 표시하고 모바일 운영자 화면에도 동일한 요약 제공
- credential 형태의 Discord 오류 메시지는 저장 전 redaction하며 delegated operator 응답에는 상세 alert error를 포함하지 않음
- Emergency Operation Lock 중에도 Runbook 메타데이터 자동 감지는 유지하지만 Live/Queue/Discord 상태 변경 보호는 우회하지 않음
- 데이터 스키마 v2, Discord Gateway Intent/Administrator 권한, Naver Cafe·CHZZK 연동, CSRF/idempotency/recovery 정책은 그대로 유지

## v4.16.1 · Step 2 — Broadcast Runbook & Operator Handoff

방송 전·진행 중·종료 후 절차를 같은 화면에서 이어갈 수 있도록 **Broadcast Runbook**과 **운영자 인수인계**를 추가했습니다. 기존 `broadcast-ops.json`을 확장하므로 새 환경 변수나 별도 영구 파일은 필요하지 않습니다.

- PRE-LIVE / ON-AIR / POST-LIVE 3단계, 총 12개 운영 체크 항목과 완료·건너뜀·대기 상태 관리
- PC 관리자 대시보드와 모바일 운영자 화면에서 동일한 서버 상태를 사용하고, Command Palette에서 `runbook`, `인수인계`, `교대`, `체크리스트`로 바로 접근
- 인수인계 메모에 현재 담당자·다음 담당자·최근 기록을 남기며 작성자는 클라이언트 입력이 아니라 로그인된 Dashboard 계정으로 서버가 결정
- `broadcast` capability가 있는 운영자만 모바일에서 Runbook을 변경할 수 있고, PC 전체 관리자 화면은 기존처럼 관리자 전용
- Emergency Operation Lock 또는 SSE 이상 중에도 Runbook 메타데이터와 인수인계는 사용할 수 있지만 Live/Queue/Discord 상태 변경 보호는 우회하지 않음
- Token/Password/Secret/API Key 형태의 credential assignment는 저장 전에 `[REDACTED]` 처리하고 운영자 응답은 허용 필드만 재구성
- 과거 Runbook은 내부 archive로 최대 20개 보존하지만 일반 snapshot/API에는 archive 본문을 노출하지 않고 개수만 제공
- Runbook 상태 변경과 Timeline 감사 항목을 같은 atomic JSON-store commit으로 기록하여 이중 쓰기 실패에 따른 오인 재시도를 방지
- 데이터 스키마 v2, Discord Gateway Intent/Administrator 권한, Naver Cafe·CHZZK 연동 방식, Queue semantics, CSRF/idempotency/recovery 정책은 변경하지 않음

## v4.16.0 · Step 1 — Go-Live Preflight

방송 시작 직전에 여러 관리 화면을 따로 열지 않아도 되도록 PC 관리자 대시보드에 **방송 사전 점검** 화면을 추가했습니다. 이 화면은 기존 상태를 읽어서 안전 여부만 계산하며 자동 수정이나 상태 변경을 수행하지 않습니다.

- Emergency Operation Lock, CRITICAL/활성 장애, Discord 연결, Runtime Health, 최근 저장 실패·복구, CHZZK 공식 Open API 상태를 한 번에 확인
- Discord 기준선 Drift, 현재 시참 회차의 추첨 가능 인원, 참가자 호출 응답 대기, Naver Cafe 시참 접수/OAuth 상태, 다음 방송 일정 확인
- `PASS / WARN / FAIL` 체크리스트와 문제를 실제로 처리할 수 있는 기존 관리 화면으로 이동하는 권장 작업 제공
- Home에 사전 점검 상태와 바로가기 추가, Command Palette에서 `방송 준비`, `사전 점검`, `go live`, `preflight` 검색 지원
- 수동 재점검은 읽기 전용 `GET /api/broadcast-preflight`만 사용하며 기존 mutation API를 자동 실행하지 않음
- 응답에는 call token, Discord user ID, Naver identity hash, CSRF/OAuth/Bot/Dashboard/Release 비밀값을 포함하지 않음
- 데이터 스키마 v2 유지, 새 환경 변수·영구 파일·Discord Gateway Intent·Administrator 권한 없음

## v4.15.7 · Step 8 — Dashboard UX Final

v4.15 Step 1~7의 PC 관리자 대시보드 UX를 최종 통합 검증하고 릴리스로 고정했습니다. 이번 단계는 새 운영 기능을 추가하지 않고 Dashboard Shell/Home, Command Palette, Toast/Action Feedback, Dirty-State/Navigation Guard, 접근성/키보드 포커스, 반응형 표·목록, Loading/Empty/Error 상태가 함께 동작하는지 검증합니다.

- Home의 Emergency Lock/CRITICAL Incident 우선순위와 안전한 화면 이동 검증
- Command Palette의 전체 탭 검색 및 destructive mutation 미노출 검증
- Queue/호출/Discord/Naver/CSRF/credential 비밀정보가 Home/검색/피드백 계층에 노출되지 않는지 검증
- Toast redaction, 수동 read-only retry, unsaved navigation guard, high-risk confirmation 회귀 검증
- 입력 중 전역 단축키 차단, 포커스/스크린리더 안내, reduced-motion, 모바일/태블릿 반응형 표시 회귀 검증
- 데이터 스키마 v2, Discord Gateway Intent/권한, Naver Cafe·CHZZK 연동, Recovery/Emergency Lock, Release Center 동작은 변경하지 않음

운영 최종 게이트는 **Node.js >=22.22.2** 환경에서 `npm ci` 후 `npm run verify:final`이 `FINAL PASS`를 출력하는 것입니다. 현재와 같은 제한 환경의 `npm run verify:final -- --core-only`는 dependency-independent 회귀 검증이며 production final gate를 대체하지 않습니다.

## v4.15.6 · Step 7 — Responsive Content States / Table & List Readability

PC 관리자 대시보드의 반응형 화면을 최종 정리했습니다. 초기 Snapshot 로딩 중에는 `aria-busy`와 공통 로딩 상태를 표시하고, Snapshot을 불러오지 못한 경우 오류 상태와 **수동 다시 시도** 버튼을 제공합니다. 다시 시도는 기존 읽기 전용 `/api/snapshot` 조회만 실행하며 mutation을 자동 재시도하지 않습니다.

등록된 게임 정보 표는 넓은 화면에서는 기존 table을 유지하고, 860px 이하에서는 각 행을 필드명이 붙은 카드로 변환해 가로 스크롤 없이 Discord/치지직·이터널 리턴·리그 오브 레전드·수정 시간을 모두 읽을 수 있습니다. 목록·폼·지표·Incident action도 작은 화면에서 겹치지 않도록 정리했고, 터치 환경의 주요 컨트롤은 최소 44px 높이를 확보합니다. 데이터 스키마 v2, Discord 권한/Intent, Naver Cafe·CHZZK 연동, Queue, Recovery/Emergency Lock, Release Center는 변경하지 않습니다.

## v4.15.5 · Step 6 — Dashboard Accessibility / Keyboard / Focus UX

PC 관리자 대시보드의 키보드·포커스 접근성을 정리했습니다. 본문 바로가기 링크, 명확한 `:focus-visible` 표시, 화면 전환 음성 안내, Command Palette와 모바일 사이드바의 포커스 순환/복귀를 추가했습니다. Alt+0~3 전역 단축키는 입력 필드·텍스트 영역·선택 상자·contenteditable 편집 중에는 실행되지 않습니다.

명령 팔레트 검색 입력에는 명시적인 접근성 이름과 설명을 추가했고, `prefers-reduced-motion`을 사용하는 환경에서는 대시보드 애니메이션/전환을 최소화합니다. 기존 API, Discord 권한/Intent, Naver Cafe·CHZZK 연동, Queue, Recovery/Emergency Lock, 데이터 스키마 v2는 변경하지 않습니다.

## v4.15.4 — Form Safety & Navigation Guard

PC dashboard settings and Naver drafts now track unsaved edits, warn before leaving the active section or closing/reloading the page, and display a header badge while unsaved data remains. High-risk actions use consistent confirmation wording. Existing API security and emergency controls are unchanged.

# 댕댕봇 4.15.3 · Dashboard Action Feedback

> Current release: **v4.15.3 Dashboard Action Feedback Step 4** — unified toast notifications, mutation progress visibility, duplicate suppression, accessible feedback, and credential-safe message rendering.



## v4.15.3 · Step 4 — Dashboard Notifications / Toast / Action Feedback

PC 관리자 대시보드의 기존 단일 `#notice` 메시지를 보완해 **전역 Toast 피드백 스택**과 **요청 처리 상태 배지**를 추가했습니다. 기존 기능/API는 그대로 두고, 저장·추첨·방송 설정·복구·배포 등 이미 존재하는 작업의 성공/실패 피드백만 더 명확하게 표시합니다.

- 성공/안내/주의/오류 톤을 구분하는 최대 4개의 Toast 스택
- 같은 알림이 짧은 시간에 반복되면 새 카드로 쌓지 않고 반복 횟수로 합침
- 각 Toast는 직접 닫을 수 있고 일반 성공 알림은 자동으로 사라짐
- 관리자 POST 작업 중에는 헤더에 `작업 처리 중`을 표시하고 응답 수신 후 자동으로 정리
- Runtime client metric 같은 백그라운드 telemetry POST는 작업 중 표시에서 제외
- 오류 메시지를 DOM `textContent`로만 렌더링하고 Authorization/Token/Password/Secret/CSRF/API key 형식의 값은 Toast 표시 전에 마스킹
- 지속적인 `/api/health` 경고는 중복 Toast를 만들지 않고 하나의 sticky warning으로 유지하며 상태가 정상화되면 제거
- 작은 화면에서는 Toast를 하단에 배치하고 `prefers-reduced-motion` 환경에서는 애니메이션을 제거
- 기존 Basic Auth, CSRF, persistent idempotency, 동시성 guard, Emergency Lock, Discord/Naver/CHZZK 연동과 데이터 스키마 v2는 변경하지 않음

이번 단계는 **표시/UX 계층 변경**이며 자동 재시도, destructive quick action, 새 권한, 새 Gateway Intent, 새 환경 변수, 새 영구 저장 파일을 추가하지 않습니다.


## v4.14.7 · Step 8 — Mobile Operations Final

v4.14 Step 1~7의 모바일 운영 기능을 최종 릴리스로 고정했습니다. 이번 단계는 새 런타임 기능을 추가하지 않고 Mobile Live Control, Participant Self-Service, 위임 운영자 권한, 동시 제어 안전장치, Mobile Broadcast Hub, Runtime Health/Incident Center, Recovery/Emergency Controls가 기존 Discord + Naver Cafe + CHZZK 방송 운영 데이터 계층 위에서 함께 동작하는지 최종 검증합니다.

- 운영자 snapshot이 Discord/Naver/투표/호출 비밀 식별자를 노출하지 않으면서 부여된 `live/queue/broadcast/discord` 권한만 유지하는지 검증
- Viewer Self-Service의 호출 응답이 서버 내부 call token을 노출하지 않고 canonical Queue 및 다음판 예약 상태에 저장되며 재시작 후에도 유지되는지 검증
- Emergency Operation Lock이 재시작을 넘어 유지되고 참가자 호출 타이머가 잠금 시간을 deadline에 보상하는지 검증
- 모바일 Live/Broadcast/Health/Recovery 모델이 동일한 인증 역할 경계를 유지하는지 검증
- v4.11~v4.13의 JsonStore atomic write/fsync, crash recovery, corruption recovery, persistent idempotency, Release Center Apply/Rollback 회귀를 다시 포함
- 데이터 스키마 v2 유지, 새 Discord Gateway Intent/Administrator 권한/환경 변수/영구 저장 파일 없음

운영 최종 게이트는 **Node.js >=22.22.2** 환경에서 `npm ci` 후 `npm run verify:final`이 `FINAL PASS`를 출력하는 것입니다. 현재처럼 외부 의존성을 설치할 수 없는 제한 환경의 `npm run verify:final -- --core-only`는 코드/코어 회귀 검증이며 production final gate를 대체하지 않습니다.


## v4.14.6 · Step 7 — Mobile Recovery & Emergency Controls

`/mobile-control.html`에 **Recovery** 탭을 추가했습니다. 관리자 계정에서 휴대폰으로 Self Check, 검증된 복원 지점, 복구 감사 기록, 수동 복원 지점 생성, 복원 적용, 전체 백업/진단 JSON 다운로드를 사용할 수 있습니다. 운영자 계정은 이 탭의 복구 기능에 접근할 수 없습니다.

긴급 장애 대응을 위해 **Emergency Operation Lock**을 추가했습니다. 잠금을 활성화하면 먼저 현재 참가자·운영 상태의 복원 지점을 자동 생성한 뒤 관리자/운영자 대시보드 쓰기, 시청자 Self-Service 쓰기, 상태를 바꾸는 Discord 인터랙션, 자동 회차 타이머와 참가자 호출 타이머를 일시 중지합니다. Runtime Health, Incident Center, Naver/CHZZK 상태 모니터링과 진단 조회는 계속 동작합니다.

진행 중인 참가자 호출은 잠금 시간만큼 deadline을 연장하므로 장애 대응 중 시간이 지나도 참가자가 자동 노쇼 처리되지 않습니다. 잠금과 해제 모두 기존 Basic Auth + CSRF + persistent idempotency + 관리자 권한 + 1회용 2단계 승인 문구를 사용합니다. 데이터 스키마는 v2 그대로이며 별도 DB/파일, 새 Discord Gateway Intent, Administrator 권한은 필요하지 않습니다.

## v4.14.5 · Step 6 — Mobile Runtime Health & Incident Center

`/mobile-control.html`에 **Health** 탭을 추가해 방송 중 휴대폰에서 서버·Discord·Naver Cafe·CHZZK·저장소·SSE 상태와 활성 장애를 확인할 수 있습니다. 기존 PC Runtime Health/Incident Workflow를 별도 저장소 없이 재사용하며, 모바일 응답은 운영에 필요한 정보만 최소화합니다.

- Runtime Health: 전체 상태, Uptime, API 오류율, RSS 메모리, Event Loop P95, SSE 연결 수, 저장 복구/실패
- Service cards: Discord, Naver Cafe monitor, CHZZK live monitor, Storage, SSE 상태
- Incident Center: 활성 장애의 등급/상태/반복 횟수/최근 감지 시각과 최근 처리 타임라인
- 관리자 모바일: 장애 확인·담당자 지정, 해결 처리, 다시 열기
- 운영자 모바일: 동일한 상태를 **읽기 전용**으로 확인하며 incident owner/note/context는 전달하지 않음
- 진단 요약 복사: 이미 정제된 모바일 Health 모델만 클립보드에 복사

Live Control/Broadcast Hub는 Step 4의 SSE freshness 잠금을 그대로 유지합니다. 반대로 Incident Workflow는 Operations/Queue를 변경하지 않으므로, SSE 장애 자체가 발생한 상황에서도 관리자가 장애를 확인할 수 있도록 별도의 non-live mutation 경로를 사용합니다. 이 경로도 네트워크 연결, Basic Auth, CSRF, persistent idempotency, 관리자 권한 검사를 모두 유지하며 live revision header만 사용하지 않습니다.

데이터 스키마는 계속 v2이며 새 환경 변수, 영구 저장 파일, Discord Gateway Intent, Administrator 권한은 필요하지 않습니다.


## v4.14.4 · Step 5 — Mobile Broadcast Hub

`/mobile-control.html` 안에 **Broadcast Hub** 탭을 추가해 휴대폰 하나에서 기존 Live Control과 방송 운영 허브를 오갈 수 있습니다. PC 대시보드의 v4.13 Broadcast Operations 기능을 새 저장소나 별도 상태 없이 기존 API/JsonStore에 그대로 연결합니다.

- 방송 통계: 완료 회차, 누적 신청, 노쇼, CHZZK 방송 시작 감지 횟수
- 게임 프리셋: 기본/사용자 프리셋 확인, 사용자 프리셋 삭제, 현재 회차 설정 저장, 프리셋으로 새 모집 시작
- 방송 일정: 휴대폰에서 일정 등록, 프리셋 선택, 완료/취소/복원
- 시청자 투표: 질문과 2~8개 선택지로 새 투표 시작, 실시간 표 수/비율 확인, 투표 종료
- 통합 알림센터: CHZZK 방송, 일정, 시참, Naver Cafe, 시스템 알림을 모바일에서 켜고 끄기
- 최근 방송 타임라인: 운영 기록 + CHZZK 시작/종료 + Hub 변경 사항의 최근 12개 확인
- CHZZK 수동 상태 재확인 버튼

운영자 계정은 기존 `broadcast` 권한이 있어야 Broadcast Hub를 사용할 수 있습니다. 게임 프리셋으로 **새 모집을 시작하는 동작은 `broadcast + live`가 모두 필요**하며, 이미 진행 중인 회차가 있으면 모바일 UI에서도 시작 버튼을 잠급니다. 서버 권한 검사가 최종 권한 기준이므로 UI 우회만으로 권한을 늘릴 수 없습니다.

모바일 Hub 변경도 기존 Basic Auth, CSRF, persistent idempotency, SSE 연결 안전 모드를 재사용합니다. 일정·투표·알림 같은 BroadcastOps 전용 변경에는 Live Operations/Queue revision header를 보내지 않아 관련 없는 Queue 변경 때문에 잘못된 stale 오류가 발생하지 않게 했고, 실제 live session을 여는 프리셋 시작만 기존 revision guard를 사용합니다. 데이터 스키마는 계속 v2이며 새 Discord Gateway Intent나 Administrator 권한은 필요하지 않습니다.

## v4.14.3 · Step 4 — 동시 제어 안전장치 / 모바일 연결 안전 모드

PC 대시보드와 여러 모바일 Live Control 화면이 동시에 열려 있어도 **오래된 화면의 탭이 최신 방송 상태를 덮어쓰지 않도록** 낙관적 동시성 검사를 추가했습니다. 기존 관리자/운영자 권한, CSRF, persistent idempotency, Queue 직렬화와 함께 동작합니다.

- 모바일 변경 요청에 현재 Operations revision과 Participation Queue revision을 함께 전송
- 서버가 실제 revision과 다르면 변경 전에 `409 STALE_LIVE_STATE`로 중단
- revision-aware 요청은 직렬화한 뒤 다시 freshness를 검사해 동시에 도착한 두 화면의 TOCTOU 경쟁을 방지
- idempotency 처리를 freshness guard보다 먼저 적용해 이미 성공한 동일 요청의 재전송은 기존 결과를 안전하게 replay
- Queue 응답에 최신 Operations/Queue revision을 함께 반환해 호출·참가·패스 직후 잘못된 stale 판정을 방지
- 휴대폰이 오프라인이거나 SSE 연결이 끊겼거나 마지막 heartbeat/snapshot이 35초 이상 오래되면 변경 버튼 자동 잠금
- 연결 복구/수동 상태 새로고침 후에만 다시 조작 가능하며 mutation은 자동 재시도하지 않음
- 추첨, 빈자리 재추첨, 팀 재편성, 회차 종료, 노쇼는 터치 오조작 방지를 위해 명시적 확인 후 실행

이 기능은 모바일 Live Control이 revision header를 보낼 때만 활성화되므로 기존 PC 대시보드 API 계약과 호환됩니다. 데이터 스키마는 계속 v2이며 새 Discord Gateway Intent나 Administrator 권한은 필요하지 않습니다.

## v4.14.2 · Step 3 — 운영자 역할 / 위임 제어

관리자 비밀번호를 공유하지 않고 방송 진행 보조자에게 **Mobile Live Control**의 필요한 기능만 위임할 수 있습니다. 운영자 계정은 선택 사항이며, 아래 값을 비워 두면 v4.14.1과 동일하게 관리자 계정만 사용합니다.

```env
DASHBOARD_OPERATOR_USER=producer
DASHBOARD_OPERATOR_PASSWORD=replace_with_a_separate_12plus_password
DASHBOARD_OPERATOR_CAPABILITIES=live,queue,broadcast,discord
```

권한은 쉼표로 조합합니다.

- `live`: 현재 방송 회차 모집 마감/재개, 현재 회차 추첨, 출석, 대체 추첨, 팀 편성/재편성, 회차 종료 등 실시간 운영
- `queue`: 통합 시참 Queue 호출·상태·순서와 네이버 시참 순번 운영
- `broadcast`: CHZZK 상태 점검, 방송 운영 프리셋/일정/투표/알림, 방송 장면 제어
- `discord`: 현재 운영 상태의 Discord 안내 동기화

운영자 계정은 `/mobile-control.html`만 열 수 있습니다. 전체 관리자 대시보드, 코드 업데이트/롤백, 백업·복원, Discord 서버 설정/음성채널 구성, 닉네임 일괄 변경, Naver OAuth 연결/해제와 같은 고위험 관리 기능은 운영자 권한으로 열리지 않습니다. 방송 프리셋에서 새 모집을 시작하는 작업은 `broadcast`와 `live`가 모두 필요하며, 운영자 계정은 전체 등록 멤버를 대상으로 하는 독립 추첨을 실행할 수 없습니다.

운영자에게 전달되는 실시간 snapshot은 별도로 최소화됩니다. Discord User ID, Naver identity hash, 투표 voter hash, Naver cafe/menu/article ID, 호출 응답 토큰/메시지 참조, 전체 참가자 프로필, 당첨자 ID 배열 등은 제거하고 모바일 운영에 필요한 표시 이름·Queue 상태·집계값만 전달합니다. 관리자와 운영자 SSE 세션 및 idempotency scope도 사용자별로 분리됩니다.



## v4.14.1 · Step 2 — Participant Self-Service

Discord에서 발급한 1회용 로그인 코드로 시청자가 `/viewer/` 대시보드에 접속해 **자기 시참 상태만** 확인하고 직접 처리할 수 있습니다. 기존 레이스 색상/방송 투표 페이지를 통합 시청자 대시보드로 확장했습니다.

- 현재 모집 회차·게임·내 통합 Queue 상태·순번 표시
- 현재판 참가 / 신청 취소 / 다음판·다다음판 미루기
- 호출 중 `참가할게요 / 이번판 패스` 응답 및 남은 시간 표시
- 당첨 후 참석 확인 단계의 `준비 완료` 처리
- 다음판 예약 목록과 예약 취소
- 다른 참가자 이름·Discord ID·호출 응답 token은 시청자 API에 노출하지 않음
- 모든 변경은 기존 Operations + canonical Participation Queue를 사용하며 별도 상태 저장소를 만들지 않음
- 네트워크/Discord 전송 오류가 다음 참가자 자동 호출에서 발생해도 이미 저장된 `이번판 패스`를 실패로 되돌리지 않도록 호출 흐름을 보강

새 Discord Gateway Intent, Administrator 권한, 데이터 스키마, 환경 변수는 필요하지 않습니다.

## v4.14.0 · Step 1 — Mobile Live Control

- Open `/mobile-control.html` on a phone to operate the current broadcast round with large touch targets.
- The mobile page uses the same administrator Basic Auth as the main dashboard.
- PC and mobile controls stay synchronized through the existing `/api/events` SSE stream.
- Mobile quick actions include participant call, join/pass/no-show, recruitment close/reopen, draw, attendance, replacement draw, team assignment/reshuffle, Discord sync, and round end.
- The page only calls existing protected APIs, so CSRF, idempotency, state consistency, crash recovery, and atomic JSON persistence remain authoritative on the server.
- No new Discord permissions, privileged intents, data schema, or secrets are required.

## v4.13.7 · 이전 최종 기준

Discord 시참 모집, 참가자 프로필, 레이스·사다리·즉시 추첨, 참석 확인, 팀 편성, 회차 기록, OBS 방송 화면을 하나의 PC 운영 대시보드에서 관리하는 프로젝트입니다.





## v4.13.7 · Broadcast Operations Final — 최종 통합 검증

v4.13의 Step 1~7 기능을 하나의 최종 릴리스로 고정했습니다. 이번 버전은 새 방송 기능을 추가하지 않고, Discord/Naver/CHZZK/통합 시참 Queue/호출·노쇼/팀 편성/OBS Overlay/Broadcast Operations Hub가 같은 데이터 신뢰성 계층 위에서 함께 동작하는지 최종 회귀 검증합니다.

- Naver 메모 시참 순번과 Discord 참가자가 canonical Queue에 함께 합쳐지는지 검증
- Queue 순서/상태/호출 응답이 재시작 후 유지되는지 검증
- 모집 → 추첨 → 참석 확인 → 균형 팀 편성 → 회차 종료/아카이브 전체 흐름 검증
- CHZZK 방송 시작 전환이 Broadcast Operations Hub 통계/타임라인에 반영되고 저장되는지 검증
- 기존 crash recovery, idempotency, JSON atomic write/fsync, 손상 복구, Release Center Apply/Rollback 회귀 유지
- 데이터 스키마는 계속 v2이며 새 Discord Gateway Intent나 Administrator 권한을 요구하지 않음

운영 최종 게이트는 **Node.js >=22.22.2** 환경에서 `npm ci` 후 `npm run verify:final`이 `FINAL PASS`를 출력하는 것입니다. 제한된/오프라인 환경에서는 `npm run verify:final -- --core-only`를 사용할 수 있지만, 이는 외부 의존성이 필요한 통합 테스트를 대체하지 않습니다.



## v4.13.6 · Broadcast Operations Step 7 — 방송 운영 확장

Live Mode에 **Broadcast Operations Hub**를 추가했습니다. 방송 중 자주 사용하는 게임 운영 프리셋, 방송 일정, 시청자 투표, 누적 통계, 통합 알림센터, 방송 로그 타임라인을 한 화면에서 관리합니다.

- 기본 운영 프리셋: 칼바람 시참 / 협곡 내전 / 이터널 리턴 시참
- 현재 모집 설정을 사용자 프리셋으로 저장하고 Live Mode에서 바로 모집 시작
- 방송 일정 등록, 완료/취소/복원, 시작 시각 도달 시 1회 Discord 안내
- 시청자 대시보드 1인 1표 투표(Discord 사용자 ID는 SHA-256으로만 저장)
- 완료 회차, 누적 신청, 노쇼, CHZZK 방송 시작 감지 통계
- 운영 기록 + CHZZK 시작/종료 + Hub 변경사항을 합친 방송 타임라인
- CHZZK/Naver/일정 알림 라우팅을 한 곳에서 관리

새 영구 저장 파일:

```env
BROADCAST_OPS_FILE=./data/broadcast-ops.json
```

이 파일은 기존 JsonStore 신뢰성 계층을 사용하므로 commit 직렬화, atomic rename, fsync, `.bak/.tmp` 복구, 손상 파일 격리를 그대로 적용합니다. 새 Discord Gateway Intent나 Administrator 권한은 필요하지 않습니다.


## v4.13.5 · Broadcast Operations Step 6 — 치지직 방송 시작/종료 자동 감지

치지직 공식 Open API의 **라이브 목록 조회**를 Client 인증으로 주기 확인해 설정한 채널의 방송 시작/종료를 감지합니다. 첫 정상 조회는 현재 상태를 기준선으로만 저장하므로 봇 재시작이나 신규 배포 직후 이미 진행 중인 방송을 과거 이벤트처럼 다시 알리지 않습니다. 이후 `OFFLINE → LIVE` 또는 `LIVE → OFFLINE` 전환만 이벤트로 기록합니다.

공식 라이브 목록 API는 한 번에 최대 20개를 반환하고 `page.next`로 다음 페이지를 조회합니다. 현재 공식 요청 파라미터에는 특정 채널 ID 필터가 문서화되어 있지 않으므로, 이 프로젝트는 페이지를 순서대로 확인해 `CHZZK_CHANNEL_ID`를 찾습니다. `CHZZK_LIVE_SCAN_MAX_PAGES` 상한에 도달했는데 다음 페이지가 남아 있으면 **종료로 오판하지 않고 상태 미확정(unknown)** 으로 유지합니다.

방송 시작을 감지하면 Discord의 `🟡・방송안내` 채널을 우선 사용하고, 없으면 기존 `📜・로그` 채널로 안전하게 fallback 합니다. 시작 알림에는 방송 제목, 카테고리, 채널명, 감지 시점의 시청자 수, 썸네일, 치지직 링크가 포함됩니다. 종료 알림은 이전 라이브 스냅샷을 보존해 채널과 방송 정보를 유지합니다. 멘션 파싱은 사용하지 않습니다.

대시보드 Live Control에는 `CHZZK LIVE / OFFLINE / 상태 미확정 / 점검 실패` 상태와 수동 `방송 상태 확인` 버튼이 추가되었습니다. 서버가 방송 시작 전환을 감지하면 열려 있는 관리 대시보드는 자동으로 라이브 모드 탭으로 이동합니다. Runtime Health와 Recovery Audit에도 CHZZK API/전환 상태를 기록합니다.

```env
CHZZK_CLIENT_ID=
CHZZK_CLIENT_SECRET=
CHZZK_CHANNEL_ID=
CHZZK_MONITOR_ENABLED=false
CHZZK_MONITOR_INTERVAL_MINUTES=2
CHZZK_MONITOR_DISCORD_ALERTS=true
CHZZK_LIVE_SCAN_MAX_PAGES=50
CHZZK_LIVE_FILE=./data/chzzk-live.json
```

`CHZZK_CHANNEL_ID`는 32자리 채널 식별자입니다. 모니터를 처음 실행할 때 공식 채널 조회 API로 채널 존재 여부를 확인합니다. 허용 자동 점검 주기는 1/2/5/10/15분이며, API 오류 시 제한된 재시도와 backoff를 사용합니다. 저장 상태는 기존 JsonStore의 atomic write, fsync, `.bak/.tmp` 복구, 손상 파일 격리 계층을 그대로 사용합니다.

공식 문서:
- https://chzzk.gitbook.io/chzzk/chzzk-api/live
- https://chzzk.gitbook.io/chzzk/chzzk-api/channel
- https://chzzk.gitbook.io/chzzk/chzzk-api/tips

새 Discord Gateway Intent나 Administrator 권한은 필요하지 않습니다. 방송 알림 채널에는 기존 `View Channel / Send Messages / Embed Links` 권한이 필요합니다.

## v4.13.3 · Broadcast Operations Step 4 — 팀 자동 편성 고도화

팀 편성을 방송 운영 중 바로 조절할 수 있도록 `종합 균형 / 티어 균형 / 포지션 균형 / 완전 랜덤` 네 가지 방식을 추가했습니다. 기본값인 **종합 균형**은 티어 합계 편차, 협곡 주 라인 중복, 최근 회차에서 같은 팀이었던 조합을 함께 점수화해 가능한 범위에서 낮춥니다.

`이전 팀 중복 회피`는 최근 0/3/5/10/20회 중에서 선택할 수 있습니다. 종료된 같은 게임·같은 모드의 `sessionArchive` 팀 기록만 사용하며, 별도의 개인정보나 외부 전적 데이터는 저장하지 않습니다. `팀 재섞기`는 현재 팀 조합을 강한 회피 이력으로 추가해 같은 조합을 반복하지 않도록 다시 계산합니다.

팀 결과에는 편성 방식, 티어 편차, 라인 중복 수, 이전 같은 팀 pair 수가 `teamMeta`로 저장됩니다. 수동 팀원 교환을 하면 `manualAdjusted`가 기록되며, 회차 종료 시 해당 메타데이터도 아카이브에 함께 보존됩니다. 기존 팀원 교환, Discord 팀 결과 동기화, 음성방 생성은 그대로 유지됩니다.

라이브 모드 TEAM BOARD와 일반 운영 화면 모두에서 편성 방식과 최근 이력 범위를 선택할 수 있고, `팀 자동 편성 / 팀 재섞기` 버튼을 제공합니다. 협곡의 포지션 균형은 주 라인을 사용하며, 칼바람·이터널 리턴에서 포지션 전략을 선택하면 티어 균형 기준으로 안전하게 fallback 합니다.

새 Discord 권한이나 Gateway Intent는 추가하지 않았고 데이터 스키마는 v2를 유지합니다.


## v4.13.2 · Broadcast Operations Step 3 — 참가자 호출 / 응답 / 노쇼

통합 시참 Queue의 `called` 상태를 실제 방송 운영 흐름으로 연결했습니다. 라이브 모드에서 **다음 참가자 호출**을 누르면 Queue의 첫 `waiting` 참가자를 호출하고, Discord 참가자라면 기존 `🎟️・시참` 채널에 해당 사용자를 멘션하면서 `참가합니다 / 이번판 패스` 버튼을 표시합니다. 버튼은 호출된 Discord 사용자 본인만 사용할 수 있습니다.

기본 응답 제한시간은 60초이며 `PARTICIPATION_CALL_TIMEOUT_SECONDS`로 15~300초 범위에서 바꿀 수 있습니다. 제한시간이 끝나면 해당 참가자는 `no_show`로 기록되고 다음 `waiting` 참가자를 자동 호출합니다. `이번판 패스`는 `postponed_next`로 이동한 뒤 다음 참가자를 자동 호출합니다. `참가합니다`는 `joined`로 처리하고 자동 진행을 멈춰 진행자가 다음 호출 시점을 직접 선택할 수 있게 했습니다.

라이브 모드에는 현재 호출 대상과 남은 시간, `다음 참가자 호출 / 재호출 / 호출 취소`, 행별 `호출 / 참가 확인 / 노쇼` 제어가 추가되었습니다. Naver/대시보드 참가자는 Discord 사용자 ID가 없기 때문에 버튼 응답 대신 이름을 호출하고 진행자가 라이브 모드에서 참가 여부를 처리합니다.

호출 정보는 기존 `PARTICIPATION_QUEUE_FILE`에 함께 저장되며 deadline, attempt, Discord message reference가 재시작 후 복구됩니다. 응답용 임시 token은 저장소 내부에만 유지하고 대시보드/API Queue summary에서는 제거합니다. 재시작 시 미래 deadline은 다시 스케줄링하고 이미 지난 deadline은 no-show 처리 후 다음 참가자를 호출합니다.

```env
PARTICIPATION_QUEUE_FILE=./data/participation-queue.json
PARTICIPATION_CALL_TIMEOUT_SECONDS=60
```

새로운 Discord Gateway Intent나 권한은 요구하지 않습니다. 기존 `View Channel / Send Messages / Read Message History` 권한을 사용하며, 기존 원자적 JSON 저장·fsync·백업/손상 복구 계층도 그대로 사용합니다.


## v4.13.1 · Broadcast Operations Step 2 — 통합 시참 Queue

Discord, Naver, 대시보드에서 들어오는 참가자를 방송 운영용 **단일 canonical Queue**로 묶었습니다. Queue는 기존 추첨/session 데이터를 대체하지 않고 호환 계층으로 연결되므로, 기존 신청·예약·미루기·당첨·참석 로직은 그대로 유지됩니다.

Queue 상태는 `waiting / called / joined / postponed_next / postponed_next2 / cancelled / no_show`를 지원합니다. 이번 Step 2에서는 상태 모델과 수동 운영만 구현했으며, 자동 호출·응답 제한시간·자동 노쇼 처리는 Step 3에서 추가합니다.

대시보드 `🔴 라이브 모드`의 통합 Queue에서 직접 참가자를 추가하고, 순서를 위/아래로 조정하고, 다음판/다다음판 미루기, 복귀, 취소를 처리할 수 있습니다. Discord 참가자는 현재 모집이 열려 있을 때 기존 operation 상태와 양방향으로 맞춰집니다. Naver 메모 순번도 같은 Queue view에 표시됩니다.

```env
PARTICIPATION_QUEUE_FILE=./data/participation-queue.json
```

Queue 파일은 기존 JsonStore의 직렬화 commit queue, 원자적 rename, fsync, `.bak/.tmp` 복구, 손상 파일 격리를 그대로 사용합니다. Discord는 기존 user ID만 사용하고, Naver/대시보드 이름 기반 identity는 정규화 후 SHA-256 키로 저장해 불필요한 외부 식별자 수집을 피합니다.



## v4.13.0 · Broadcast Operations Step 1 — 방송 라이브 모드

방송 중 복잡한 관리 화면을 오가지 않도록 대시보드에 **🔴 라이브 모드**를 추가했습니다. 현재 회차, 게임, 유효 신청자/필요 인원, 당첨/참석, 예약/미루기, Discord 연결, 실시간 SSE 상태를 한 화면에서 확인할 수 있습니다.

라이브 모드에서는 현재 회차 상태에 맞춰 사용할 수 있는 버튼만 활성화합니다. `모집 마감 / 모집 다시 열기 / 추첨 시작 / 참석 확인 / 빈자리 재추첨 / 팀 자동 편성 / Discord 동기화 / 팀 음성방 생성 / 회차 종료`를 큰 버튼으로 제공하며, 기존 operation API의 idempotency, 상태 일관성, 원자적 저장 보호를 그대로 사용합니다.

진행 중인 회차가 없으면 `칼바람 시참 / 협곡 내전 / 이터널 리턴` 빠른 시작 프리셋으로 즉시 모집을 열 수 있습니다. 빠른 시작은 각각 기존 모집 폼을 안전한 기본값으로 채운 뒤 동일한 `/api/operations/open` 흐름을 호출합니다.

참가 현황, 당첨/참석 상태, 팀 편성, 최근 운영 기록도 라이브 모드에 요약해 방송 중 필요한 정보만 빠르게 볼 수 있습니다. OBS 화면은 기존 `/broadcast/`를 그대로 사용합니다.

이번 단계에서는 새로운 Discord 권한이나 Gateway Intent를 추가하지 않았으며 데이터 스키마도 v2를 유지합니다.


## v4.12.5 · 대시보드 버튼 기반 칼바람 시참 운영

대시보드 `설정` 화면의 **칼바람 시참 순번** 패널을 버튼 중심 운영 흐름으로 정리했습니다. `칼바람 시참 열기`를 누르면 서버 봇이 공식 카페 글쓰기 API로 메모 게시판에 제목/내용 `칼바람 시참`을 입력하고 접수를 엽니다. 이후 신청자 이름을 적고 `참가 등록`을 누르면 요청이 서버에 도착한 순서대로 1, 2, 3... 순번을 원자적으로 저장합니다.

운영 버튼은 `칼바람 시참 열기 / 참가 등록 / 참가 취소 / 마감 / 초기화`로 분리했습니다. `마감`은 현재 순번 목록을 그대로 보존하면서 등록·취소를 잠그고, `초기화`는 현재 세션과 순번을 최근 이력에 보관한 뒤 새 접수 준비 상태로 되돌립니다. 취소된 번호는 재사용하지 않습니다.

순번은 네이버 댓글을 읽어서 만들지 않습니다. 현재 NAVER Developers 공식 카페 API는 **카페 가입과 게시글 쓰기**를 제공하지만 댓글 작성/댓글 목록 API는 문서화되어 있지 않습니다. 따라서 실제 댓글 순서를 자동 수집하거나 대시보드에서 댓글을 직접 쓰는 기능은 비공식 스크래핑·쿠키 자동화로 우회하지 않습니다. `메모글 열기 + 댓글 문구 복사`는 수동 댓글 작성을 보조하는 기능만 제공합니다.

```env
NAVER_CAFE_ID=
NAVER_MEMO_MENU_ID=
NAVER_PARTICIPATION_FILE=./data/naver-participation.json
```

순번 파일은 기존 JsonStore의 원자적 쓰기, `.bak/.tmp` 복구, fsync, 동시 commit 직렬화를 그대로 사용합니다. 동일 이름의 활성 중복 등록은 막고, 취소된 번호는 재사용하지 않습니다. 메모글 POST 도중 프로세스가 종료되어 결과를 확정할 수 없으면 `uncertain` 상태로 복구하고 자동 재게시하지 않습니다.

## v4.12.3 · Deployment Readiness Step 4 — Railway Healthcheck / Graceful Shutdown

v4.12.3은 Railway 배포 준비 점검 중 발견된 healthcheck 차단 문제를 수정한 패치입니다. 기존 `/api/health`는 관리자 Basic Auth 뒤에 있고 Discord 진단까지 수행하므로 Railway 배포 healthcheck 용도로 사용하지 않습니다. 대신 인증이 필요 없는 경량 `/healthz`를 추가했습니다. 서버가 요청을 받을 준비가 되면 HTTP 200, graceful shutdown drain 상태에서는 HTTP 503을 반환합니다. 응답에는 상태, readiness, 앱 버전만 포함하며 비밀값이나 운영 데이터는 노출하지 않습니다.

Railway Service Settings의 Healthcheck Path는 **`/healthz`** 로 설정하세요. 앱은 Railway가 주입하는 `PORT`를 사용하고 `HOST=0.0.0.0`으로 실행해야 합니다. Volume을 사용하는 서비스는 재배포 시 짧은 중단이 발생할 수 있으므로 graceful shutdown 및 데이터 flush가 중요합니다.

## v4.12.2 · Naver Integration Step 3 — 운영 안정화

v4.12.2는 v4.12.1의 공식 NAVER 연동과 공개 카페글 모니터를 운영 환경에 맞게 강화한 안정화 릴리스입니다. 기능 범위는 공식 NAVER Open API 안에서 유지하며 비공식 스크래핑, 우회 로그인, 브라우저 자동화는 추가하지 않습니다.

- 공개 카페글 Search API는 `429 / 5xx / timeout / 일시적 네트워크 실패`에 한해 최대 2회까지 제한적으로 재시도합니다. `Retry-After`가 있으면 최대 30초 범위에서 존중합니다.
- 카페 가입/글쓰기는 중복 부작용을 막기 위해 `POST` 자체를 5xx에서 자동 재시도하지 않습니다. 명시적인 `401`만 토큰을 한 번 갱신한 뒤 1회 재요청합니다.
- 만료 임박 토큰을 여러 요청이 동시에 발견해도 refresh 요청은 single-flight로 합쳐 한 번만 수행합니다.
- NAVER upstream `401 / 403 / 429 / 5xx`를 구분해 Runtime Health에 반영하고, 모니터 실패는 Recovery Audit에 제한된 상태 코드/오류 메타데이터만 기록합니다.
- Discord 로그 채널이 삭제되었거나 보기/전송 권한이 없거나 Discord 연결이 준비되지 않은 경우 새 글 이벤트를 잃지 않고 `failed`로 남겨 관리자가 원인 해결 후 재전송할 수 있습니다.
- `NAVER_MENU_ID`만 단독 설정하는 잘못된 구성을 시작 단계에서 차단하고, `NAVER_TOKEN_KEY`는 32바이트(64자리 HEX 또는 Base64)인지 fail-fast 검증합니다.
- `/api/naver/status`는 모니터 상태 요약과 요청 정책을 함께 노출해 대시보드/진단에서 connector 상태를 일관되게 확인할 수 있습니다.

공식 문서 기준 카페글 Search API는 `query`가 필수이고 `display<=100`, `start<=1000`, `sort=sim|date`를 지원합니다. Search API 처리한도는 25,000회/일이며, 카페 API 처리한도는 계정당 가입 50회/일, 글쓰기 200회/일입니다.

## v4.12.1 · Naver Cafe Integration Step 2

v4.12.1은 v4.12.0의 공식 NAVER OAuth/카페 가입/글쓰기/공개 카페글 검색 기반 위에 **공개 카페글 감시 → Discord 로그 채널 알림 → 대시보드 상태/이력 관리**를 추가합니다. 비공식 카페 페이지 스크래핑이나 브라우저 자동화를 사용하지 않습니다.

### 새 공개글 모니터 동작

- NAVER의 공식 카페글 Search API를 `sort=date`로 주기 조회합니다.
- 공식 Search API는 `query`가 필수이므로 모니터 검색어도 반드시 설정해야 합니다.
- 특정 카페만 감시할 경우 `NAVER_MONITOR_CAFE_URL=https://cafe.naver.com/...`을 설정합니다. Search API 결과의 공식 `cafeurl` 필드와 정확히 비교해 다른 카페 검색 결과를 제외합니다.
- 첫 실행은 현재 결과를 **기준선**으로만 저장하고 Discord에 과거 글을 대량 전송하지 않습니다.
- 이후 새 URL만 SHA-256 키로 중복 제거해 Discord `로그` 채널에 알립니다. Discord mention parsing은 비활성화되어 게시글 제목에 `@everyone` 같은 문자열이 있어도 멘션으로 동작하지 않습니다.
- 알림 전송 도중 프로세스가 비정상 종료되어 결과가 확정되지 않은 항목은 `uncertain`으로 복구합니다. 자동 재전송하지 않아 중복 가능성을 낮추며, 대시보드에서 관리자가 직접 재전송할 수 있습니다.
- 실패 시 다음 자동 점검은 제한된 지수 backoff를 적용하며 최대 1시간을 넘지 않습니다.

### 모니터 환경변수

```env
NAVER_MONITOR_ENABLED=false
NAVER_MONITOR_QUERY=
NAVER_MONITOR_CAFE_URL=https://cafe.naver.com/yourcafe
NAVER_MONITOR_INTERVAL_MINUTES=5
NAVER_MONITOR_DISCORD_ALERTS=true
NAVER_MONITOR_FILE=./data/naver-monitor.json
NAVER_PARTICIPATION_FILE=./data/naver-participation.json
```

`NAVER_MONITOR_INTERVAL_MINUTES`는 `1, 5, 15, 30, 60` 중 하나입니다. Search API 공식 일일 한도는 Client ID당 25,000회이며, 1분 간격 단일 쿼리는 하루 1,440회 수준입니다. 여러 별도 모니터를 자동 생성하지 않고 한 개의 명시적 검색 조건만 유지하도록 설계했습니다.

### 대시보드

`설정 → 새 공개글 감시·Discord 알림`에서 검색어, 대상 카페 URL, 점검 간격, 자동 감시, Discord 알림을 저장할 수 있습니다. `지금 점검`은 즉시 공식 Search API를 1회 호출하며, 최근 감지 이벤트와 전송 상태(`sent / failed / uncertain / suppressed`)를 표시합니다. `failed` 또는 `uncertain`은 관리자가 명시적으로 Discord 재전송할 수 있습니다.

### 공식 API 범위 제한

NAVER 카페글 Search API는 **공개 검색 결과**를 반환하는 API이며, 특정 카페의 모든 새 글을 직접 스트리밍하는 webhook이나 카페 `clubid` 전용 신규글 목록 API로 문서화되어 있지 않습니다. 따라서 v4.12.1 모니터는 **검색어 + 선택적 cafeurl 필터** 방식입니다. 비공개 게시판, 댓글, 공지 관리 기능은 추가하지 않습니다.


## v4.12.0 · Naver Cafe Integration Step 1

v4.12.0은 v4.11.6 Final의 Discord bot + 관리 대시보드에 **네이버 카페 공식 Open API 연동**을 추가한 첫 통합 릴리스입니다. 비공식 로그인, 쿠키 탈취, 페이지 스크래핑, 브라우저 자동화 우회는 사용하지 않습니다.

### 이번 버전에서 실제로 지원하는 네이버 기능

- NAVER 로그인 OAuth 2.0 연동 / access token 갱신 / 연동 해제
- 연동된 NAVER 계정 프로필 확인
- 네이버 **공개 카페글 검색**
- 지정 카페 가입 요청
- 지정 카페 게시판에 게시글 작성
- Discord/운영 감사 로그와 NAVER 작업 로그 통합
- 대시보드 `설정` 화면에서 NAVER 연결 상태와 기능 실행

현재 NAVER Developers 공식 카페 API에는 **카페 가입과 게시글 쓰기**가 제공되며, 카페글 검색은 Search API로 제공됩니다. 댓글 작성/삭제 및 공지 지정/해제 관리 API는 공식 카페 Open API 범위에 없으므로 이 프로젝트에서 자동화하지 않습니다.

### 네이버 설정 방법

1. NAVER Developers에서 애플리케이션을 등록합니다.
2. **네이버 로그인**과 사용할 **카페 API 권한**을 활성화합니다.
3. Callback URL을 정확히 등록합니다. 로컬 PC 기본 예시는 `http://127.0.0.1:3000/naver/callback`입니다. 외부 배포에서는 HTTPS URL을 사용합니다.
4. `.env` 또는 배포 환경변수에 다음 값을 넣습니다. 실제 Secret은 GitHub나 ZIP에 넣지 않습니다.

```env
NAVER_CLIENT_ID=
NAVER_CLIENT_SECRET=
NAVER_REDIRECT_URI=http://127.0.0.1:3000/naver/callback
NAVER_CAFE_ID=
NAVER_MENU_ID=
NAVER_MEMO_MENU_ID=
NAVER_TOKEN_KEY=
NAVER_AUTH_FILE=./data/naver-auth.json
NAVER_MONITOR_ENABLED=false
NAVER_MONITOR_QUERY=
NAVER_MONITOR_CAFE_URL=
NAVER_MONITOR_INTERVAL_MINUTES=5
NAVER_MONITOR_DISCORD_ALERTS=true
NAVER_MONITOR_FILE=./data/naver-monitor.json
NAVER_PARTICIPATION_FILE=./data/naver-participation.json
```

5. `NAVER_TOKEN_KEY`는 32바이트 난수 키를 사용합니다. 예: 자신의 PC에서 `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` 실행 후 나온 값을 배포 Secret에 저장합니다.
6. 봇을 시작한 뒤 대시보드 → `설정` → `네이버 카페 연동`에서 `네이버 계정 연동`을 실행합니다.
7. NAVER Developers에 등록한 Callback URL과 `NAVER_REDIRECT_URI`가 문자 단위로 동일해야 합니다.

OAuth 토큰은 `NAVER_TOKEN_KEY`로 AES-256-GCM 암호화한 뒤 `NAVER_AUTH_FILE`에 저장합니다. 토큰, Client Secret, 게시글 본문은 Recovery Audit/Runtime 로그에 기록하지 않습니다. `data/**`는 `.gitignore`에 포함되어 있습니다.

### 공식 API 처리 한도

- 카페글 검색: Client ID 기준 Search API **25,000회/일**
- 카페 가입: NAVER 계정당 **50회/일**
- 카페 글쓰기: NAVER 계정당 **200회/일**

### v4.12.0에서 하지 않는 것

- 카페 댓글 자동 작성/삭제
- 카페 공지 지정/해제
- NAVER ID/비밀번호 자동 로그인
- 쿠키 복사, 세션 탈취, CAPTCHA 우회
- 비공식 HTML 스크래핑을 이용한 운영 기능

이 기능이 향후 공식 API로 제공될 경우에만 공식 방식으로 확장합니다.

## v4.11.6 최종 통합 검증

v4.11.6은 v4.11 Data & Reliability Finalization의 **최종 검증 릴리스**입니다. Step 1~6에서 구현한 JSON 동시 저장 직렬화, API idempotency, 비정상 종료 복구, 예약/추첨/session 일관성, 파일 손상 복구, fsync/원자적 쓰기 순서를 기능 추가 없이 다시 묶어 검증합니다. 데이터 스키마는 v2를 유지합니다.

- `npm run verify:final`을 추가했습니다. 정상 최종 검증은 **Node.js >=22.22.2**와 `npm ci`로 설치된 실제 의존성을 요구합니다.
- 검증기는 `express`, `discord.js`, `dotenv/config`, `jsdom` 설치 상태를 먼저 확인한 뒤 정적 검사와 전체 `node --test`를 실행합니다.
- 제한된 오프라인/샌드박스 환경에서는 `npm run verify:final -- --core-only`로 외부 의존성 없이 실행 가능한 회귀군만 확인할 수 있습니다. 이 모드는 정상 Final PASS를 대신하지 않습니다.
- v4.11.5 기준으로 dependency-independent 회귀 **189/189 PASS**와 `npm run check` **113 JavaScript files PASS**를 확인했습니다.
- 현재 검증 샌드박스는 Node v22.16.0이며 `express`, `discord.js`, `dotenv`, `jsdom`을 설치할 네트워크가 없어 외부 의존성 통합 테스트 7개는 이 환경에서 정상 실행할 수 없습니다. 배포 환경에서는 `npm ci` 후 `npm run verify:final`을 1회 실행하세요.
- Discord 권한, Gateway Intent, Administrator 권한, 토큰 저장 방식은 변경하지 않았습니다.

### 권장 최종 배포 절차

1. Node.js 22.22.2 이상을 사용합니다.
2. 기존 운영 `data/`와 `config.local.json`을 별도로 백업합니다.
3. 새 코드 폴더에서 `npm ci`를 실행합니다.
4. `npm run verify:final`을 실행해 `FINAL PASS`를 확인합니다.
5. 전체 ZIP 교체 방식이라면 기존 `data/`와 `config.local.json`을 유지한 채 코드를 교체합니다.
6. Update JSON을 사용할 경우 Release Center에서 Stage 결과와 base drift 0을 확인한 뒤 적용합니다.
7. `SIGNED REQUIRED` 정책에서는 운영자가 보유한 Ed25519 private key로 패키지를 다시 서명하거나 전체 ZIP 교체를 사용합니다. 개인키는 프로젝트나 로그에 포함하지 않습니다.

### v4.11 단계 완료 상태

- Step 1: JSON 동시 저장 / 파일 경로 단위 commit queue
- Step 2: 중복 API 요청 / HTTP idempotency
- Step 3: 비정상 종료 / process lock / persistent idempotency recovery
- Step 4: 예약·추첨·session 의미적 일관성
- Step 5: 파일 손상 감지 / backup·temp salvage / fail closed
- Step 6: fsync / 원자적 쓰기 / backup consistency
- Final: 통합 회귀 / Release Center Stage·Apply·Rollback / 최종 산출물 검증

### v4.11.5에서 v4.11.6으로 업데이트

이번 릴리스는 런타임 데이터 스키마를 변경하지 않습니다. 함께 제공되는 Update JSON은 운영 Ed25519 개인키가 작업 환경에 없으므로 **`daengdaeng-update-v2` 무서명 strong-integrity** 형식입니다. Release Center가 `SIGNED REQUIRED`이면 전체 ZIP을 사용하거나 운영 환경의 기존 개인키로 다시 서명해야 합니다.

## 4.10 핵심 업데이트

v4.10은 v4.9의 Runtime Health와 Discord Policy Monitor를 하나의 **Incident Workflow**로 묶습니다. 새 장애를 미확인 큐에서 보고, 담당자를 지정해 확인 처리하고, 해결/재오픈 이력을 남길 수 있습니다. 반복 또는 장시간 미해결 장애는 자동으로 CRITICAL로 승격됩니다. 데이터 스키마는 계속 v2이며 기존 `data`와 `config.local.json`을 그대로 사용할 수 있습니다.

- `🚨 장애 워크플로` 전용 실시간 대시보드 추가
- Runtime Health warn/error와 Discord Policy drift를 하나의 미해결 Incident 큐로 통합
- 장애 상태를 `OPEN / ACKNOWLEDGED / RESOLVED`로 관리
- 담당자와 확인/해결 메모 기록
- 동일 Runtime 장애가 3회 이상 반복되거나 15분 이상 미해결이면 CRITICAL 자동 승격
- Discord MANUAL drift는 CRITICAL, SAFE-only drift는 WARNING으로 분류
- Maintenance Mode 동안 Policy drift의 escalation을 보류하고, 종료 후 남아 있으면 즉시 재평가
- Runtime 이벤트가 10분 이상 새로 발생하지 않으면 자동 해소 처리
- 수동 해결 이후 과거 Runtime 이벤트만 남아 있을 때 동일 장애가 즉시 재오픈되는 문제 방지
- 장애 Workflow Timeline에 등록/승격/확인/해결/재오픈/자동 해소 이력 기록
- Control Center 운영 경고에 미확인/CRITICAL Incident 수 연동
- Production Readiness에서 CRITICAL Incident가 있으면 FAIL, 미확인 WARNING이 있으면 WARN
- 진단 JSON에는 Incident 상태/코드/횟수만 포함하고 상세 오류 문자열은 제외
- `data/incidents.json`은 별도 파일로 분리하고 `.bak` 자동 복구 및 Runtime 저장 진단을 그대로 적용
- Startup Preflight에서 Discord Policy/Incident 저장 경로 쓰기 권한도 함께 점검

### 권장 운영 흐름

1. `런타임·장애`와 Discord Policy Monitor가 이상을 감지하면 `장애 워크플로`에 Incident가 생성됩니다.
2. 새 Incident는 `확인·담당`으로 담당자와 메모를 남깁니다.
3. 원인을 해결한 뒤 `해결 처리`를 사용합니다. 같은 원인이 실제로 다시 발생하면 새 이벤트를 기준으로 다시 열립니다.
4. 계획 작업 중 Discord drift는 Maintenance Mode를 사용합니다. 기록은 유지되지만 escalation은 보류됩니다.
5. 배포 전 `배포 준비`에서 Incident Workflow가 PASS인지 확인합니다.

### v4.9에서 v4.10으로 업데이트

v4.9의 Signed Release 체인을 그대로 사용합니다. 함께 제공되는 **v3 Ed25519 서명 Update JSON**을 Release Center에서 검증·적용하거나 전체 ZIP으로 교체할 수 있습니다. 전체 ZIP 교체 시 기존 `data` 폴더와 `config.local.json`을 유지하세요. `data/incidents.json`은 첫 실행 시 자동 생성됩니다.

## 4.9 핵심 업데이트

v4.9는 v4.8 Policy Monitor를 **운영 경고 라우팅 + 계획 작업 관리 + drift 확인 처리**까지 확장합니다. Discord 설정을 자동으로 확대하거나 권한을 추가하지 않으며, 데이터 스키마는 계속 v2입니다. 기존 `data`, `config.local.json`, Policy Baseline, Change Journal을 그대로 사용할 수 있습니다.

- Discord 알림 라우팅을 `OFF / MANUAL drift만 / SAFE+MANUAL 전체`로 분리
- drift 해소 알림을 별도 ON/OFF 설정
- 15 / 30 / 60 / 120분 **Maintenance Mode** 추가
- Maintenance 동안 drift 비교와 Journal 기록은 계속하지만 Runtime 경고와 Discord 로그 알림은 보류
- 점검 시간이 끝나면 자동 해제하고, drift가 남아 있으면 다음 점검부터 다시 경고
- 현재 drift digest 단위 **확인(Acknowledge)** 처리와 120자 메모 지원
- 확인된 drift는 Control Center에서 일반 경고와 분리해 표시하고 Discord 반복 알림을 보류
- drift digest가 바뀌거나 해소되면 확인 상태를 자동 해제
- 점검 시작/종료와 확인/해제를 Change Journal 및 관리자 감사 로그에 기록
- 외부 알림을 보류한 횟수와 최근 보류 사유를 대시보드에 표시
- v4.8에서 `지금 점검` 직후 API가 **점검 전 monitorState**를 반환해 마지막 점검 시간이 잠시 이전 값으로 보일 수 있던 오류 수정
- Discord 알림 전송 오류가 남은 뒤 알림 라우팅을 OFF로 바꿔도 실패 문구가 계속 남던 상태 오류 수정
- Maintenance/확인 해제 뒤 drift가 그대로 남아 있으면 Runtime Health 경고를 다시 승격하도록 수정
- 기존 v4.8 `discordAlerts: true/false` 설정은 자동으로 `ALL/OFF` 라우팅으로 호환

### 권장 운영 흐름

1. 정상 Discord 상태를 Policy Baseline으로 저장합니다.
2. 자동 감시는 기본 5분을 유지하고 Discord 알림 범위를 선택합니다. 일반 운영에서는 `MANUAL drift만`이 과도한 로그를 줄이기 좋습니다.
3. 계획된 채널/명령 작업을 시작하기 전 Maintenance Mode를 켜고 사유와 시간을 지정합니다.
4. 작업 중 drift는 사라지지 않고 Journal에 남지만 외부 경고는 보류됩니다.
5. 작업이 끝난 뒤 Maintenance를 종료합니다. 기준선과 다르면 경고가 다시 활성화됩니다.
6. 의도된 변경을 당장 기준선에 반영하지 않을 경우 `현재 drift 확인 처리`로 현재 digest만 확인할 수 있습니다. drift 내용이 달라지면 자동으로 다시 미확인 상태가 됩니다.

### v4.8에서 v4.9으로 업데이트

v4.8의 Signed Release 체인을 그대로 사용합니다. 함께 제공되는 **v3 Ed25519 서명 Update JSON**을 Release Center에서 검증·적용하거나 전체 ZIP으로 교체할 수 있습니다. 전체 ZIP 교체 시 기존 `data` 폴더와 `config.local.json`을 유지하세요. `discord-policy.json`은 기존 형식을 읽고 새 Alert Routing / Maintenance / Acknowledgement 필드를 필요할 때 안전하게 추가합니다.

## 4.8 핵심 업데이트

v4.8은 v4.7의 Discord Policy Baseline을 **수동 확인 중심에서 자동 감시 중심으로 확장**합니다. 데이터 스키마는 계속 v2이며 기존 `data`, `config.local.json`, 기준선과 Change Journal을 그대로 사용할 수 있습니다.

- `🛡️ Discord 권한 감사` 화면에 **Policy Monitor · Alert Center** 추가
- 자동 점검 간격은 1 / 5 / 15 / 30 / 60분 중 선택, 기본값은 **5분**
- 서버 시작 후 기준선이 있으면 Monitor가 자동으로 예정 시간을 계산하고 최신 Discord 상태를 재조회
- 자동 Monitor는 Discord 채널·역할·명령을 **절대 자동 변경하지 않음**. 수정은 기존 SAFE Fix + 2단계 승인 경로만 사용
- drift 발생·변경·해소를 Runtime Health 장애 타임라인에 연결
- Control Center 운영 경고에도 Policy drift 또는 Monitor 점검 오류를 표시
- 선택적으로 `📜・로그` 채널에 drift/해소 알림 전송 가능. 기본값은 OFF
- Discord 알림은 상태가 실제로 바뀌었을 때만 전송하고 `allowedMentions`를 비워 역할/사용자 ping을 방지
- Monitor 비교 실패와 Discord 로그 알림 전송 실패를 별도 상태로 기록
- 메인 SSE snapshot에 Monitor 상태를 포함해 여러 관리자 화면에서 즉시 동기화
- Audit Log 조회는 기존과 동일하게 선택 기능이며 `VIEW_AUDIT_LOG` 권한이 없더라도 기준선 비교와 Monitor는 정상 동작

### 자동 감시 사용 순서

1. Discord 권한 감사에서 현재 상태를 확인하고 정상 상태를 **Policy Baseline**으로 저장합니다.
2. `자동 감시`를 켜고 1/5/15/30/60분 중 간격을 선택합니다. 기본 5분이 권장값입니다.
3. 필요한 경우 `Discord 로그 알림`을 켭니다. `📜・로그` 채널에 메시지를 보낼 수 있을 때만 전송됩니다.
4. 즉시 확인하려면 `지금 점검`을 사용합니다.
5. drift가 발견돼도 Monitor가 자동 수정하지 않습니다. SAFE 항목만 별도 2단계 승인으로 복구하고 MANUAL 항목은 직접 검토합니다.

Discord 공식 문서는 Audit Log 조회에 `VIEW_AUDIT_LOG`가 필요하고 기록은 45일 보관된다고 안내합니다. 이 프로젝트는 변경 주체 표시만 이 선택 권한에 의존하고, Policy 비교 자체에는 요구하지 않습니다. Discord API rate limit 값은 하드코딩하지 않고 discord.js의 REST 처리와 낮은 빈도의 Monitor 스케줄을 사용합니다.

공식 참조:
- https://docs.discord.com/developers/resources/audit-log
- https://docs.discord.com/developers/topics/rate-limits

### v4.7에서 v4.8으로 업데이트

v4.7의 Signed Release 체인을 그대로 사용합니다. 함께 제공되는 **v3 Ed25519 서명 Update JSON**을 Release Center에서 검증·적용하거나 전체 ZIP으로 교체할 수 있습니다. 전체 ZIP 교체 시 기존 `data` 폴더와 `config.local.json`을 유지하세요. `discord-policy.json`의 기존 기준선과 Journal은 그대로 이어집니다.

### v4.8에서 같이 수정한 문제

1. **기준선에 `/연동` 또는 `/setting`이 없고 현재도 없는데 command drift로 오인할 수 있던 문제**: 양쪽 모두 없으면 차이 없음으로 처리합니다.
2. **기준선에는 없던 프로젝트 명령이 새로 생겼을 때 SAFE 복구로 되돌릴 위험**: 새로 등장한 명령은 MANUAL drift로 분류해 자동 삭제/덮어쓰기를 하지 않습니다.
3. **첫 drift가 `감지`가 아니라 `변경`으로 기록될 수 있던 상태 전이 오류**: 이전 Policy 상태를 기준으로 정확히 `감지 → 변경 → 해소`를 기록합니다.
4. **동일한 비교 결과에서도 정책 파일이 반복 저장될 수 있던 문제**: digest가 같으면 디스크 update 자체를 건너뜁니다.
5. **Audit Log 60초 캐시가 첫 조회의 `sinceAt`으로 잘려 이후 더 오래된 기준선 조회에서 항목을 놓칠 수 있던 문제**: 캐시에는 관련 최근 이벤트 전체를 저장하고 반환 시점에 기준 시간으로 필터링합니다.
6. **Discord 로그 알림 전송 실패가 Monitor 비교 자체 실패로 취급될 수 있던 문제**: 비교 성공과 알림 전송 실패를 분리해 drift 상태는 유지하고 알림 오류만 별도로 표시합니다.
7. **DemoDiscordService에 실서비스 클라이언트를 참조하는 중복 dead method가 남아 있던 문제**: 연습 모드 구현을 정리해 실제 Discord client에 의존하지 않도록 수정했습니다.

## 4.7 핵심 업데이트

v4.7은 v4.6의 Permission Audit + Safe Fix 위에 **정상 기준선(Policy Baseline)과 변경 이력(Change Journal)** 을 추가합니다. 데이터 스키마는 계속 v2이며 기존 `data`와 `config.local.json`을 유지할 수 있습니다.

- `🛡️ Discord 권한 감사` 화면에 **Discord 정상 기준선** 패널 추가
- 프로젝트 핵심 채널, Guild Command, 봇 역할 권한, Gateway Intent, Developer Portal 플래그, Guild Install 설정을 정규화해 SHA-256 기준선으로 저장
- 기준선 대비 변경을 `SAFE / MANUAL`로 비교하고 digest로 고정
- 누락 핵심 채널과 `/연동`·`/setting` drift만 기존 Safe Fix 범위에서 기준선 복구 가능
- 채널 이름/위치/topic/permission overwrite, 역할 권한, Intent, 설치 정책은 자동 복구하지 않음
- 기준선에서 식별한 **채널 ID를 우선 추적**해 핵심 채널 이름이 바뀌어도 `누락`으로 오인해 중복 생성하지 않도록 수정
- `data/discord-policy.json`에 기준선과 최대 300개의 변경 Journal 저장
- 같은 drift digest는 반복 기록하지 않아 15초 대시보드 갱신으로 Journal이 불필요하게 증가하지 않음
- `View Audit Log` 권한이 있을 때 최근 Discord Audit Log를 보조적으로 조회해 채널/역할 변경 주체를 표시
- `View Audit Log`는 핵심 기능 필수 권한에 추가하지 않음. 권한이 없어도 기준선 비교와 Safe Fix는 정상 동작
- 기준선 SAFE 복구도 최신 상태 재조회 + plan digest + 기존 2단계 승인으로 보호
- 현재 운영 방향에 맞춰 구형 전투 추첨·전용 관리 화면을 제거하고 추첨 모드를 **자동차 레이스 / 사다리 / 즉시 추첨**으로 정리
- 기존 저장 데이터에 남아 있는 구형 경기 기록은 삭제하지 않고 결과 요약만 읽을 수 있도록 하위 호환 처리
- 시청자 꾸미기 화면은 전투 캐릭터 대신 **레이스 색상 프로필**로 단순화

### 기준선 사용 순서

1. Discord 권한 감사와 Safe Fix를 먼저 확인합니다.
2. FAIL/BLOCKED/SAFE 항목을 정리한 뒤 `현재 상태를 정상 기준선으로 저장`을 누릅니다.
3. 이후 같은 화면에서 기준선 대비 drift와 변경 Journal을 확인합니다.
4. SAFE drift가 있으면 `SAFE drift 복구`를 실행할 수 있습니다.
5. MANUAL drift는 서버 운영자의 의도된 변경일 수 있으므로 자동으로 덮어쓰지 않습니다.

### 변경 주체 표시

Discord Audit Log 조회는 `View Audit Log` 권한이 있을 때만 사용합니다. 이 권한은 **선택 기능**이며 프로젝트의 권장 최소 설치 permission에는 포함하지 않습니다. Discord는 Audit Log 항목을 45일 동안 보관하므로 그 범위 안에서만 변경 주체를 보조적으로 연결할 수 있습니다.

### v4.6에서 v4.7으로 업데이트

v4.6의 Signed Release 체인을 그대로 사용합니다. 함께 제공되는 **v3 서명 Update JSON**을 Release Center에서 검증·적용하거나 전체 ZIP을 교체할 수 있습니다. 전체 ZIP 교체 시 기존 `data` 폴더와 `config.local.json`을 유지하세요. 새 `discord-policy.json`은 최초 실행 시 자동 생성됩니다.

### v4.7에서 같이 수정한 문제

1. **핵심 채널 이름이 바뀌면 기존 v4.6 감사가 채널을 찾지 못해 누락으로 판단할 수 있던 문제**: 저장된 기준선의 채널 ID를 우선 추적해 동일 채널을 계속 식별합니다.
2. **이름이 바뀐 기존 핵심 채널 옆에 Safe Fix가 새 채널을 만들 가능성**: 기준선 ID로 찾은 채널은 `MANUAL 이름 drift`로 처리하고 자동 생성 대상에서 제외합니다.
3. **Discord 설정이 바뀌어도 이전 정상 상태를 기억하지 못하던 문제**: 기준선 snapshot + SHA-256 digest 비교를 추가했습니다.
4. **15초 자동 갱신마다 동일 변경을 Journal에 반복 저장할 수 있는 문제**: 비교 digest가 실제로 변할 때만 Journal을 추가합니다.
5. **변경 원인을 확인하려고 View Audit Log를 필수 권한으로 올릴 위험**: 주체 표시를 선택 기능으로 분리하고 기존 최소 권한 모델을 유지했습니다.
6. **이전 프로젝트 방향과 달리 남아 있던 구형 전투/전용 관리 경로**: 신규 추첨에서는 제거하고 레이스·사다리·즉시 추첨만 허용하도록 정리했습니다. 기존 저장 기록은 결과 확인용으로만 유지합니다.

## 4.6 핵심 업데이트

v4.6은 v4.5의 Discord Permission Audit을 **진단 → Dry Run → 선택적 안전 수정** 흐름으로 확장합니다. 데이터 스키마는 계속 v2이며 기존 `data`와 `config.local.json`을 그대로 사용할 수 있습니다.

- `🛡️ Discord 권한 감사` 화면 안에 **Discord Drift & Safe Fix** 패널 추가
- 실제 Discord 상태와 프로젝트 기준의 차이를 `SAFE / MANUAL / BLOCKED`로 분류
- 누락된 핵심 `🎮 시참` 카테고리/`시참·내전·로그` 채널만 최소 범위로 생성 가능
- `/연동`, `/setting` Guild Slash Command의 누락·설명·기본 권한 drift를 안전하게 동기화
- 다른 Guild Command는 삭제하지 않음
- Administrator 제거, 역할 hierarchy, Developer Portal scope/Intent, 채널 permission overwrite는 자동 수정하지 않음
- 채널 overwrite 자동 수정에 필요한 `ManageRoles`를 새로 요구하지 않아 기존 최소 권한 모델 유지
- Safe Fix 적용 전 **Plan digest + 2단계 승인 문구**로 실제 적용 대상을 고정
- 승인 후 Discord 상태가 바뀌면 TOCTOU 방지를 위해 적용을 중단하고 Dry Run 재계산 요구
- 적용 전후 Permission Audit을 다시 실행하고 관리자 감사 로그에 기록
- Demo 모드에서는 Dry Run만 표시하고 Discord 설정 변경은 차단

### 자동 수정 범위

v4.6이 자동으로 바꾸는 항목은 의도적으로 좁습니다.

1. **핵심 채널 생성**: 누락된 핵심 카테고리/텍스트 채널만 생성합니다. 기존 채널 이름, 기존 overwrite, 다른 카테고리는 수정하지 않습니다.
2. **프로젝트 Slash Command 동기화**: `/연동`, `/setting`만 생성 또는 수정합니다. 다른 명령은 건드리지 않습니다.

다음 항목은 영향 범위가 크거나 Discord Developer Portal/역할 설정이 필요하므로 `MANUAL`로만 안내합니다.

- Administrator 제거 또는 역할 권한 변경
- 봇 역할 순서 변경
- Privileged Intent 토글
- Guild Install scope/permission 변경
- 채널 permission overwrite 변경
- 잘못된 `ADMIN_ROLE_ID` 교체

### v4.5에서 v4.6으로 업데이트

v4.5의 Signed Release 체인을 그대로 사용합니다. 함께 제공되는 **v3 서명 Update JSON**을 Release Center에서 검증·적용하거나 전체 ZIP을 교체할 수 있습니다. 전체 ZIP 교체 시 기존 `data` 폴더와 `config.local.json`을 유지하세요.

### v4.6에서 같이 수정한 문제

1. **감사 결과에서 문제를 발견해도 어떤 항목이 자동 수정 가능한지 구분하기 어려운 문제**: SAFE/MANUAL/BLOCKED 분류와 Dry Run을 추가했습니다.
2. **누락된 Guild Command를 고치려면 재시작 때 전체 Guild Command overwrite에 의존하던 문제**: 대시보드에서 프로젝트 소유 명령만 개별 생성·수정할 수 있게 했습니다.
3. **`/연동`에 잘못된 default member permission이 남아도 기존 감사가 명확히 drift로 다루지 않던 문제**: Safe Fix 계획이 제한을 제거해 기본 공개 명령 상태로 되돌립니다.
4. **채널 권한 문제를 자동 수정하려고 `ManageRoles`를 추가하면 최소 권한 원칙이 깨질 수 있는 위험**: channel overwrite는 MANUAL로 고정하고 자동 권한 상승을 금지했습니다.
5. **Dry Run 이후 Discord 설정이 바뀐 상태에서 오래된 계획을 적용할 수 있는 시간차 위험**: Plan digest를 승인과 적용 양쪽에서 다시 검증합니다.

## 4.5 핵심 업데이트

v4.5는 v4.4의 공급망 보호 위에 **Discord 권한·Intent·설치 구성 감사 계층**을 추가합니다. 데이터 스키마는 계속 v2이며 기존 `data`와 `config.local.json`을 그대로 사용할 수 있습니다.

- 관리자 사이드바에 `🛡️ Discord 권한 감사` 센터 추가
- 실제 봇 역할의 `ManageChannels`, `ManageNicknames` 서버 권한 검사
- 시참/내전/로그 채널에서 permission overwrite까지 적용된 최종 권한 검사
- 현재 코드가 사용하는 Gateway Intent와 Developer Portal privileged intent 플래그 비교
- 현재 구조는 `Guilds` Intent만 필요하며 `GuildMembers`, `GuildPresences`, `MessageContent`는 사용하지 않음
- Guild Install, `bot`, `applications.commands` scope와 기본 설치 permission 점검
- `/연동`, `/setting` Guild Command 등록 상태 점검
- `ADMIN_ROLE_ID` 역할 존재 여부 및 `/setting` 런타임 권한 검사
- Administrator 권한이 있으면 과도 권한으로 경고
- 권장 최소 설치 permission 정수와 scopes를 대시보드에 표시
- 권한 감사 결과를 Self-Check와 Production Readiness에 반영

### 권장 최소 Discord 권한

이 프로젝트는 Administrator를 요구하지 않습니다. 기본 설치 권한은 아래 기능만 포함하는 구성이 권장됩니다.

- Manage Channels: `/setting` 채널/카테고리 생성, 팀 음성방 생성
- Manage Nicknames: 관리자 대시보드 닉네임 적용
- View Channel / Send Messages: 모집·결과·로그 전송
- Embed Links: 모집/참석/결과 카드 전송
- Read Message History: 기존 안내 메시지 재사용·수정

Slash Command는 Guild Command로 등록되며 `/setting`은 `ADMIN_ROLE_ID`가 없으면 기본적으로 Manage Guild 권한을 요구합니다. `ADMIN_ROLE_ID`를 설정한 경우에도 서버 코드에서 해당 역할 또는 Manage Guild 권한을 다시 검사합니다.

## 4.4 핵심 업데이트

v4.4는 v4.3의 서명 릴리스 체인 위에 **npm 의존성 공급망 검증 계층**을 추가합니다. 데이터 스키마는 계속 v2이며 기존 `data`와 `config.local.json`을 그대로 사용할 수 있습니다.

- 관리자 사이드바에 `📦 의존성·공급망` 센터 추가
- `package.json`과 `package-lock.json` 직접 의존성 일치 검사
- npm lockfile v3, 패키지 이름/버전 정합성 검사
- Registry 패키지의 SHA-512 `integrity` 누락 또는 비정상 형식 차단
- `git:`, `http:`, `file:`, `link:` 등 비정상 직접 의존성 소스 차단
- 루트 `preinstall/install/postinstall/prepare` 등 자동 설치 lifecycle script 차단
- lockfile의 `hasInstallScript` 패키지 탐지 및 대시보드 경고
- 직접 의존성, install script 패키지, 라이선스 분포와 lock digest 표시
- `daengdaeng-sbom-v1` JSON SBOM 다운로드 지원
- Release Center가 `package.json` 또는 `package-lock.json` 변경 업데이트를 스테이징할 때 두 파일을 함께 검사
- 신규 직접 의존성, 버전 범위 변경, 제거, 신규 install script를 Release 검증 항목에 표시
- 공급망 오류가 있는 업데이트는 스테이징 차단, 적용 직전 다시 검사
- 배포 후 Smoke Test에 현재 공급망 상태 포함
- Windows 자동 설치 전에 lockfile을 먼저 검증하고 `npm ci --ignore-scripts`로 설치

### v4.3에서 v4.4로 업데이트

v4.3은 이미 `daengdaeng-update-v3`와 내장 Ed25519 신뢰 키를 지원하므로, 함께 제공되는 **서명된 v3 Update JSON**을 Release Center에서 바로 검증·적용할 수 있습니다. Trust Policy가 `SIGNED REQUIRED`여도 내장 발행자 키로 검증됩니다. 전체 ZIP 교체 방식도 그대로 지원합니다.

### v4.4에서 같이 수정한 문제

1. **서명된 업데이트라도 package.json과 package-lock.json이 서로 다른 의존성을 선언할 수 있던 문제**: 두 파일을 공급망 단계에서 함께 검증합니다.
2. **Release Center가 신규 패키지나 install script 도입을 파일 Diff로만 보여주던 한계**: 의존성 의미 단위 Diff와 신규 install script 경고를 추가했습니다.
3. **시작 스크립트가 lockfile 공급망 검증 전에 npm 설치를 시도하던 구조**: 설치 전에 lockfile/출처/integrity를 검증합니다.
4. **패키지 적용 후 버전 Smoke Test는 있었지만 공급망 상태를 확인하지 않던 문제**: Smoke Test에 공급망 검사를 추가했습니다.

> v4.4의 공급망 검사는 프로젝트 파일과 lockfile을 로컬에서 검증합니다. 온라인 취약점 데이터베이스 조회(`npm audit`)는 자동으로 수행하지 않습니다.

## 4.3 핵심 업데이트

v4.3은 v4.2의 SHA-256/Manifest/트랜잭션 무결성 위에 **업데이트 발행자 신뢰와 Ed25519 디지털 서명**을 추가합니다. 해시만 있는 패키지는 내용이 변조됐는지는 확인할 수 있지만, 누가 만든 패키지인지는 증명하지 못합니다. v4.3의 `daengdaeng-update-v3`는 패키지 Manifest를 Ed25519 개인키로 서명하고, 대시보드는 내장/사용자 신뢰 공개키와 대조합니다. 데이터 스키마는 계속 v2입니다.

- 새 `daengdaeng-update-v3` 서명 패키지 형식 추가
- v2의 기준 SHA-256, 전체 base Manifest, TOCTOU 재검증, 트랜잭션 저널을 그대로 유지
- Ed25519 서명 검증과 공개키 fingerprint/keyId 검증 추가
- 패키지에 포함된 공개키가 신뢰되지 않았으면 서명 자체가 유효해도 스테이징 차단
- 관리자 `릴리스·업데이트` 화면에 **Release Trust Center** 추가
- 내장 발행자 키 + 사용자 추가 공개키를 `data/releases/trusted-keys.json`에 별도 저장
- 신뢰 키 추가/삭제와 Trust Policy 변경은 localhost + 2단계 승인 필요
- `WARN` 정책은 v1/v2 호환 패키지를 경고와 함께 허용하고, `SIGNED REQUIRED`는 신뢰된 v3 패키지만 허용
- 스테이징 때 통과한 서명을 실제 적용 직전에 다시 검증해 신뢰 키 제거/정책 변경/패키지 변경을 차단
- Release History와 상단 지표에 SIGNED/TRUSTED/keyId 상태 표시
- `npm run release:keygen`으로 사용자가 별도 Ed25519 발행 키를 생성 가능
- `npm run release:bundle -- <새버전폴더> --sign-key <private.pem>`으로 v3 서명 Update JSON 생성 가능
- v3 `channel`은 `stable` 또는 `beta`만 허용하며 잘못된 channel/createdAt 메타데이터는 패키지 생성·검증 단계에서 차단
- 개인키는 `data/` 아래 또는 별도 빌드 PC에 보관하고 ZIP/Update JSON/로그에 포함하지 않음


### 자체 릴리스 키로 다음 버전 서명하기

```bash
npm run release:keygen
npm run release:bundle -- ../discord-game-roster-bot-v4.4 daengdaeng-update-4.3.0-to-4.4.0.json --sign-key data/release-signing/<keyId>-private.pem --channel stable --key-name "My Release Publisher"
```

생성된 `*-public.pem`만 Release Trust Center에 등록합니다. `*-private.pem`은 업데이트를 만드는 PC에만 보관하고 공유하거나 프로젝트 ZIP에 넣지 않습니다.

### v4.2에서 v4.3으로 업데이트

v4.2 Release Center는 v3 형식을 알지 못하므로 이번 전환용 Update JSON은 **v2 STRONG 형식**으로 제공합니다. v4.3으로 재시작한 뒤부터는 다음 버전의 v3 서명 패키지를 검증할 수 있습니다. 전체 ZIP으로 교체하는 방식도 그대로 사용할 수 있습니다.

### v4.3에서 같이 수정한 문제

1. **SHA-256 값까지 다시 작성한 위조 패키지를 발행자 관점에서 구분할 수 없던 한계**: v3 Ed25519 서명과 신뢰 키로 패키지 출처를 검증합니다.
2. **스테이징 후 신뢰 키가 삭제되거나 Trust Policy가 바뀌어도 기존 staged package가 적용될 수 있는 위험**: 적용 직전에 서명/신뢰 정책을 전체 재검증합니다.
3. **서명 키가 아직 신뢰되지 않았을 때 단순 실패만 보여 운영자가 무엇을 등록해야 하는지 알기 어려운 문제**: 유효한 미신뢰 서명의 fingerprint와 candidate key를 검증 결과에 제공하고 대시보드에서 2단계 승인 후 신뢰할 수 있습니다.
4. **사용자 자체 릴리스 키 생성 절차 부재**: Ed25519 키 생성 스크립트와 signed bundle 생성 옵션을 추가했습니다.

## 4.2 핵심 업데이트

v4.2는 v4.1 Release Center의 업데이트 기능을 실제 장애 상황에 더 안전하게 만든 **Integrity Release Pipeline** 단계입니다. 데이터 스키마는 계속 v2이며 기존 `data`와 `config.local.json`을 그대로 사용할 수 있습니다.

- 새 `daengdaeng-update-v2` 패키지는 변경/삭제 파일의 **업데이트 전 기준 SHA-256**을 포함합니다.
- 패키지 생성 시 전체 기준 코드의 Manifest digest도 함께 기록합니다.
- 스테이징 시 현재 설치 코드가 기준 Manifest와 다르면 로컬 수정(drift)으로 보고 적용을 차단합니다.
- 스테이징 후 파일이 바뀌는 경우를 막기 위해 실제 적용 직전에 기준 SHA-256과 전체 Manifest를 다시 검사합니다.
- 모든 파일 전환 후 대상 SHA-256과 삭제 상태를 다시 검증한 뒤에만 `restart-required`로 전환합니다.
- 적용/롤백 도중 강제 종료나 전원 문제에 대비해 `data/releases/transaction-journal.json` 트랜잭션 저널을 사용합니다.
- 다음 시작에서 미완료 트랜잭션을 발견하면 코드 rollback snapshot을 검증한 뒤 자동 복구를 시도합니다.
- rollback snapshot 파일도 SHA-256을 기록해 손상된 코드 백업을 그대로 복원하지 않습니다.
- v4.1에서 만든 `daengdaeng-update-v1` 패키지는 계속 받을 수 있지만 대시보드에 `LEGACY`로 표시됩니다.
- `npm run release:bundle -- <새 버전 폴더>`는 기본적으로 v2 패키지를 만들며, v4.1에 적용할 호환 패키지는 `--legacy`를 붙여 생성합니다.

### v4.1에서 v4.2로 업데이트

전체 ZIP으로 교체해도 되고, v4.1 Release Center가 이미 설치되어 있다면 함께 제공되는 `daengdaeng-update-4.1.0-to-4.2.0.json`을 사용할 수 있습니다. 이 한 번의 전환 패키지는 v4.1이 이해할 수 있도록 **v1 호환 형식**으로 제공됩니다. v4.2 이후에 생성되는 다음 업데이트부터는 기본 v2 강한 무결성 형식을 사용합니다.

### v4.2에서 같이 수정한 오류

1. **로컬에서 수정한 소스를 버전 문자열만 같다는 이유로 덮어쓸 수 있던 위험**: v2 기준 SHA-256과 전체 Manifest 검증으로 차단합니다.
2. **스테이징 뒤 파일이 바뀌는 시간차 문제**: 실제 파일 교체 직전에 무결성을 다시 검사합니다.
3. **파일 교체 중 프로세스가 강제 종료되면 반쯤 새 버전인 상태가 남을 수 있던 문제**: 트랜잭션 저널과 시작 시 자동 복구를 추가했습니다.
4. **잘못된 새 패키지 검증 후 이전 staged package가 남아 적용될 수 있던 혼동**: 검증 실패 시 기존 staged package를 즉시 폐기합니다.
5. **검증 실패의 세부 항목이 브라우저에서 사라지던 문제**: HTTP 오류 응답의 구조화된 checks를 UI가 그대로 표시합니다.

## 4.1 핵심 업데이트

v4.1은 v4.0의 Production Readiness 위에 **Release & Update Center**를 추가합니다. 앞으로 전체 ZIP을 매번 덮어쓰는 대신, ChatGPT가 제공하는 DaengDaeng Update JSON 패키지를 관리자 대시보드에서 검증·비교·적용하고 실패 시 이전 코드 파일로 되돌릴 수 있는 기반입니다. 데이터 스키마는 v2를 유지합니다.

- 관리자 사이드바에 `⬆️ 릴리스·업데이트` 센터 추가
- 업데이트 패키지의 기준 버전/대상 버전/schema/허용 경로/SHA-256/manifest digest 검증
- `src/`, `public/`, `scripts/`, `test/` 및 안전한 루트 파일만 코드 업데이트 허용
- `data/`, `.env`, `config.local.json`, `node_modules`, `.git` 및 프로젝트 밖 경로 업데이트 차단
- 심볼릭 링크 경로를 통한 프로젝트 외부 파일 변경 차단
- 현재 코드와 패키지의 추가/수정/삭제/동일 파일 Diff 표시
- 코드 적용은 localhost에서만 허용하고 2단계 승인 문구 요구
- 적용 직전에 운영 데이터 수동 백업 + Recovery 복원 지점 자동 생성
- 변경/삭제 파일의 코드 롤백 스냅샷 보존
- 다중 파일 업데이트 도중 실패하면 이미 변경된 파일을 자동 원복
- 파일 적용 후 재시작 필요 상태를 명시하고 새 버전 시작 시 자동 Smoke Test
- Smoke Test에서 실행 버전, package.json 버전, operations/registrations 읽기 상태 확인
- Smoke 실패 시 대시보드에서 이전 코드 파일 복원 후 재시작 가능
- 현재 설치 코드의 SHA-256 manifest 다운로드 지원
- `npm run release:bundle -- <새 버전 폴더>`로 다음 버전용 Update JSON 생성 지원

### 업데이트 패키지 적용 흐름

1. `릴리스·업데이트`에서 Update JSON 선택
2. `패키지 검증·스테이징` 실행
3. 파일 Diff와 배포 준비 상태 확인
4. `2단계 승인 후 업데이트 적용` 실행
5. 자동 운영 데이터 백업 및 코드 rollback snapshot 생성
6. 파일 적용 완료 후 실행 창을 종료하고 `START.cmd` 다시 실행
7. 새 버전 시작 시 자동 Smoke Test 결과 확인
8. 실패 시 같은 화면에서 `이전 코드로 롤백` 후 다시 시작

코드 업데이트 기능은 원격 관리 기능으로 사용하지 않습니다. 서버가 `0.0.0.0` 등 외부 인터페이스에 바인딩되어 있으면 적용/롤백 API를 차단하고, localhost에서만 실행할 수 있습니다. 업데이트 JSON에는 Bot Token, 대시보드 비밀번호, BROADCAST_TOKEN 또는 `data` 폴더가 포함되지 않습니다.

## 4.1에서 같이 수정한 오류

### 1. 사용자 지정 HTTP 상태 코드가 400으로 평탄화될 수 있던 문제

Runtime Health 오류 분류기가 일부 명시적 4xx 상태를 무시하고 일반 400 검증 오류로 응답할 수 있었습니다. v4.1에서는 안전하게 지정된 400~499 상태를 유지합니다. Release Center의 localhost 제한도 403으로 정확히 응답합니다.

### 2. 코드 업데이트 중간 실패 시 일부 파일만 새 버전으로 남을 수 있는 문제

초기 구현 검토 중 다중 파일 적용의 후반부에서 파일 쓰기가 실패하면 앞에서 이미 교체한 파일이 남을 수 있는 위험을 발견했습니다. 최종 v4.1은 실패 시 rollback snapshot을 역순으로 적용해 앞선 변경까지 자동 복원하며, 자동 복원 자체가 실패하면 별도 위험 상태로 표시합니다.

### 3. 심볼릭 링크를 통한 보호 경로 우회 가능성

문자열 경로 검사만으로는 프로젝트 내부 경로가 심볼릭 링크를 통해 외부 파일을 가리키는 경우를 막기 어렵습니다. 적용 전에 실제 경로 구성 요소를 검사해 심볼릭 링크가 포함된 업데이트 경로를 차단합니다.


## 4.0 핵심 업데이트

v4.0은 v3.9의 Runtime Health와 Performance & Capacity 위에 **실제 배포 직전 점검, 실행 프로필, 자동 백업 보존, Soak Test, graceful shutdown**을 통합한 Production Readiness & Deployment Center를 추가합니다. 기존 데이터 스키마는 v2를 유지하므로 v3.9의 `data` 폴더를 그대로 사용할 수 있습니다.

- 관리자 사이드바에 `🚀 배포 준비` 센터 추가
- 시작 전에 Node.js 최소 버전, 실행 프로필, 네트워크 노출, 관리자 인증, 데이터/백업 경로 쓰기 권한, 디스크 여유, 포트 사용 가능 여부 검사
- `production`, `development`, `demo` 실행 프로필 분리
- Windows `START.cmd` / `DEV.cmd` / `DEMO.cmd` 제공
- `npm run dev`도 실제 development 프로필(`--dev`)로 실행되도록 정합성 수정
- 참가자/운영 데이터의 자동 배포 백업 보존 정책 추가
- 기본 24시간 간격 자동 백업, 14개 / 30일 보존 정책
- 수동 `지금 배포 백업 생성` 지원
- 백업 파일은 Bot Token, 대시보드 비밀번호, BROADCAST_TOKEN을 포함하지 않음
- Runtime Health를 5초 단위로 관찰하는 1~60분 Soak Test 추가
- API 5xx, 저장 실패, API 오류 증가, Event Loop P95를 테스트 결과에 반영
- 배포 준비도에 Startup Preflight, Self-Check, Runtime Health, Capacity, 최근 백업, Soak Test를 통합
- SIGINT/SIGTERM에서 신규 변경 요청 차단 → SSE/타이머 정리 → HTTP 요청 최대 10초 대기 → Discord 연결 종료 순으로 graceful shutdown

## 4.0에서 같이 수정한 오류

### 1. graceful shutdown 중 Discord 연결을 너무 일찍 끊을 수 있던 문제

기존 구현은 종료 신호를 받으면 HTTP 요청이 끝나기 전에 Discord client를 먼저 종료할 수 있었습니다. 진행 중인 관리자 요청이 Discord API를 사용하는 경우 실패할 수 있으므로, v4.0에서는 먼저 새 요청을 막고 HTTP 요청을 최대 10초 기다린 뒤 Discord 연결을 마지막에 종료합니다.

### 2. 복원/위험 작업 중 자동·수동 배포 백업이 섞일 수 있던 문제

복구 작업이 참가자 파일과 운영 파일을 순서대로 교체하는 짧은 구간에 자동 백업이 실행되면 서로 다른 시점의 두 파일을 묶을 가능성이 있었습니다. `busy` 작업 중 주기 백업을 건너뛰고, 수동 배포 백업 API도 409로 대기하도록 수정했습니다.

### 3. 보존 기간이 지난 백업이 새 백업 생성 전까지 남을 수 있던 문제

최신 백업이 자동 생성 간격 안에 있으면 기존 `ensureRecent()`가 바로 반환해 오래된 백업 정리가 지연될 수 있었습니다. 이제 새 백업 생성 여부와 관계없이 먼저 보존 정책을 적용합니다.

### 4. 중지한 Soak Test에서 5xx/저장 실패가 발생해도 배포 판정이 단순 경고가 될 수 있던 문제

수동으로 중지한 테스트라도 이미 서버 오류 또는 저장 실패를 관측했다면 결과를 `fail`로 유지하고 Production Gate도 실패로 판정합니다.

### 5. `npm run dev`가 development 프로필을 보장하지 않던 문제

Windows `DEV.cmd`는 `--dev`를 전달했지만 npm의 `dev` 스크립트는 watch 모드만 켜고 프로필 인자를 전달하지 않았습니다. 이제 `npm run dev`도 `node --watch src/index.js --dev`로 실행됩니다.

## 3.9 핵심 업데이트

v3.9는 v3.8 Runtime Health 위에 **성능 추세와 수용량을 장시간 관측하는 Performance & Capacity Center**를 추가합니다. 장애가 발생한 뒤 확인하는 것뿐 아니라, 느려지거나 용량 한계에 접근하는 상태를 사전에 확인하는 단계입니다.

- 15초 간격, 최대 1시간 메모리 RSS / Event Loop P95 / API 누적 상태 추세 수집
- 최근 15분 API P95/P99, 분당 요청량, 오류율 계산
- 500ms 이상 API를 경로별로 묶어 P95/평균/최대 지연 표시
- 메모리 증가는 최소 5분 이상 관측한 뒤 시간당 증가량으로 평가
- 관리자 SSE `12`, 방송 SSE `8` 연결 한도와 실시간 사용률 표시
- registrations / operations / recovery JSON 파일 실제 크기와 참가자 수 확인
- JSON 저장소 합계 25MB부터 주의, 100MB부터 위험 표시
- 상태별 Capacity Advisor 권장 조치 제공
- 추세 샘플에는 참가자 프로필/닉네임/Discord ID나 요청 본문을 저장하지 않음
- 통합 진단 JSON에 Performance & Capacity 요약 포함

## 3.9에서 같이 수정한 오류

### 1. 방송 SSE write 실패 시 heartbeat 정리가 늦어질 수 있던 문제

방송 화면의 snapshot 또는 heartbeat 전송 중 `res.write()`가 실패해도 기존 구현은 Set에서 즉시 정리되지 않거나 heartbeat가 연결 종료 이벤트까지 남을 여지가 있었습니다. v3.9는 방송 SSE도 관리자 SSE와 동일하게 연결별 closer를 사용해 write 실패 시 타이머와 연결을 즉시 정리합니다.

### 2. Runtime Health 화면에 metrics 컨테이너가 중복되어 있던 마크업 오류

`runtime` 페이지 시작 부분에 동일한 metrics 컨테이너가 연속으로 두 번 열려 레이아웃 DOM 구조가 비정상적으로 중첩될 수 있었습니다. 중복 태그를 제거했습니다.

### 3. Self-Check가 관리자 SSE만 보고 방송 SSE 포화 상태는 놓치던 문제

OBS Browser Source를 여러 개 열어 방송 SSE 8개 한도에 접근해도 기존 Self-Check에는 관리자 SSE만 표시됐습니다. v3.9부터 방송 SSE 용량도 별도 점검합니다.

## 3.8 핵심 업데이트

v3.8은 v3.7의 Operations Guard & Safe Deploy를 유지하면서 **실행 중 장애를 빠르게 발견하고 원인을 추적하는 Runtime Health & Incident Center**를 추가한 단계입니다.

- 관리자 사이드바에 `런타임·장애` 센터 추가
- API 요청/오류율/5xx/평균 응답시간/상태코드 집계
- Discord 작업 호출 수/실패 수/평균 지연/작업별 호출 집계
- JSON 저장 성공/실패 및 `.bak` 자동 복구 횟수와 파일별 상태 집계
- 관리자 SSE 연결/해제/재연결/브라우저 지연 감지 통계
- 운영 스케줄러 실행/실패/평균 처리시간 집계
- Node.js 메모리와 Event Loop P95/평균/최대 지연 표시
- `api`, `discord`, `storage`, `sse`, `scheduler`, `system` 소스별 장애 타임라인과 심각도 필터
- 동일 장애는 60초 동안 묶어서 횟수를 누적해 로그 폭주 방지
- warn/error 런타임 이벤트를 기존 감사 로그의 `runtime` 카테고리로 연결
- Bot Token/대시보드 비밀번호/BROADCAST_TOKEN/CSRF/Authorization 및 참가자 원본 데이터를 제외한 진단 JSON 내보내기
- 메인 Control Center에도 Runtime Health `주의/장애` 상태를 운영 경고로 표시

## 3.8에서 같이 수정한 오류

### 1. SSE 전송 실패 후 heartbeat 타이머가 남을 수 있던 문제

클라이언트 연결이 끊긴 순간 snapshot 전송에서 `res.write()`가 실패하면 기존 코드는 Set에서는 제거할 수 있어도 해당 연결의 heartbeat 정리가 보장되지 않았습니다. v3.8은 연결별 closer를 관리해 snapshot/heartbeat 어느 쪽에서 오류가 나도 타이머와 스트림을 함께 정리합니다.

### 2. 저장소/Discord 내부 실패가 일반 400 요청 오류로 표시될 수 있던 문제

파일 시스템 오류와 Discord API 오류를 일반 입력 오류와 구분합니다. 저장소 장애는 HTTP 500, Discord 처리 실패는 502로 분류하고 Runtime Health에 원인을 기록합니다. `TypeError`/`ReferenceError`/`RangeError` 같은 내부 프로그램 오류도 500으로 분류해 실제 버그가 잘못된 사용자 입력으로 숨지 않도록 했습니다.

### 3. 손상된 JSON을 `.bak`에서 복구해도 운영자가 알기 어려웠던 문제

JsonStore에 비침투식 observer를 추가했습니다. 자동 복구, 읽기 실패, 쓰기 실패를 Runtime Health에 기록하되 진단 코드 자체가 저장 동작을 중단시키지 않도록 예외를 격리했습니다.

### 4. 브라우저 측 실시간 연결 품질을 서버에서 확인하기 어려웠던 문제

클라이언트가 SSE 재연결, 오류, 45초 stale 상태, 2초 이상 수신 지연을 최소 정보만 서버에 보고하도록 했습니다. 보고 실패는 UI나 실제 운영 동작을 방해하지 않습니다.

## 3.7 핵심 업데이트

v3.7은 v3.6의 Recovery & Audit Center를 기반으로 **업데이트 직전 보호, 데이터 마이그레이션, 변경 Diff, 위험 작업 2단계 승인, 업데이트 후 자동 점검**을 추가한 운영 안전성 단계입니다.

- 프로그램 버전 또는 데이터 스키마 변경을 감지하면 기존 운영 데이터가 있는 경우 **업데이트 직전 자동 복원 지점** 생성
- 운영 데이터에 `schemaVersion`과 `appVersion`을 기록하고 오래된 상태를 현재 스키마로 자동 마이그레이션
- 방송 설정/프리셋/자동화, 요청/추첨/아바타 배열 등 오래된 운영 상태를 안전하게 정규화
- 복원한 과거 데이터도 현재 실행 버전에 맞춰 자동 마이그레이션 후 적용
- `복구·감사` 화면에 **Operations Guard / Safe Deploy** 패널 추가
- 업데이트 전 기준점과 현재 상태 사이의 비밀값 제외 **설정 변경 Diff** 표시
- 복원 지점 적용, 전체 백업 복원, 복원 지점 삭제, 수동 마이그레이션에 **2분 유효 2단계 승인 문구** 적용
- 승인 요청은 작업 종류와 대상 digest/revision에 묶이고 한 번 사용하면 즉시 폐기
- 정상 복원 지점이 하나만 남은 경우 마지막 복원 지점 삭제 차단
- 백업 복원 시 현재 프로그램보다 새로운 데이터 스키마는 사전 검증 단계에서 차단
- 버전 업데이트가 실제로 수행된 경우 시작 과정에서 자동 Self-Check를 실행하고 결과를 `safeDeploy.postUpdateCheck`와 감사 로그에 기록
- 앱 버전을 `src/version.js` 한 곳에서 관리해 API/패키지 버전 불일치를 방지

## 3.7에서 같이 수정한 오류

### 1. 오래된 복원 지점을 적용하면 현재 프로그램이 다시 예전 스키마 상태로 돌아갈 수 있던 문제

v3.6 복원은 저장된 운영 객체를 그대로 되돌렸기 때문에, 이후 버전에서 스키마가 확장되면 과거 복원 지점을 적용한 직후 일부 신규 필드가 없는 상태가 될 수 있었습니다. v3.7은 복원 대상 데이터를 먼저 현재 스키마로 변환한 뒤 저장하고, Safe Deploy 메타데이터는 현재 실행 상태를 유지합니다.

### 2. 마이그레이션 검사에서 `session: null`을 매번 변경으로 판단할 수 있던 문제

초기 구현 점검 중 기본값 처리 함수가 `null`도 미설정 값으로 취급해, 정상적인 `session: null` 상태에서도 마이그레이션이 계속 필요하다고 표시될 수 있음을 발견했습니다. 이제 실제 `undefined` 필드만 기본값 생성 대상으로 처리합니다.

### 3. 마지막 정상 복원 지점까지 삭제할 수 있던 문제

복구 센터에서 모든 복원 지점을 제거하면 장애 시 즉시 되돌릴 안전 지점이 사라질 수 있었습니다. v3.7은 정상 복원 지점이 하나만 남아 있으면 삭제를 차단하고 새 복원 지점을 먼저 만들도록 안내합니다.

### 4. 관리자/게임 스튜디오에 이전 v3.6 버전 문구가 남아 있던 문제

사이드바와 게임 스튜디오의 표시 버전을 v3.7 Operations Guard 기준으로 정리했습니다.

## 3.6 핵심 업데이트

v3.6은 v3.5의 실시간 운영/방송 기능을 유지하면서 **데이터 복구, 백업 검증, 변경 감사, 운영 Self-Check**를 추가한 안정성 단계입니다.

- 관리자 메뉴에 `복구·감사` 센터 추가
- 참가자 + 운영 상태를 함께 저장하는 수동 복원 지점(최대 10개)
- 최초 실행 시 v3.6 초기 보호 지점 자동 생성
- 복원 직전 현재 상태를 자동 보호한 뒤 복원 수행
- 복원 지점 SHA-256 무결성 검사 및 손상된 복원 지점 차단
- 전체 JSON 백업 업로드 전용 검증: 버전, Discord 서버 ID, 참가자 구조, 중복 ID, 운영 데이터 구조 검사
- 검증을 통과한 백업만 대시보드에서 복원 가능
- 복원 과정에서 참가자/운영 저장소를 함께 교체하고 실패 시 직전 상태로 롤백 시도
- 복원 중 SSE 중간 snapshot 전송을 잠시 중지해 참가자/운영 상태가 섞여 보이는 순간 상태 방지
- Self-Check: 저장소, 회차 참조, 복원 지점, Node.js, 외부 노출, 방송 토큰, Discord 상태, SSE 연결 수 점검
- 관리자 변경 감사 로그 최대 500건 보관: 운영, 방송 설정, 안내문, 닉네임, 게임 설정, 복구 작업
- 감사 로그에서는 token/password/secret/CSRF/Authorization 계열 상세 필드를 저장하지 않음
- `RECOVERY_FILE` 별도 저장소 추가(기본 `./data/recovery.json`)

## 3.6에서 같이 수정한 오류

### 1. 일부 상태 변경이 최상위 Revision에 반영되지 않던 문제

안내문 편집, 무기 설정, setup/voice/publish 요청 기록은 파일 저장과 SSE 알림은 발생하지만 최상위 `revision`이 증가하지 않는 경로가 있었습니다. Live Sync 진단 숫자가 실제 변경보다 뒤처질 수 있어 해당 경로도 revision을 증가시키도록 통일했습니다.

### 2. 시작할 때 운영 파일을 불필요하게 다시 쓰던 문제

이미 `guildId`가 저장되어 있어도 시작할 때마다 동일 값을 다시 저장해 `.bak`가 불필요하게 교체될 수 있었습니다. 이제 서버 ID가 아직 없는 최초 데이터에서만 기록합니다.

### 3. 복원 중 실시간 화면에 혼합 상태가 잠깐 보일 수 있는 문제

참가자 파일과 운영 파일은 별도 파일이므로 순차 복원 중 SSE가 먼저 전송되면 한쪽만 새 데이터인 순간 상태가 보일 수 있었습니다. v3.6은 복원 트랜잭션 동안 관리자 SSE push를 일시 중지하고 두 저장소 처리가 끝난 뒤 한 번만 갱신합니다.

### 4. 화면 버전 표시가 실제 패키지보다 오래된 문제

메인/게임 스튜디오 일부 버전 문구가 v3.4로 남아 있었습니다. 패키지, lockfile, API, 사이드바, 게임 스튜디오를 v3.6 기준으로 맞췄습니다.

## 3.5 핵심 업데이트

v3.5는 v3.4 Scene Customizer 위에 **방송 프리셋과 장면 자동화 계층**을 추가했습니다. 기본 방송 설정은 그대로 유지하면서 게임/모드별로 다른 프리셋을 자동 적용할 수 있습니다.

- 현재 방송 설정을 이름 있는 프리셋으로 저장/수정/삭제
- 최대 12개 프리셋 보관
- 기본 / 소환사의 협곡 / 칼바람 나락 / 이터널 리턴별 자동 프리셋 매핑
- 자동화가 켜져 있으면 현재 모집 게임에 맞는 프리셋을 방송 snapshot에서 자동 선택
- 특정 장면을 강제로 고정하고 0~300초 뒤 자동 해제 가능
- 회차 종료 장면을 0~60초 유지한 뒤 대기 화면으로 자동 복귀
- 방송 설정·프리셋 JSON 내보내기/가져오기
- 내보내기 파일에는 Discord Token, Dashboard Password, BROADCAST_TOKEN 등 비밀값을 포함하지 않음
- 프리셋 삭제 시 해당 프리셋을 가리키던 자동 매핑도 자동 정리
- 기존 v3.4 데이터와 호환: `broadcastPresets`, `broadcastAutomation`이 없으면 기본값으로 자동 동작

## 3.5에서 같이 수정한 오류

### 1. 장면 고정 시 게임별 프리셋 매핑이 사라질 수 있던 문제

장면 override를 정규화할 때 프리셋 목록 없이 자동화 객체를 다시 읽으면 기존 매핑 ID가 유효하지 않은 것으로 처리될 수 있었습니다. 장면 고정 처리에도 현재 프리셋 목록을 전달하도록 수정했습니다.

### 2. 자동화 컨트롤 조작이 일반 방송 설정 변경으로 잘못 표시되던 문제

기존 v3.4는 방송 페이지의 모든 input/select 변경을 Scene Customizer의 dirty 상태로 처리했습니다. v3.5에서는 실제 디자인 설정 필드만 별도로 감시해 프리셋/자동화 조작이 `저장되지 않은 변경`으로 잘못 표시되지 않습니다.

### 3. 자동화 저장이 활성 장면 고정을 해제할 수 있던 문제

게임별 자동 프리셋을 저장할 때 이미 적용 중인 장면 고정 상태를 보존하도록 수정했습니다.

## 3.4 핵심 업데이트

v3.4는 v3.3 Broadcast Director의 실시간 송출 구조를 유지하면서 **관리자 대시보드에서 방송 장면을 직접 디자인하고 저장할 수 있는 Scene Customizer**를 추가했습니다.

- 관리자 메뉴에 `방송 장면 설정` 추가
- 방송 화면 실시간 iframe 미리보기 추가
- 테마 3종: Midnight / Aurora / Warm Studio
- 레이아웃 2종: Cinematic / Compact
- 장면 전환 3종: Fade / Slide / Cut
- 선택형 전환 효과음: Off / Soft / Arcade
- 브랜드 제목, 하단 타이틀, 대기 화면 제목·설명 편집
- 당첨자 공개 유지 시간 2~15초 조절
- 헤더, 푸터, 게임 텔레메트리, 최근 신청자, 카운트다운 표시 여부 설정
- 모집/추첨 준비/당첨자/참석/팀/종료 장면별 자동 표시 여부 설정
- 저장 즉시 SSE를 통해 OBS 화면과 미리보기에 반영
- 방송 설정은 운영 데이터에 저장되며 Bot Token/BROADCAST_TOKEN 같은 비밀값은 저장하지 않음
- `prefers-reduced-motion` 환경에서 장면 애니메이션 자동 축소

## 3.4에서 같이 수정한 오류

### 1. 방송 경기 데이터 일시 조회 실패 시 재생이 영구 스킵되던 문제

기존 방송 화면은 `/broadcast/api/draw/:id` 조회가 일시적으로 실패해도 해당 경기를 이미 재생한 것으로 표시할 수 있었습니다. v3.4에서는 실패한 경기를 완료 처리하지 않고 다음 SSE/안전 폴링 시 다시 조회하도록 수정했습니다.

### 2. 헤더/푸터 숨김 시 빈 레이아웃 공간이 남던 문제

표시 옵션으로 헤더나 푸터를 숨길 때 화면 자체만 사라지고 그리드 행 높이는 유지될 수 있었습니다. v3.4에서는 숨김 상태에 따라 실제 그리드 행 높이도 0으로 바뀌도록 수정했습니다.

### 3. 방송 설정 데이터가 수동으로 손상됐을 때 관리자 UI가 빈 선택값을 표시할 수 있던 문제

관리자 snapshot에 방송 설정을 넣기 전에 서버에서 기본값·허용 enum·범위를 정규화하도록 변경했습니다. 저장 API는 알 수 없는 필드와 잘못된 enum을 거부합니다.

### 4. 보안 정책 때문에 관리자 페이지의 방송 미리보기가 차단될 수 있던 문제

방송 CSP의 `frame-ancestors`를 외부 임베딩 금지는 유지하면서 **same-origin 관리자 대시보드만 허용**하도록 조정했습니다.

## 3.3 핵심 업데이트

v3.3은 v3.2의 Control Center + Live Director 구조를 유지하면서 **관리 화면과 방송 화면을 분리**했습니다.

- `/broadcast/` 방송 전용 읽기 화면 추가
- 관리자 버튼 없이 상태에 따라 화면 자동 전환
  - 대기
  - 모집 중
  - 모집 마감 / 추첨 준비
  - 추첨 경기 재생
  - 당첨자
  - 참석 확인
  - 팀 결과
  - 회차 종료
- 전투/레이스 추첨 연출을 OBS 화면에서도 그대로 재생
- 사다리/즉시 추첨 결과 표시
- 레이스 선두·랩·격차·진행률 텔레메트리 표시
- 모집 인원·최근 신청자·카운트다운 실시간 표시
- 참석 완료/대기 상태 실시간 표시
- 팀 편성 결과 자동 전환
- `?transparent=1` 투명 배경 모드
- `?speed=0.5~4` 추첨 재생 속도 지정
- SSE heartbeat + 자동 재연결 + 8초 안전 폴링
- 방송 API에서 Discord User ID 제거 후 표시 이름만 전달
- 큰 경기 프레임은 SSE마다 반복 전송하지 않고 새 경기일 때만 별도 조회

## 이번 단계에서 같이 수정한 오류

### 1. 중복 표시 이름의 참석 상태가 잘못 연결될 수 있던 문제

같은 치지직 이름을 쓰는 참가자가 여러 명일 때 방송 화면의 당첨자/참석 확인 목록에서 이름이 서로 다르게 번호화되어, 한 사람의 참석 상태가 다른 사람처럼 보일 가능성이 있었습니다.

v3.3에서는 회차 전체에서 **고정된 표시 이름 맵**을 만든 뒤 모든 방송 화면에 동일하게 사용합니다.

### 2. Live Director 1프레임 경기 진행률 예외

프레임이 1개뿐인 예외 데이터에서 재생 길이가 0이 되어 진행률 계산이 불안정해질 수 있던 부분을 방어했습니다.

### 3. Windows 첫 설정에 특정 Discord ID가 기본값으로 들어 있던 문제

이전 시작 스크립트에는 애플리케이션 ID와 서버 ID가 기본값으로 들어 있었습니다. 다른 서버에서 그대로 실행하면 잘못된 Discord 앱/서버로 설정될 수 있었습니다.

v3.3에서는 해당 값을 제거하고 `START.cmd`/`SETTINGS.cmd`에서 실제 **Discord 애플리케이션 ID와 서버 ID를 직접 입력**하도록 변경했습니다.

### 4. 방송 접근 토큰 관리

Windows 첫 설정 시 `BROADCAST_TOKEN`을 자동 생성하고 `config.local.json`에 저장합니다. 시작 로그의 비밀값 필터에도 방송 토큰을 포함해 토큰이 출력되지 않도록 수정했습니다.

## 실행 환경

- Node.js 22.22.2 이상
- 권장: Node.js 24 LTS
- 실제 Discord 봇에서는 Bot Token과 대시보드 비밀번호를 환경 변수 또는 `config.local.json`에 저장

## 빠른 실행

Windows 연습 환경:

```text
DEMO.cmd
```

실제 Discord 봇 · production:

```text
START.cmd
```

실제 Discord 설정을 사용하는 development 프로필:

```text
DEV.cmd
```

직접 실행:

```bash
npm ci
npm run check
npm test
npm start       # production
npm run dev     # development + watch
npm run demo    # Discord에 연결하지 않는 연습 모드
```

기본 주소:

```text
관리자 대시보드  http://127.0.0.1:3000/
방송 화면        http://127.0.0.1:3000/broadcast/
시청자 화면      http://127.0.0.1:3000/viewer/
```

DEMO 모드는 기본적으로 3001 포트를 사용합니다.

## OBS Browser Source

OBS에서 `Browser` 소스를 추가한 뒤 다음 주소를 사용합니다.

```text
http://127.0.0.1:3000/broadcast/
```

권장 Browser Source 크기:

```text
Width  1920
Height 1080
```

투명 배경:

```text
http://127.0.0.1:3000/broadcast/?transparent=1
```

2배속 경기 재생 예시:

```text
http://127.0.0.1:3000/broadcast/?speed=2
```

두 옵션을 함께 사용할 수도 있습니다.

```text
http://127.0.0.1:3000/broadcast/?transparent=1&speed=2
```

## 외부 네트워크 방송 화면

기본 `HOST=127.0.0.1`에서는 방송 화면도 이 PC에서만 접근 가능합니다.

외부 접근을 허용하려면 HTTPS 리버스 프록시와 접근 제어를 먼저 구성하고 `BROADCAST_TOKEN`을 24자 이상으로 설정하세요. 외부 OBS URL에는 토큰을 추가합니다.

```text
https://your-domain.example/broadcast/?token=YOUR_BROADCAST_TOKEN
```

투명 배경까지 사용하는 경우:

```text
https://your-domain.example/broadcast/?token=YOUR_BROADCAST_TOKEN&transparent=1
```

`BROADCAST_TOKEN`은 비밀번호처럼 취급하고 공개 채팅, 방송 화면, Git 저장소 등에 올리지 마세요. 쿼리 문자열은 웹 서버 접근 로그에 기록될 수 있으므로 외부 송출에서는 프록시 로그 정책도 확인하는 것이 좋습니다.

## OBS 방송용 투명 오버레이 (v4.13.4)

기존 `/broadcast/`가 전체 장면 전환용 화면이라면, `/broadcast/overlay/`는 게임 화면 위에 얹는 **투명 Browser Source 오버레이**입니다.

표시 항목:

- 현재 호출/참가자
- 다음 대기 참가자
- 현재 대기 인원
- 추첨 결과
- 현재 팀 편성
- 최근 참가/호출/응답/노쇼/순서 변경 이벤트
- 현재 게임, 회차, 진행 단계

로컬 OBS 예시:

```text
http://127.0.0.1:3000/broadcast/overlay/?layout=wide
```

외부 Railway/HTTPS 환경에서는 기존 `BROADCAST_TOKEN`을 그대로 사용합니다.

```text
https://your-domain.example/broadcast/overlay/?token=YOUR_BROADCAST_TOKEN&layout=wide
```

OBS Browser Source 권장값:

```text
Width  1920
Height 1080
FPS    30
```

지원 레이아웃:

```text
layout=wide      기본. 참가자 + 추첨 + 팀 + 이벤트
layout=compact   세로 공간을 줄인 구성
layout=minimal   현재/다음 참가자만 표시
```

원하지 않는 패널은 `hide` 쿼리로 숨길 수 있습니다.

```text
/broadcast/overlay/?layout=wide&hide=events
/broadcast/overlay/?layout=wide&hide=teams,winners
```

대시보드의 **방송 장면 설정 → OBS Browser Source** 카드에서 Wide/Compact/Minimal 미리보기를 바로 열 수 있습니다.

오버레이는 기존 `/broadcast/api/events` SSE를 재사용하며 참가 Queue 저장소 변경에도 즉시 push됩니다. 15초 heartbeat, 45초 stale 판정, 8초 안전 폴링을 유지합니다.

오버레이 전용 모델은 방송에 필요한 표시 정보만 전달합니다. 다음 값은 포함하지 않습니다.

- Discord User ID
- Naver identity hash
- 참가 호출 응답 token
- CSRF token
- 전체 사용자 프로필/티어 원본
- `BROADCAST_TOKEN` 자체

`BROADCAST_TOKEN`은 URL에 포함될 수 있으므로 공개 채팅, 방송 설명, 화면 캡처, Git 저장소에 노출하지 마세요.

## 방송 데이터 최소화

방송 화면은 관리자 `/api/snapshot`을 그대로 사용하지 않습니다. 별도의 `/broadcast/api/*` 읽기 전용 API에서 필요한 상태만 전달합니다.

- Discord User ID 제거
- 관리자 CSRF 토큰 제거
- 전체 참가자 프로필/티어 정보 제거
- Bot Token/대시보드 비밀번호/방송 토큰 미전송
- 현재 회차의 표시 이름, 인원 수, 당첨·참석·팀 상태만 전달
- 추첨 경기의 플레이어 ID는 `p1`, `p2` 같은 방송 전용 별칭으로 변경

## 실시간 동기화

관리자 대시보드:

- `/api/events` SSE
- 15초 heartbeat
- 45초 이상 이벤트 부재 시 자동 재연결
- SSE 비연결 상태에서 8초 안전 폴링

방송 화면:

- `/broadcast/api/events` 별도 SSE
- 15초 heartbeat
- 45초 이상 이벤트 부재 시 재연결
- 비연결 상태에서 8초 안전 폴링
- 경기 프레임은 `/broadcast/api/draw/:id`로 필요한 시점에 한 번 조회

## 보안

- Bot Token/API 키/비밀번호를 코드에 하드코딩하지 않습니다.
- 관리자 대시보드는 Basic Auth + CSRF 검사를 사용합니다.
- 방송 화면은 localhost에서는 로컬 접근, 외부에서는 `BROADCAST_TOKEN` 또는 관리자 Basic Auth를 사용합니다.
- 방송용 API는 읽기 전용입니다.
- 기본 호스트는 `127.0.0.1`을 권장합니다.
- 외부 공개 시 HTTPS와 별도 접근 제어를 사용하세요.
- Discord Administrator 권한을 기본 요구하지 않습니다.

## 데이터

소규모 운영을 위해 JSON 저장소를 사용합니다. 업데이트할 때 기존 `data` 폴더와 `config.local.json`을 보존하면 참가자, 예약, 회차 기록을 이어서 사용할 수 있습니다.

관리자 대시보드의 백업 기능으로 참가자 및 운영 데이터를 JSON으로 내보낼 수 있습니다. 기존 `복구·감사` 페이지에서 백업을 검증하고 2단계 승인을 거친 뒤 복원할 수 있습니다. v4.0의 `배포 준비` 페이지는 별도로 자동 보존 백업을 관리합니다. 백업 파일과 `data/recovery.json`에는 참가자 정보가 포함될 수 있으므로 안전하게 보관하세요.

기본 복구 저장소는 `./data/recovery.json`이며 필요하면 `RECOVERY_FILE` 환경 변수로 경로를 바꿀 수 있습니다.

## 테스트

```bash
npm run check
npm test
```

v4.0에는 Production Readiness, 백업 보존, Soak Test, 실행 프로필 회귀 테스트가 추가되었고 기존 Runtime Health / Operations Guard 테스트도 계속 유지됩니다.

- Runtime Health API/Discord/저장소/SSE/스케줄러 통계 집계
- 진단 JSON의 비밀값 redaction 및 사용자 원본 데이터 미포함
- JsonStore `.bak` 자동 복구/쓰기 실패 observer
- 저장소/Discord/내부 프로그램 오류 HTTP 분류
- Runtime Health 대시보드/API/SSE 브라우저 메트릭 UI 정적 연결 검사

v3.7에서 추가된 다음 회귀 테스트도 유지됩니다.

- v1 운영 데이터 → 현재 스키마 마이그레이션 및 멱등성
- 현재 프로그램보다 새로운 스키마 거부
- 설정 Diff에서 비밀값/비대상 필드 제외
- 위험 작업 승인 문구의 1회성·작업/대상 binding
- Safe Deploy UI 및 승인 API 존재 여부
- 최신 스키마 백업 검증 및 복원 지점 무결성

기존 v3.3 회귀 테스트도 유지됩니다.

- 방송 snapshot 개인정보 최소화
- 경기 데이터 ID 별칭 처리
- 동일 표시 이름의 안정적인 참석 상태 연결
- OBS 자동 화면 구성
- SSE/재연결/투명 배경 기능 존재 여부
- Windows 설정의 Discord ID 하드코딩 방지
- 방송 토큰 자동 생성 및 로그 비노출 처리


## v4.17.3 Production Connector & OAuth Connectivity Verification
- Deployment 화면에서 Discord, Naver OAuth/API, CHZZK API, Public HTTPS 연결 상태를 확인합니다.
- `GET /api/connector-verification`은 설정/런타임 기반의 완전한 읽기 전용 보고서입니다. 실제 외부 연결 검증은 관리자 전용 `POST /api/connector-verification/probe`로 분리되어 기존 CSRF/Idempotency 보호를 적용합니다.
- 실제 연결 검증은 Discord diagnostics, Naver profile(연결된 경우), CHZZK channel lookup, `/healthz` 요청만 수행하며 외부 서비스 상태를 변경하지 않습니다. CHZZK는 API 성공뿐 아니라 설정된 대상 채널이 실제로 반환되는지까지 확인합니다.


### v5.1.4 CHZZK 팔로워 인증

관리자 Dashboard의 **CHZZK · 계정 연동 · 팔로워 인증**에서 방송 채널 소유자 동의와 Discord 인증 패널 게시를 진행합니다. 참가자는 본인에게만 보이는 링크로 CHZZK에 로그인하고, 방송 채널 팔로워임이 확인된 경우 인증 전용 역할을 받습니다. 닉네임 동기화는 선택적이며 실패를 따로 표시합니다. 기본 비활성이고 실제 OAuth·팔로워 조회·역할 적용은 운영 인증 정보로 별도 검증해야 합니다.

환경변수, 최소 권한, 저장/백업 및 실제 검증 절차: [CHZZK 팔로워 인증 안내](docs/chzzk-follower-verification.md).

### v5.1.3 운영 도구

브라우저에서 `/`를 열면 `/auth/login` 로그인 화면으로 이동합니다. 기존 `DASHBOARD_USER` / `DASHBOARD_PASSWORD`와 운영자 계정을 사용하며 외부 접속에는 HTTPS가 필요합니다. 로그인 세션은 8시간이며 재시작·비밀번호 변경 시 다시 로그인합니다. Basic 인증 호환 경로도 유지합니다.

- 커뮤니티 → 참가자 관리 → 참가자 운영 도구: 통합 Queue 준비 확인 시작/수동 확인/종료. 참가자는 Discord에서 받은 일회용 코드로 `/viewer/`에 로그인해 본인 준비 응답을 보냅니다. 네이버 참가자는 운영자가 수동 확인합니다. 자동 DM·네이버 게시물은 발송하지 않습니다.
- 시스템 관리 → 장애·복구 → 순서 되돌리기: 직전 Queue 순서 변경의 미리보기를 확인한 뒤 5분 이내 복원합니다. 이후 Queue 변경이 있으면 차단됩니다. 호출/발송/취소/계정 변경은 되돌리지 않습니다.
- 시스템 관리 → 운영 연습: 가상 접수→호출→준비→추첨→팀 배정→종료를 연습합니다. 실제 운영 API를 호출하지 않고 새로고침 시 초기화됩니다. 서버 재시작 복구와 외부 API E2E를 대체하지 않습니다.
- 참가자 화면은 기존 본인 Queue 순번·예약·호출 응답 기능을 유지합니다. 준비 확인은 참가자 구성이 바뀌거나 10분이 지나면 다시 시작해야 합니다.
