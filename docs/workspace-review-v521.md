# v5.2.1 운영 시작 안내·인수인계 검토

검토일: 2026-10-11 (Asia/Seoul). 개발 기준: v5.2.0 커밋 dee5f0d3f2db9793b60e833f3d63ca2bf960c6ef. 공개 main 기준은 v5.1.7이며 PR #11은 초안입니다. 기존 Discord·네이버 카페·CHZZK 기능과 데이터 스키마 2를 유지합니다.

## 구현 범위

운영자는 통합 운영 → 운영 준비 → 운영 시작 안내에서 현재 선택한 서버의 저장된 설정을 단계별로 확인합니다. Discord 연결 상태와 운영 채널, CHZZK 방송 계정과 인증 역할, 네이버 계정·게시판, OBS 설정을 표시하고 필요한 기능 화면으로 이동합니다. 네이버를 사용하지 않는 운영자는 선택 항목으로 구분합니다.

운영 인수인계 화면은 확인 시각, 운영 중지 여부와 설정 요약을 텍스트로 복사·저장합니다. 참가자 이름·회원 ID·서버 ID·토큰·카페/방송 URL·OBS 전용 주소·저장 경로·제작자 진단은 내보내지 않습니다. 인수인계 파일은 연결 비밀값이나 데이터 백업을 대신하지 않습니다.

GET /w/:guildId/readiness는 현재 Discord 운영자 권한과 서버 범위를 확인한 뒤 제한된 로컬 요약만 반환합니다. 안내를 계산하는 동안 커넥터 probe, 토큰 갱신, 게시, 역할 생성·부여, 저장 작업을 실행하지 않습니다. Discord 접근 권한 확인은 기존 플랫폼 경로를 따릅니다. 제작자 전역 잠금이 있어도 안내는 읽을 수 있으며 일시 중지 상태를 표시합니다.

저장된 토큰 존재나 설정 완료는 실제 외부 연결 성공을 증명하지 않습니다. 응답은 evidence=local, productionVerification=pending을 유지합니다. 고장·미설정·만료·권한을 확인할 수 없는 경우 성공으로 추정하지 않습니다. 네이버 카페 쓰기 권한과 팔로워 인증 역할 부여는 실제 계정 검증이 필요합니다.

## 보안·안정성 수정

네이버 토큰 갱신/로그인 응답이 연결 해제 이후 늦게 도착하면 해제한 토큰을 다시 저장할 수 있는 경합을 발견했습니다. 연결 세대와 저장 시점 검사를 적용해 오래된 응답의 재저장과 새 계정 연결 덮어쓰기를 차단합니다. 기존 OAuth state 일회성과 암호화 저장 형식은 유지합니다. 실제 provider revoke 호출과 로컬 연결 해제 정책은 관련 회귀 테스트로 확인합니다.

원자적 저장의 파일 IO가 이미 진행 중인 경우도 실제 암호화 임시 파일로 재현했습니다. 연결 해제는 새 인증 작업을 막고, 먼저 시작한 저장 뒤에서 최종 토큰 삭제를 완료합니다. 저장 완료 후와 인증 토큰을 사용하는 요청 직전에도 연결 세대·종료·운영 잠금을 재확인해 해제된 토큰으로 후속 요청을 보내지 않습니다. 새 OAuth 동의는 이전 계정의 refresh token·연결 시각을 상속하지 않습니다. 외부 revoke 실패는 저장된 연결을 유지하고 오류로 보고하며 성공으로 숨기지 않습니다.

이미 파일 저장에 들어간 이전 갱신 응답과 새 계정 동의가 겹치는 경우, 현재 연결 세대의 새 동의를 최종 값으로 저장합니다. 새 동의는 이전 암호화 값에 대한 조건부 비교 때문에 거절되지 않으며, 토큰 갱신은 계속 조건부 비교를 사용합니다. 같은 경합에서 이전 계정의 후속 프로필 요청은 차단되고 새 계정 연결은 재시작 후에도 유지되는 것을 검증합니다.

포털은 지정된 기능 ID로만 이동하며 응답의 HTML이나 임의 URL을 실행하지 않습니다. 안내·인수인계 화면 전환에도 기존 비동기 응답 세대 검사를 적용합니다. 참가자는 운영자 안내 API나 메뉴에 접근할 수 없습니다.

## 운영 활성화와 남은 검증

새 환경변수와 데이터 마이그레이션은 없습니다. MULTI_WORKSPACE_ENABLED는 기본 false이며 기존 Discord OAuth Redirect /portal/auth/callback과 DISCORD_CLIENT_SECRET 설정이 필요합니다. 기존 암호화 키와 /app/data 전체 볼륨을 보존합니다. 단일 프로세스·replica 1·초기 운영 공간 상한 25개는 동일합니다.

