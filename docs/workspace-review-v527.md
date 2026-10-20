# v5.2.7 참가자 네이버 계정 소유 확인 검토

검토일: 2026-10-15 (Asia/Seoul). 직전 개발 기준은 v5.2.6 / e77cb921711489b472a29d443c67c8be641e7dfb입니다. main·실제 Railway 기준은 v5.1.7 / 7898f1d98b2df3164a2427503ff373a213af4403입니다. 기존 초안 PR #11에서 개발하며 운영 환경변수·트래픽은 변경하지 않습니다. 이번 범위는 사용자 포털의 참가자 개인 네이버 소유 확인과 그 저장·OAuth·화면 경계입니다. 기존 프로젝트 전체를 새로 전수 감사했다고 의미하지 않습니다.

## 기능과 권한

참가자는 자기 Discord 로그인으로 현재 서버의 내 참가 상태에서 네이버 계정을 연결합니다. 연결 시작 전 수집 목적과 범위를 확인하고 명시적으로 동의합니다. 운영자도 참가자 화면에서는 본인 연결만 조회·해제할 수 있습니다. 제작자 점검·배포·복구 기능은 기존 제작자 계정에 남으며 일반 사용자 포털에 추가하지 않습니다.

연결됨은 당시 네이버 계정 소유를 확인한 기록입니다. 현재 카페 회원·카페 닉네임·지속적인 외부 동의·CHZZK 팔로워·참가 자격을 증명하지 않습니다. 카페 접수 이름을 네이버 로그인 ID로 추정하거나 기존 Discord·네이버 Queue 항목을 합치지 않습니다. 호출·예약·추첨·팀·역할 변경도 수행하지 않습니다. 연결 기능이 준비되지 않아도 기존 참가 기능은 유지합니다.

