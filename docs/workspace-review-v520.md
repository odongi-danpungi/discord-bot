# v5.2.0 계정·방송 공간 분리 검토 보고서

검토일: 2026-10-09 (Asia/Seoul). 기준: GitHub main v5.1.7 / 7898f1d98b2df3164a2427503ff373a213af4403. v4.17.5 전체 프로젝트에서 이어진 기능을 유지합니다. 브랜치: feat/creator-user-workspaces. 데이터 스키마 2 유지.

## 구현 결과

- 제작자는 기존 대시보드 및 /creator/에서 전체 서비스·서버별 진단과 복구를 관리합니다.
- 일반 사용자는 /portal/에서 Discord 로그인 후 현재 서버 권한으로 운영자/참가자를 구분합니다. 서버 소유자 또는 ManageGuild가 운영자입니다.
- 신규 방송 공간의 Queue·등록자·카페/CHZZK 토큰·OBS 토큰·멱등성 저널·백업을 서버별 파일로 분리했습니다. 기존 제작자 데이터는 이동하지 않습니다.
- 각 서버는 자기 카페와 자기 CHZZK 방송 계정을 연결합니다. 제작자의 채널·설정을 다른 서버에 복사하지 않습니다.
- 일반 포털은 통합 운영 / 네이버 카페 / Discord / CHZZK의 대·중·소분류와 개별 기능 화면입니다. 제작자 환경검사·릴리스·복구 기능은 표시·허용하지 않습니다.
- 참가자 개인 상태는 요청 본문의 userId가 아닌 검증한 Discord 로그인 사용자에 연결됩니다.
- 기존 제작자 고급 OBS 편집, Runbook, Preflight, Production Acceptance/Cutover 등 기존 기능은 그대로 유지합니다. 신규 일반 포털에 모든 고급 편집 화면을 이식한 것은 아닙니다.

## 수정한 오류와 보안 경계

- 서버/메뉴 전환 중 늦은 응답이 이전 서버의 화면·작업 대상을 덮어쓰지 않도록 세대 번호와 요청 범위를 고정했습니다.
- 참가 링크는 서버/회차를 OAuth state에 보존하며 임의의 리디렉션 URL은 받지 않습니다.
- 사용자 identity는 서버 내부 Symbol로 전달합니다. 클라이언트 헤더로 운영자·제작자 권한을 만들 수 없습니다.
- OAuth state 일회성·만료·브라우저 바인딩, SameSite/HttpOnly/Secure 쿠키, CSRF/Origin, 로그인 시도 제한을 적용했습니다.
- 제작자 별도 경로의 Basic 인증에도 기존 비밀번호 시도 제한을 적용했습니다.
- 쓰기는 현재 Discord 권한을 매번 확인합니다. 읽기 권한 캐시는 최대 15초이며 장기 SSE를 일반 포털에 노출하지 않습니다.
- 타 서버 OBS 토큰·참가자 ID·CSRF로 접근하는 요청, 경로 변조, 제작자 API, 계정 로그아웃 후 재사용을 차단합니다.
- 전역 잠금·draining·재시작 대기를 신규 공간의 호출·카페/CHZZK 알림·OAuth 후속 작업에도 반영합니다.
- 손상된 한 공간은 시작 실패 상태로 격리하고 30초간 반복 초기화를 제한합니다. 정상 공간은 계속 시작합니다.
- 종료 시 진행 중 작업을 기다리고 저장 완료 후 프로세스 잠금을 해제합니다. 대기 초과를 정상 종료로 숨기지 않습니다.
- 초대 링크에 실제 서버 준비에 필요한 권한을 포함하고 Administrator는 포함하지 않습니다.

## 의존성 보안

npm ci에서 발견된 advisory 2건을 조사해 lockfile의 하위 의존성 두 개만 갱신했습니다.

