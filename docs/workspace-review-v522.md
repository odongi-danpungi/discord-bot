# v5.2.2 참가 설정·운영 연습 검토

검토일: 2026-10-11 (Asia/Seoul). 개발 기준 v5.2.1 / 26a7d4b908b0debe614fe22469c52de41e887980. main과 Railway 운영은 v5.1.7이며, 기존 PR #11의 배포 후보를 계속 개발합니다. Discord·네이버 카페·CHZZK와 기존 운영·검증·복구 기능을 보존하고 데이터 스키마 2와 기본 비활성 포털을 유지합니다.

## 구현과 적용 시점

통합 운영 → 참가 설정 → 참가 선발 규칙에서 공정 선발 사용 여부, 오늘 미참가 우선, 접수 순서 우선, 연속 참가 제한과 신규 참가 자리 수를 각각 설정합니다. 기존 커뮤니티 설정의 알림 채널과 구독 역할을 함께 보존합니다. 저장 시 확인한 revision으로 오래된 창의 덮어쓰기를 거절합니다. 진행 중인 회차의 정책은 유지하고 다음 모집부터 새 규칙을 사용합니다.

통합 운영 → 참가 설정 → 호출 응답 시간은 15~300초 정수만 저장합니다. 서버별 별도 파일과 원자적 저장·revision 충돌 검사를 사용하고, 저장 성공 후 메모리 설정을 반영합니다. 진행 중인 호출의 마감과 타이머는 변경하지 않고 다음 호출부터 적용합니다. 공개 포털이 활성화된 서버는 재시작 시 저장값을 복원합니다. MULTI_WORKSPACE_ENABLED=false인 기존 단일 서버 모드는 매 재시작마다 PARTICIPATION_CALL_TIMEOUT_SECONDS를 우선하며 호출 설정 sidecar를 읽거나 새로 만들지 않습니다. 비활성화는 기존 저장값을 삭제하지 않아 재활성화 때 다시 사용할 수 있습니다.

통합 운영 → 방송 도구 → 운영 연습에서 가상 접수·호출·준비·추첨·팀 배정·종료를 6단계로 진행합니다. 가상 참가자만 사용하며 API·실제 참가자 데이터·토큰·외부 전송을 사용하지 않습니다. 페이지·서버를 바꾸면 연습 상태를 폐기합니다. 기존 별도 운영 연습 화면도 유지합니다. 연습은 실제 OAuth·Discord 권한·서버 재시작 검증을 대신하지 않습니다.

## 권한·보안·복구

호출 시간 조회·저장은 현재 Discord 서버 운영자 권한을 확인합니다. 저장은 CSRF·Origin·전역/서버 운영 잠금 검사를 거치고, 실제 저장 queue 안에서도 잠금을 재확인합니다. 참가자·타 서버 운영자·만료된 권한은 거절합니다. 설정 저장은 외부 메시지나 역할 변경을 실행하지 않습니다.

연습과 안내에는 실제 Secret과 개인 참가자 정보를 포함하지 않습니다. 입력과 오류는 허용한 항목만 다루며 HTML은 텍스트로 렌더링합니다. 서버/페이지 전환 후 늦은 응답이나 오래된 폼 저장도 차단합니다.

새 필수 환경변수와 Discord 권한·Gateway Intent는 없습니다. 기존 NAVER_TOKEN_KEY·CHZZK_TOKEN_KEY 및 /app/data 전체 영구 볼륨을 보존합니다. 호출 설정 파일은 기존 operationsFile 옆의 별도 파일이며 기존 registry와 운영 스키마를 바꾸지 않습니다. 기존 Queue/회차 복원 지점에는 이 환경설정 파일이 포함되지 않으므로 전체 볼륨 백업을 보존합니다. 이전 코드로 롤백하면 그 파일을 보관하고 이전 호출 시간 설정을 사용하므로 재활성화 시 확인해야 합니다.

## 수정한 오류와 변경 파일

- 구형 진행 회차에 communityFairness가 없으면 기본 정책 변경이 현재 회차까지 바꾸던 오류를 재현했습니다. 변경 전 유효 정책을 동일 원자 저장에 보존하고 손상된 이전 정책은 409로 중단합니다.
- 설정 저장 큐에서 기다리는 동안 긴급 잠금이나 draining으로 바뀌어도 저장이 진행되던 오류를 재현했습니다. 실제 큐 실행 시점에 guard를 다시 확인합니다.
- 새 호출 설정이 포털 비활성 단일 서버의 환경변수보다 우선하는 호환성 문제를 수정했습니다. disabled는 환경값, enabled는 검증된 저장값을 사용합니다.
- 입력·revision 충돌과 저장 실패는 메모리 호출 시간을 바꾸지 않으며 현재 타이머·마감은 유지합니다. 회귀에서 재시작 복원과 파일 바이트 보존을 확인합니다.