실제 Discord OAuth, 서로 다른 방송 운영자의 서버/계정 분리, 참가자 팔로워/미팔로워 인증, Railway 재시작과 볼륨 복구는 PENDING입니다. 별도 참가자 테스트 계정이 없다는 기존 사용자 답변을 유지합니다. 이번 개발은 배포 환경과 운영 트래픽을 변경하지 않습니다.

## 검증 기록

개발 검증 환경은 Windows / Node 24.19.0입니다. 실제 외부 계정을 사용하는 E2E와 분리해 실행했습니다. 테스트 실패나 건너뜀은 없으며 assertion을 약화하지 않았습니다.

| 검사 | 결과 |
|---|---|
| npm ci | PASS, 132 packages; npm audit 알려진 취약점 0건 |
| JavaScript syntax | 264 files PASS |
| 집중 workspace + Naver 경합 회귀 | 73/73 PASS, 실패·건너뜀 0 |
| 전체 Naver 관련 회귀 | 38/38 PASS; 신규 경합 14개 포함 |
| verify:final | 638/638 PASS, 실패·건너뜀 0 |
| verify:final --core-only | 613/613 PASS, 실패·건너뜀 0 |
| PC 1440×1024 / 모바일 390×844 | 가상 데이터로 화면·메뉴·읽기 전용 요약·가로 넘침·브라우저 오류 확인 PASS |
| 로컬 env:check | 환경 차단: 로컬 운영 Bot Token 없음; 실제 토큰을 가져오거나 출력하지 않음 |
| 실제 Discord·네이버·CHZZK 계정 E2E | PENDING |

위 전체 verify:final은 설치된 의존성과 지원 Node에서 실행했습니다. core-only 결과만으로 성공을 대신하지 않았습니다. Release Stage/Apply/Manifest/Rollback과 Git 기준 ZIP 파일별 해시, GitHub CI 결과는 최종 전달 보고서에 별도로 기록합니다.

## 변경 파일

추가 4개: `src/workspace-readiness.js`, `test/workspace-readiness.test.js`, `test/naver-disconnect-race.test.js`, `docs/workspace-review-v521.md`.

수정 17개: `CHANGELOG.md`, `NEW_CHAT_HANDOFF.md`, `README.md`, `REVIEW_REPORT.md`, `docs/workspace-accounts.md`, `package.json`, `package-lock.json`, `public/portal.css`, `public/portal.js`, `src/index.js`, `src/naver-auth-store.js`, `src/naver-service.js`, `src/version.js`, `src/workspace-platform.js`, `src/workspace-runtime.js`, `test/workspace-platform.test.js`, `test/workspace-ui.test.js`.

삭제 파일 없음. 기존 Discord·네이버 카페·CHZZK, 통합 Queue·호출·예약·준비·추첨·팀·레이스·OBS, 방송 프리셋·일정·Poll·통계·Timeline·알림·모바일, Recovery·Incident·Emergency Lock·Preflight·Runbook·Handoff·Automation·Closeout·Archive·Trends, 운영 검증과 Release/Rollback 기능을 보존합니다. 새 공개 포털에 모든 고급 편집 화면을 이전한 것은 아니며 제작자 기존 대시보드에서 계속 사용할 수 있습니다.

## 배포 전 사용자 작업

1. Discord 개발자 앱에 공개 HTTPS 주소의 `/portal/auth/callback`을 등록하고 `DISCORD_CLIENT_SECRET`을 Railway Secret으로 입력합니다. Bot Token과 다른 값입니다.
2. 네이버 OAuth 기능을 사용할 경우 기존 `NAVER_TOKEN_KEY`를 유지합니다. 기존 암호화 데이터가 있다면 새 키로 덮어쓰지 않습니다. 기존 CHZZK 키도 유지합니다.
3. replica 1과 `/app/data` 전체 영구 볼륨·백업을 유지하고 별도 검증 환경에서 위 실제 계정 E2E를 완료합니다.
4. 공개 활성화는 검증 후 진행합니다. 현재 `MULTI_WORKSPACE_ENABLED=false`, production v5.1.7, main v5.1.7, PR #11 초안 상태를 개발 완료와 구분합니다.

실제 연결이나 Railway 새 버전 기동·복구를 확인하기 전에는 배포 준비 완료로 표시하지 않습니다. 다음 개발 후보는 서버별 접수 규칙·호출 시간 설정 화면과 운영 연습 흐름의 공개 포털 확장입니다.
