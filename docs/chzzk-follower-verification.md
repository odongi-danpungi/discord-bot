# CHZZK 팔로워 인증

Discord 인증 패널 → 본인에게만 보이는 10분 링크 → CHZZK 로그인·동의 → 사용자 채널 ID 확인 → 방송 채널 팔로워 조회 → 인증 역할 부여 → 선택적 닉네임 동기화.

## 운영 설정

1. CHZZK 개발자 센터에 앱을 등록하고 **유저 정보 조회**, **채널 팔로워 조회** 범위를 승인받습니다. Callback URL은 `PUBLIC_BASE_URL`의 origin에 `/oauth/chzzk/callback`을 붙인 주소와 정확히 일치해야 합니다. 참가자 자신의 팔로워 목록을 조회하지 않으며 방송 채널 소유자의 별도 동의를 사용합니다.
2. Railway에 `CHZZK_CLIENT_ID`, `CHZZK_CLIENT_SECRET`, `CHZZK_CHANNEL_ID`, `PUBLIC_BASE_URL`, `CHZZK_VERIFY_ENABLED=true`, `CHZZK_VERIFY_ROLE_ID`, `CHZZK_TOKEN_KEY`를 설정합니다. `CHZZK_VERIFY_NICKNAME_SYNC=false`이면 닉네임을 변경하지 않습니다.
3. `CHZZK_TOKEN_KEY`는 별도로 생성한 32바이트 무작위 키입니다. 서버에서 `node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"`로 만들고 Secret 저장소에 직접 보관하세요. 키와 실제 토큰을 채팅·Git·로그에 남기지 않습니다.
4. 인증 전용 역할의 서버 권한을 비우고 봇 역할보다 아래로 배치합니다. 이 역할에 허용한 채널 접근은 인증 성공 시 함께 부여될 수 있으므로 관리자 채널 접근은 허용하지 마세요. 봇에는 역할 관리, 선택적으로 닉네임 관리, 패널 채널의 보기·메시지 전송·임베드·기록 읽기만 필요합니다. Administrator 및 새 Privileged Intent는 요구하지 않습니다.
5. 관리자 Dashboard → **CHZZK · 계정 연동 · 팔로워 인증** → **방송 채널 연결 시작**에서 방송 채널 소유자로 로그인합니다. 다른 채널로 로그인하면 거부됩니다.
6. 패널을 게시할 Discord 채널 ID를 입력하고 게시 버튼을 누릅니다. 참가자는 패널의 **치지직 계정 인증**, **내 연동 상태** 버튼을 사용합니다. `/연동` 게임 정보 등록 기능은 그대로 유지됩니다.

## 처리와 제한