- proxy-addr 2.0.7 → 2.0.8: 특정 잘못된 IPv6 신뢰 서브넷 설정에서 IP 위조가 가능한 문제. 이 앱은 숫자 프록시 홉 수를 사용하지만 취약 버전을 유지하지 않습니다. [유지보수자 advisory](https://github.com/jshttp/proxy-addr/security/advisories/GHSA-jqcg-44mw-7w3h)
- source-map-js 1.2.1 → 1.2.2: indexed source map 처리의 서비스 거부 문제. 이 프로젝트에서는 개발/테스트 의존성입니다. [보안 advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)

최종 npm audit은 알려진 취약점 0건입니다. 취약점 0건 보고는 알려진 advisory 기준이며 모든 보안 결함이 없음을 의미하지 않습니다.

## 검증

최종 검증 집계와 릴리스/ZIP 검사 결과는 이 보고서의 마지막 기록에 추가합니다. 실제 외부 API 테스트와 로컬 가상 API 테스트를 구분합니다.

브라우저에서 1440×1024 PC, 390×844 모바일을 확인했습니다. 가상 운영자와 가상 참가자만 사용했습니다. 선택 참가자 작업 패널, 소분류 탐색, 모바일 메뉴 펼침·접힘, 가로 넘침 없음, 콘솔 오류 없음을 확인했습니다. preview 서버는 배포 ZIP에 포함하지 않습니다.

## 운영 상태 및 차단 사항

| 항목 | 상태 |
|---|---|
| Discord 로컬 권한/라우팅/Queue | 회귀 검증 대상, 실제 새 OAuth 로그인은 PENDING |
| 네이버 카페 | 서버별 파일·연결 경로 구현, 실제 각 카페 쓰기·OAuth는 PENDING |
| CHZZK | 서버별 방송 소유자 연결 구현, 서로 다른 실방송 계정 E2E는 PENDING |
| 실제 팔로워 역할 부여 | 별도 참가자 테스트 계정 부재로 PENDING |
| Dashboard | PC·모바일 가상 데이터 화면 및 DOM 회귀 확인 |
| Recovery | 로컬 잠금·재시작·복구 회귀, 실제 볼륨 복원은 PENDING |
| Railway | 운영 설정·트래픽·볼륨은 이번 변경에서 수정하지 않음 |
| 신규 포털 | 기본 비활성, 공개 활성화 전 실계정 검증 필요 |

사용자가 할 일은 docs/workspace-accounts.md의 Discord OAuth2 Redirect 등록 및 Railway DISCORD_CLIENT_SECRET 저장입니다. Bot Token/암호화 키를 새 값으로 대체하지 않습니다. 새 옵션은 검증 전 false로 유지합니다. /app/data 전체 영구 볼륨 백업과 단일 replica를 유지해야 합니다. 초기 등록 상한은 25개입니다.

## 남은 검토와 다음 개발

실제 두 방송 서버 간 E2E, 권한 회수 후 조작 차단, 서로 다른 방송 계정의 인증 대상 확인, 참가자 팔로워/미팔로워 역할 부여, Railway 재시작과 전체 볼륨 복구가 남았습니다. 검증 후 제한된 운영자부터 활성화할 수 있습니다. 대규모 공개 전 부하 측정, DB 기반 다중 인스턴스 구조, 계정/연동 데이터 삭제·보관 정책 UI, 일반 운영자용 고급 OBS·인수인계 화면 확장이 다음 과제입니다.

## 변경 파일

기존 파일 수정:

- `.env.example`
- `CHANGELOG.md`
- `NEW_CHAT_HANDOFF.md`
- `README.md`
- `REVIEW_REPORT.md`
- `deploy/production.env.example`
- `package-lock.json`
- `package.json`
- `src/app.js`
- `src/chzzk-guild-setup.js`
- `src/chzzk-live-monitor.js`
- `src/chzzk-verification-routes.js`
- `src/chzzk-verification.js`
- `src/community-discord.js`
- `src/community.js`
- `src/config.js`
- `src/dashboard-access.js`
- `src/index.js`
- `src/interactions.js`
- `src/naver-monitor.js`
- `src/participation-call-service.js`
- `src/production-environment.js`
- `src/version.js`
- `src/viewer.js`
- `test/idempotency-ui.test.js`

신규 파일:

- `docs/workspace-accounts.md`
- `docs/workspace-review-v520.md`
- `public/portal.css`
- `public/portal.html`
- `public/portal.js`
- `public/workspace-admin.html`
- `public/workspace-admin.js`
- `src/workspace-assets.js`
- `src/workspace-login.js`
- `src/workspace-platform.js`
- `src/workspace-policy.js`
- `src/workspace-runtime.js`
- `src/workspace-store.js`
- `test/workspace-auth.test.js`
- `test/workspace-boundary.test.js`
- `test/workspace-community-entrypoints.test.js`
- `test/workspace-platform.test.js`
- `test/workspace-safety.test.js`
- `test/workspace-ui.test.js`

삭제 파일: 없음. 테스트 우회/skip 추가: 없음.

## 최종 로컬 검증 기록

- Windows / Node 24.19.0, npm ci: PASS. 의존성 132개 설치, audit 0 vulnerabilities.
- JS check: 261개 파일 PASS.
- npm run verify:final: 600/600 PASS, fail 0, skip 0. 최종 운영 중단 표시 보완 후 재실행 결과입니다.
- npm run verify:final -- --core-only: 575/575 PASS, fail 0, skip 0. core 이후 추가한 중단 표시 회귀도 최종 전체 테스트에 포함해 통과했습니다.
- env:check 로컬: 환경 차단(exit 2, Bot Token 없음). 운영 비밀값을 로컬로 가져오지 않았습니다. 이 결과로 Railway 환경 검사 성공을 주장하지 않습니다.
- 브라우저: 가상 데이터 PC/모바일 메뉴와 Queue 확인 PASS. 브라우저 오류 0, 모바일 가로 넘침 없음.
- 변경사항 Git whitespace 검사 PASS. 파일 삭제 없음.
- Release Center Stage / Apply / Manifest / Rollback은 별도 사본에서 검사하며 결과는 산출물 workspace-release-check.json에 기록합니다. 운영 서버에서 Apply/롤백을 실행하지 않습니다.
- Update JSON은 v5.1.7 → v5.2.0, 배포 검증 후보인 unsigned v2 형식(채널 메타데이터 없음)입니다. 서명 검증이 필수인 운영 환경에서 서명 정책을 낮춰 적용하지 않습니다. 해당 환경에는 제작자 소유 키를 이용한 별도 서명이 필요합니다.
- 기존 업데이트 도구의 허용 목록에 따라 docs/ 등의 안내 파일은 Update JSON에서 제외될 수 있습니다. 최신 전체 안내는 GitHub와 전체 프로젝트 ZIP을 기준으로 합니다.

GitHub 검토 브랜치와 PR 상태, ZIP CRC/파일별 SHA-256, Release Center 검사 결과는 전달 시점의 별도 산출물로 확인합니다. 이 보고서에 Railway production 성공을 기록하지 않습니다.

- 신규 계정·서버 분리 집중 회귀: 35/35 PASS.
- 별도 사본 Release Center: Stage PASS, Apply PASS, 새 버전 Manifest 일치 PASS, v5.1.7 Rollback Manifest 일치 PASS. 변경 39개, 삭제 0개.
