# 서버별 공간 모드 켜기 점검표 (`MULTI_WORKSPACE_ENABLED`)

이 문서는 순서만 정리합니다. 값을 바꾸는 일은 운영자가 직접 하고, 이 문서나 코드가 운영값을 바꾸지 않습니다. 비밀값은 어디에도 붙여 넣지 마세요.

## 왜 필요한가
다음 기능은 이 모드가 켜져 있을 때만 준비됩니다(`src/index.js`, `src/workspace-runtime.js`).
- 사용자 포털(`/portal`)과 서버별 공간(`/w/:서버`)
- 치즈 후원 룰렛, OBS 채팅창, 시청자 보상(카드 뒤집기), 기능 숨기기, 호출 응답 시간 설정

현재 운영 기본값은 `false`입니다(`.env.example`, 기존 Railway 변수에 없음 = false).

## 켜기 전에 준비할 값 (서버가 시작하지 않는 조건)
`src/config.js`는 모드가 켜졌는데 아래가 없으면 시작을 멈춥니다.
1. `DISCORD_CLIENT_SECRET`: Discord 개발자 포털 → 애플리케이션 → OAuth2 → Client Secret. 12자 이상이어야 운영 점검을 통과합니다(`src/production-environment.js`).
2. `PUBLIC_BASE_URL`: `https://`로 시작하고 경로가 없는 공개 주소(예: `https://<도메인>`). 끝에 `/` 외의 경로가 있으면 거절됩니다.

## Discord 개발자 포털 설정
3. OAuth2 → Redirects에 `<PUBLIC_BASE_URL>/portal/auth/callback`을 추가합니다.
4. 봇 초대 권한은 포털이 만드는 초대 링크(`/portal/api/servers`의 `installUrl`)를 그대로 씁니다.

## 함께 확인할 값 (없어도 시작은 하지만 기능이 빠짐)
- 치지직 연동(후원 룰렛·채팅창·카드 뒤집기 후원 기회): `CHZZK_VERIFY_ENABLED=true`, `CHZZK_CLIENT_ID`, `CHZZK_CLIENT_SECRET`, 기존 `CHZZK_TOKEN_KEY`(새로 만들지 말 것). 치지직 개발자 센터에서 Scope "후원 조회", "채팅 메시지 조회"를 켜고 방송 계정을 다시 연결해야 합니다.
- 참가자 네이버 연결(선택): `NAVER_PARTICIPANT_CLIENT_ID`, `NAVER_PARTICIPANT_CLIENT_SECRET`, 기존 `NAVER_TOKEN_KEY`.
- 운영 필수(기존 그대로): `APP_PROFILE=production`, `HOST=0.0.0.0`, 정확한 `TRUST_PROXY_HOPS`, 볼륨 `/app/data`.

## 켜는 순서
5. 배포 전 백업: 제작자 화면에서 백업을 만들고 `/app/data`가 볼륨에 있는지 확인합니다.
6. 위 1~3을 넣은 뒤 `MULTI_WORKSPACE_ENABLED=true`로 바꾸고 다시 배포합니다.
7. `GET /healthz`가 200인지, 시작 로그에 오류가 없는지 확인합니다.
8. `/portal`에서 Discord로 로그인 → 내 서버 선택 → "이 서버의 운영 공간 만들기"가 되는지 확인합니다.
9. 운영자 메뉴(통합 운영·방송 등)와 오른쪽 위 톱니바퀴(기능 숨기기)가 보이는지 확인합니다.
10. 참가자 계정으로 같은 서버에 들어가 "내 참가 상태"만 보이는지 확인합니다. (참가자 테스트 계정이 따로 필요)

## 되돌리기
- `MULTI_WORKSPACE_ENABLED=false`로 바꾸고 다시 배포하면 예전 단일 대시보드로 돌아갑니다. 서버별 데이터(`/app/data/workspaces/...`, `operations.json.*.json`)는 지우지 않고 남습니다.

## 확인 상태
- 이 문서의 조건은 코드에서 확인했습니다(`src/config.js`, `src/production-environment.js`, `src/workspace-login.js`).
- 실제 운영에서 켜 본 적은 없습니다: **PENDING** (Railway 체험 종료로 배포 중지 상태).