추가 파일은 `src/workspace-call-settings.js`, `test/workspace-call-settings.test.js`, `docs/workspace-review-v522.md`입니다. 삭제 파일은 없습니다.

| 수정 파일 | 변경 목적 |
|---|---|
| src/app.js | 호출 설정 전달 및 복구 상태 반영 |
| src/index.js | 조건부 설정 저장소 초기화·flush, 기존 환경변수 우선순위 유지 |
| src/workspace-runtime.js | 서버별 호출 시간 저장·재시작 복원 |
| src/workspace-platform.js | 운영자 전용 조회·저장 API와 연습 모델 정적 경로 |
| src/community.js | 현재 회차 정책 보존, 저장 큐 잠금 재검사 |
| public/portal.js, public/portal.css | 참가 설정 두 화면과 6단계 연습, 모바일 표시 |
| test/community.test.js, test/workspace-platform.test.js, test/workspace-ui.test.js | 회차 보존·권한·동시 저장·UI 회귀 |
| package.json, package-lock.json, src/version.js | v5.2.2 버전 일치 |
| README.md, CHANGELOG.md, NEW_CHAT_HANDOFF.md, REVIEW_REPORT.md, docs/workspace-accounts.md | 기능·적용 시점·호환성·복구 안내 |

설정 변경은 직렬 저장하며 불필요한 커넥터 요청을 만들지 않습니다. 운영 연습은 화면의 지역 상태만 사용해 외부 요청 비용이 없습니다. 별도 성능 벤치마크를 수행하지 않았으므로 수치 개선을 주장하지 않습니다.

## 검증 기록

Windows / Node 24.19.0에서 필수 의존성을 설치하고 다음 검사를 완료했습니다.

| 검사 | 결과 |
|---|---|
| npm ci | PASS, 알려진 취약점 0건 |
| JavaScript 문법 검사 | 266개 파일 PASS |
| Workspace·Community·Naver 동시 연결·호출 집중 회귀 | 123/123 PASS |
| verify:final --core-only | 642/642 PASS |
| verify:final 전체 | 667/667 PASS |
| 전체/집중/core 실패·취소·건너뜀 | 각각 0건 |
| git diff --check | PASS |
| 실제 운영 env:check | BLOCKED: 로컬 DISCORD_TOKEN 없음, exit 2 |

본 버전은 이전 638개 전체 테스트에 29개 회귀를 추가했습니다. core는 외부 의존성 통합 테스트 7개 파일을 제외한 검사이며 위 전체 검사도 별도로 통과했습니다. npm test의 전체 suite는 verify:final 내부의 node --test로 실행했습니다.

PC 1440×1024와 모바일 390×844에서 실제 포털 소스와 가상 API를 사용해 화면을 확인했습니다. 6단계 연습 완료, 호출 시간 60→90초 저장, 연속 참가 제한 2→3 저장, 메뉴 접기와 화면/서버 전환 초기화를 확인했습니다. 모바일 가로 넘침과 브라우저 오류는 0건입니다. 가상 API 저장은 fixture 메모리만 변경하며 실서비스 성공 근거로 사용하지 않습니다.

커밋 후 GitHub CI, 격리 복사본의 Release Stage/Apply/Manifest/Rollback 및 ZIP 파일별 일치 결과는 별도 최종 전달 보고서와 JSON manifest에 기록합니다. Release Manifest/Update JSON은 기존 허용 목록인 일부 루트 파일과 src/public/scripts/test를 검증합니다. docs/deploy/.github·Dockerfile·Railway 설정 등까지 포함한 전체 파일은 ZIP과 Git의 바이트 일치로 검증합니다. 무서명 v2 업데이트 JSON은 서명 필수 정책을 변경하거나 우회하지 않습니다.

## 남은 실제 환경 검증

공개 포털 Discord OAuth Secret·Redirect, 실제 서버 A/B 운영자와 참가자 계정 검증, 네이버 카페 쓰기 권한, CHZZK 팔로워/미팔로워 역할 인증, 새 버전 Railway 기동·볼륨 복구는 PENDING입니다. 사용자에게 별도 참가자 테스트 계정이 없다는 기존 답변을 유지합니다. 이번 개발은 운영 환경변수·트래픽·배포를 변경하지 않습니다.

공개 활성화 전에 Discord OAuth Redirect에 PUBLIC_BASE_URL origin + /portal/auth/callback을 등록하고 DISCORD_CLIENT_SECRET을 안전하게 입력합니다. 기존 Bot Token을 다시 만들 필요는 없습니다. 네이버 OAuth 사용 시 기존 암호화 키를 유지하거나 기존 데이터에 맞는 키를 복원합니다. replica 1과 전체 볼륨 백업을 유지하며 실제 E2E 통과 후 배포·활성화합니다.