프로필 API는 네이버 로그인 아이디 대신 애플리케이션 범위 식별값을 제공합니다. 같은 회원도 앱이 다르면 식별값이 달라지므로 운영자 앱·참가자 앱·CHZZK 사이에 식별값을 공유하거나 역으로 연결하지 않습니다. [네이버 회원 프로필 API 명세](https://developers.naver.com/docs/login/profile/profile.md)

## 전용 앱과 설정 검증

선택 변수 NAVER_PARTICIPANT_CLIENT_ID·NAVER_PARTICIPANT_CLIENT_SECRET은 별도 최소 정보 네이버 로그인 앱에 사용합니다. 운영자 NAVER_CLIENT_ID/SECRET으로 대체하지 않으며 같은 운영자 Client ID를 재사용하면 참가자 연결을 준비 전으로 처리합니다. 기존 운영자 카페 쓰기 연결과 토큰 파일은 유지합니다. 참가자 앱에 카페 가입·글쓰기 권한과 불필요한 이름·이메일·닉네임·연락처 제공 항목을 추가하지 않습니다. 실제 앱 권한 구성을 코드가 자동 검사하는 기능은 없으며 등록·검수·동의 화면 검증은 PENDING입니다. [네이버 로그인 개발가이드](https://developers.naver.com/docs/login/devguide/devguide.md)

참가자 콜백은 PUBLIC_BASE_URL origin + /naver/participant/callback으로 고정합니다. 운영자 /naver/callback과 다르며 참가자가 임의 redirect URI를 지정하지 않습니다. 별도 콜백 환경변수는 추가하지 않습니다. 기존 NAVER_TOKEN_KEY를 HMAC 키로 사용하며 32바이트 64HEX 또는 정규 Base64 형식을 검사합니다. 키를 새로 발급해 기존 운영자 토큰을 읽지 못하게 만들지 않습니다.

빈 값·한쪽만 있는 참가자 설정은 선택 기능만 unavailable로 유지합니다. 참가자 전용 설정과 기존 키만 있는 구성이 운영자 카페 Client ID·Secret 누락으로 잘못 차단되지 않도록 loadConfig와 Production Environment Validation을 함께 수정합니다. 기존 운영자 필드가 있으면 기존 쌍 검증을 유지합니다. 잘못된 키 형식은 차단하며 참가자 Secret도 기존 Secret 재사용 검사 대상에 포함합니다. 검증 보고서는 비밀값·앱 식별값을 출력하지 않고 준비 상태만 요약합니다. 전용 앱 기본 설정 통과를 실제 로그인 성공으로 표시하지 않습니다.

## HTTP 경로와 OAuth 보호

| 경로 | 동작과 경계 |
|---|---|
| GET /w/:guildId/viewer/api/account-link | 현재 서버 멤버의 본인 최소 연결 상태 조회 |
| POST /w/:guildId/viewer/api/account-link/start | revision·consent=true 및 기존 인증·CSRF·동일 사이트 보호 후 연결 시작 |
| POST /w/:guildId/viewer/api/account-link/disconnect | revision·confirm=true 및 기존 보호 후 로컬 연결 해제 |
| GET /naver/participant/callback | 원래 사용자·로그인 세션·서버의 일회용 state를 확인하는 전용 콜백 |

state는 무작위 값이며 서버에는 digest와 원래 로그인 세션·사용자·서버 문맥·revision·설정 문맥을 연결해 10분 동안 보관합니다. 정상·동의 거절 콜백은 일회용 state를 소비하고 재사용하지 않습니다. 새 연결과 로컬 해제는 진행 중인 이전 요청을 무효화합니다. 서버 재시작 뒤 진행 중 OAuth는 다시 시작해야 합니다.

외부 응답을 기다린 뒤에는 원래 로그인 세션이 유효한지와 현재 Discord 서버 멤버십을 다시 확인하고, 실제 저장 큐에서도 운영 잠금·종료·revision·설정 문맥을 검사합니다. 로그아웃으로 지운 세션을 오래된 in-flight 요청이 계속 사용하는 경계도 막습니다. 다른 브라우저·세션·서버·사용자의 state를 대신 완료하거나 동의 없이 연결하지 않습니다.

네이버 토큰 교환은 명시적 로그인 흐름에서만 실행하고 프로필은 고정된 공식 HTTPS endpoint로 조회합니다. 리다이렉트를 따르지 않으며 요청 timeout·응답 크기 상한과 제한된 시작 요청 수를 적용합니다. 실패 시 자동 토큰 갱신·무한 재시도·카페 외부 쓰기를 하지 않습니다. 원시 upstream payload·OAuth 코드·토큰·내부 파일 경로를 사용자 응답에 포함하지 않습니다. [네이버 로그인 API 명세](https://developers.naver.com/docs/login/api/api.md)

## 저장·해제·복구

서버별 Operations 파일의 디렉터리에 비공개 participant-identities.json을 저장합니다. 상태는 version 1·revision·links로 구성하며 각 링크에는 Discord userId, 서버·참가자 앱 범위 HMAC subjectHash, 앱/키 구분 clientHash, linkedAt만 남습니다. 원본 네이버 식별값·프로필 이름·이메일·OAuth access/refresh token은 영속화하지 않습니다. HMAC 식별값도 계정 연결 자료이므로 파일 접근을 제한합니다. 기존 Operations 데이터 스키마는 2를 유지합니다.

연결 파일은 JsonStore의 원자 저장·revision 충돌 검사·정상 백업 복구 경로를 사용합니다. 같은 서버에서 하나의 네이버 식별값을 다른 Discord 계정으로 중복 연결하지 않습니다. 충돌 안내는 기존 연결 계정의 이름·ID를 알려주지 않습니다. 서로 다른 서버의 연결 저장소와 HMAC 문맥은 분리하며 다른 서버의 연결 여부를 공개하지 않습니다. 개인 상태 GET은 이미 초기화된 저장소를 읽으며 외부 API·복구 저장·Queue 변경을 실행하지 않습니다.

로컬 연결 해제는 기록과 진행 중 동의 요청을 해제합니다. 네이버 토큰 삭제 API를 호출하거나 네이버 계정의 외부 앱 동의를 자동 철회하지 않습니다. 외부 동의 철회는 사용자가 네이버 계정 관리에서 별도로 확인합니다. 토큰을 보관하지 않으므로 이후 주기적인 외부 연결 유효성 확인도 수행하지 않습니다. 앱 또는 키가 달라지면 과거 기록을 새 문맥의 계정으로 인정하지 않고 재연결을 안내합니다.

전체 /app/data와 workspaces, participant-identities.json·.bak·.tmp 복구 자료 및 기존 키를 함께 보존합니다. Operations 복원 지점은 별도 연결 파일을 포함하지 않으며 해당 복원만으로 계정 연결을 되돌리지 않습니다. 이전 코드로 롤백하면 새 파일을 무시하므로 삭제하지 않습니다. 전체 볼륨 복원으로 해제 전 과거 기록이 돌아올 수 있으므로 본인 동의 의사·해제 여부와 필요한 재연결을 확인합니다. 복원된 기록을 현재 외부 인증 성공으로 간주하지 않습니다. Queue 자동 병합·예약 변경·역할 부여는 복구 동작에 추가하지 않습니다.

JSON 단일 프로세스·replica 1, MULTI_WORKSPACE_ENABLED 기본 false를 유지합니다. 여러 프로세스가 같은 파일을 동시에 사용하는 지원을 추가하지 않습니다. 기존 호출 패스 결정 저장·Queue 투영·확인 복구와 [v5.2.6 호출 결과 경계](workspace-review-v526.md)는 유지합니다.

## 변경 파일과 검증

주요 변경 범위는 src/participant-naver-link.js의 전용 서비스·저장소, src/workspace-platform.js의 서버별 수명주기·본인 API·콜백, src/config.js·src/production-environment.js의 선택 설정 검증, public/viewer.html·js·css의 개인 연결 화면, 해당 회귀 테스트와 버전·운영 문서입니다. 삭제한 기능은 없으며 dependency 변경·새 Discord 권한·Gateway Intent는 추가하지 않습니다. 처리량·지연 벤치마크를 수행하지 않았으므로 성능 수치 개선은 주장하지 않습니다. 최종 파일 목록과 릴리스 검증 근거는 전달 보고서에 기록합니다.

Windows / Node 24.19.0에서 새 npm ci 성공, npm audit 알려진 취약점 0건입니다. JavaScript 282개 문법 검사, 집중 회귀 171/171, verify:final 전체 962/962, core-only 937/937 PASS이며 각 최종 실행의 실패·취소·건너뛰기 0건입니다. core-only는 전체 검증을 대체하지 않습니다. 직전 v5.2.6 전체 885개보다 검증 77개를 추가했습니다.

실제 JsonStore와 전용 서비스 테스트에서 영속화·동일 식별값 중복 연결·본인 상태 비노출·revision 충돌·동의·브라우저/사용자 결합·일회용/만료/대체 state·요청 제한·설정/키 교체·해제/종료 중 늦은 응답·저장 대기 중 guard·응답 크기/UTF-8/HTTP 실패·10초 timeout·자동 retry/revoke 부재를 확인했습니다. 서로 다른 비정상 UTF-8 바이너리 키가 문자열 변환으로 같은 키 구분값을 만들 수 있던 문제는 원본 바이트 해시와 회귀로 수정했습니다.

실제 HTTP·서버별 런타임 테스트에서 CSRF·Origin·현재 멤버십·위조 user/guild 입력·다른 서버 분리·충돌 정보 마스킹·GET 전후 파일 바이트/mtime 불변을 확인했습니다. 권한 조회나 외부 응답 대기 중 로그아웃·동일인 재로그인·멤버십 상실·로컬 해제 시 이전 콜백을 거절하며 Operations·Queue·운영자 Naver grant를 바꾸지 않습니다. Discord 멤버십 요청 대기 뒤 동일 로그인 세션을 다시 확인하도록 공통 authorize 경계도 보강했습니다.

실제 Viewer 소스와 loopback 가상 응답으로 PC 1440×1024, 모바일 390×844를 확인했습니다. 기본 접힘·명시적 동의·두 단계 로컬 해제(가상 반영 1회)·재연결 안내·불완전한 연결 시작 응답 뒤 unknown 차단과 GET 상태 새로고침을 확인했습니다. 이 흐름의 시작 POST는 1회, 상태 GET은 2회이며 외부 요청은 0회입니다. 가로 넘침과 브라우저 콘솔 오류는 0건입니다.

로컬 env:check는 실제 DISCORD_TOKEN 부재로 BLOCKED(exit 2)이며 assertion 실패와 구분합니다. 2026-10-15 읽기 전용 운영 /healthz는 v5.1.7, status=ok, ready=true입니다. 커넥터 인증이나 이번 버전 배포 성공을 의미하지 않습니다. 실제 참가자 OAuth·앱 권한 검수·별도 계정 E2E는 PENDING입니다.

근거 로그는 v527-focused-final.log, v527-verify-final.log, v527-verify-core.log, v527-npm-ci.log, v527-npm-audit.json, v527-env-check.log입니다. 화면 증거는 v527-browser-proof.json과 PC·모바일 PNG입니다. 커밋 이후 CI·두 기준 Update Stage/Apply/Manifest/Rollback·전체 ZIP manifest는 최종 전달 보고서에 별도 증거로 기록합니다.

## 남은 실제 검증과 사용자 작업

1. 참가자 전용 네이버 앱을 최소 정보로 등록하고 정확한 /naver/participant/callback과 Secret 저장소의 두 선택 변수를 준비합니다. 기존 운영자 앱·키는 유지하고 비밀값은 채팅·Git·로그에 넣지 않습니다.
2. 별도 참가자 Discord·네이버 계정으로 동의·거절·브라우저 변경·state 만료·로그아웃 후 콜백·서버 탈퇴 중 콜백·재연결·로컬 해제를 확인합니다. 실제 OAuth와 서버 A/B 격리는 PENDING입니다.
3. 같은 서버의 중복 계정 충돌, 다른 서버의 독립 연결, 앱/키 변경 후 재연결 안내, 전체 볼륨 복원 후 해제 전 기록 처리와 동의 확인을 기록합니다. 네이버 외부 앱 동의 철회 뒤에는 과거 소유 확인 기록이 현재 동의 증명이 아님을 확인합니다.
4. 기존 Discord·네이버 접수·CHZZK 팔로워 역할·Queue 호출·패스·재시작 복구 E2E도 유지해 검증합니다. 별도 테스트 계정이 없어 확인하지 못한 항목을 PASS로 올리지 않습니다.
5. 실제 Railway env:check·Host Bootstrap·Connector Verification·Production Acceptance·Cutover·Smoke·Runtime Health·Incident와 전체 볼륨 백업·롤백 준비를 확인한 뒤 별도로 배포합니다. 이번 개발에서 운영 트래픽은 변경하지 않습니다.

다음 개발 후보는 검증된 계정 문맥을 사용하는 카페 접수 소유 확인입니다. 네이버 카페 접수 API가 제공하는 식별 정보 범위를 먼저 확인하고, 닉네임만으로 자동 병합하지 않는 기존 원칙을 유지해야 합니다. 이는 이번 버전 구현 완료 항목이 아닙니다.