- 링크는 Discord 사용자·서버 실행에 묶인 10분짜리 일회용 bearer 링크입니다. 다른 사람에게 공유하면 안 됩니다. 브라우저 시작 시 Secure·HttpOnly·SameSite=Lax 쿠키에 묶고 Callback에서 state와 쿠키를 함께 확인합니다. 재발급하면 이전 링크는 무효화되며 재시작 시 미완료 링크도 만료됩니다.
- 참가자 토큰은 사용자 조회 후 저장하지 않습니다. Discord ID·CHZZK 채널 ID·닉네임·인증 상태·처리 시간만 저장합니다. 방송 채널의 OAuth 토큰은 AES-256-GCM으로 암호화해 atomic JSON store에 보관합니다. 운영 API에는 개인별 인증 목록·토큰을 반환하지 않습니다.
- 한 CHZZK 계정을 여러 Discord 계정에 연결하거나 기존 연결을 다른 CHZZK 계정으로 바꾸는 것을 차단합니다. 연결 해제·계정 교체 셀프서비스는 이번 범위에 포함하지 않았습니다.
- 팔로워 조회는 요청 묶음마다 최대 50페이지/2,500명, 총 약 20초의 스캔 예산(진행 중인 단일 요청은 최대 7초 추가)을 사용하며 결과를 2분간 메모리에 공유합니다. 목록 전체를 읽지 못하면 **PENDING_SCAN**입니다. 최근 팔로우 반영 시간은 보장하지 않습니다. 대규모 채널은 별도 승인된 조회 전략이 필요합니다.
- `내 연동 상태`는 최초 연결 이후 재확인과 실패 적용 재시도를 수행합니다. 개인당 적용 간격은 2분이며 병렬 요청을 합칩니다. API 429에는 1분 대기하며 OAuth 코드 교환·Discord 쓰기를 무작정 재시도하지 않습니다.
- 본인 재인증은 기존 확인 작업이 끝난 뒤 최신 이름을 저장하고 다시 검증합니다. 재인증 및 역할·닉네임 정책 변경은 이전 2분 결과를 재사용하지 않습니다. 새 링크 발급은 진행 중인 이전 Callback도 다음 저장/적용 전에 무효화합니다. 이미 Discord에 전달된 요청을 취소하거나 완료된 역할을 회수하지는 않습니다.
- 방송 채널 재연결과 오래된 토큰 갱신이 겹치면 새로 연결한 인증 정보를 보존합니다. 인증 패널의 동시 게시도 저장된 메시지 참조를 순서대로 갱신해 중복 게시를 줄입니다.
- 역할 적용 전 의도를 저장하고 기존 역할·닉네임을 조회해 재시도합니다. 닉네임 실패는 PARTIAL, 역할/권한 실패는 APPLY_FAILED로 구분합니다. 긴급 잠금·draining·release/restart 대기 중에는 쓰기를 차단합니다.
- 인증 역할의 **자동 회수**, 팔로우 해제 감시, Discord 탈퇴 시 연결 기록 삭제는 구현하지 않았습니다. 팔로우 인증은 영구 자격 보장이 아닙니다. 운영자가 보관 기간과 삭제 절차를 정해야 합니다.
- `chzzk-verification.json`과 `.bak`에는 최소 식별정보와 암호화 토큰이 있으므로 persistent volume에 보관하고 접근 권한을 제한하세요. 기존 Queue/회차 백업은 이 인증 파일을 포함하지 않으므로 별도로 암호화 파일과 키를 백업해야 합니다. 키를 잃으면 채널 재동의가 필요합니다.
- 인증 파일의 `.bak`/`.tmp` 복구는 Discord 로그인 전에 수행하고, 시작 감사 및 Dashboard/Runtime Health의 복구 표시에도 반영합니다.

## 실제 검증 (인증 없으면 PENDING)

1. 운영자 소유자 동의 성공 / 다른 채널 거부 / 권한 동의 거부.
2. Discord 본인 전용 링크 표시 / 10분 만료 / 재사용 거부 / 다른 브라우저 쿠키 거부.
3. 실제 팔로워에게 역할과 닉네임 적용. 미팔로워·API 오류·스캔 미완료에는 새 역할 부여 없음.
4. 동일 CHZZK 계정의 다른 Discord 연결 거부. 같은 참가자 동시 클릭 시 단일 적용.
5. 봇 역할 순서/역할 관리 권한 부족, 닉네임 권한 부족의 실패 상태 확인.
6. 긴급 잠금 후 Callback에도 역할 쓰기 차단. 서버 재시작 후 연결 기록·암호화 방송 토큰 복구, 미완료 링크 무효화.
7. 갱신 토큰 회전 및 401/429, 새 팔로우 재확인. 실제 Token·Secret은 테스트 보고서에 포함하지 않습니다.

공식 명세: [CHZZK Authorization](https://chzzk.gitbook.io/chzzk/chzzk-api/authorization), [User](https://chzzk.gitbook.io/chzzk/chzzk-api/user), [Channel](https://chzzk.gitbook.io/chzzk/chzzk-api/channel), [Discord Guild member/role](https://docs.discord.com/developers/resources/guild).
