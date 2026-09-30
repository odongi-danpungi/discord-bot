# v5.1.0 운영 배포 체크리스트

실제 기준은 v4.17.5 Step 6이다. 이후 v4.17.6 운영 모니터링과 v4.18.0 커뮤니티/계층형 대시보드 개선을 보존하여 통합했다. 스키마는 2이며, GitHub의 과거 v5.0 skeleton은 완성본이 아니다. 실제 서비스 인증·배포·E2E 상태는 **PENDING**이다. 로컬 테스트 통과는 실제 연결 성공을 뜻하지 않는다.

## 설치와 시작

Node.js >=22.22.2에서 저장소를 clone한 뒤 `npm ci`, `npm run preflight`, `npm run check`, `npm run verify:final`을 실행한다. 운영 환경변수를 설정한 뒤 `npm run env:check`, `npm start`를 실행한다. 정상 시작과 `/healthz`를 각각 확인한다. 진단 실패를 토큰 더미 값이나 demo 모드로 우회하지 않는다. 로컬 UI 체험은 `npm run demo`로 분리한다.

## Railway

- 저장소: `odongi-danpungi/discord-bot`, 승인한 통합 커밋을 배포한다. 이 저장소의 Root Directory는 `/`이다. 기존 trading 저장소의 `/discord-bot` 설정을 그대로 사용하지 않는다.
- `railway.json`이 `Dockerfile.railway`와 `/healthz`를 지정한다. 기존 UI의 Build/Start Command override가 있다면 Docker 설정과 충돌하지 않는지 확인한다.
- 기존 운영 데이터 전체를 백업하고 `/app/data` 영구 볼륨을 연결한다. 기존 볼륨은 새 것으로 교체하지 않는다. `./data/backups`도 같은 볼륨 안에 둔다. `RAILWAY_VOLUME_MOUNT_PATH=/app/data`는 실제 볼륨 마운트가 제공해야 하며 변수만 수동으로 넣어 통과시키지 않는다.
- 컨테이너는 초기 볼륨 소유권 설정 후 node 사용자로 내려가 실행한다. Node가 직접 종료 신호를 받는다. 복제본은 1개만 사용한다. JSON 파일 저장소는 여러 독립 인스턴스가 동시에 쓰는 구성을 지원하지 않는다.
- `HOST=0.0.0.0`, `APP_PROFILE=production`, `NODE_ENV=production`을 사용한다. `PORT`는 플랫폼 제공 값을 따른다. 공개 HTTPS 주소를 확인한 뒤 `PUBLIC_BASE_URL`을 맞춘다.
- 자동 운영 전환 전에 별도 검증 환경에서 설치·시작·health·종료·재시작 복구를 검사한다. Linux Docker 빌드와 실제 볼륨 유지 여부는 로컬 Windows 테스트와 별도로 검증한다.
- 읽기 전용 probe의 주기 실행은 `PRODUCTION_MONITOR_INTERVAL_SECONDS=60..3600`, 비활성은 `0`이다. stale/실패/불명 상태의 production gate 차단을 확인한다. 실제 게시·역할 수정은 probe에 포함하지 않는다.

플랫폼 참고: [Railway config as code](https://docs.railway.com/config-as-code), [Volumes](https://docs.railway.com/volumes).

## 환경변수 — 값은 Secret 설정에만 입력

정확한 전체 목록과 기본값은 루트 `.env.example`을 따른다. 서로 다른 비밀값을 재사용하지 않는다.

| 영역 | 변수 | 확인 사항 |
|---|---|---|
| Discord | `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID` | 실제 Bot/Application/Guild 일치, 봇 초대 및 필요한 Slash Command 확인 |
| 권한 | `ADMIN_ROLE_ID` | 필요한 관리자 역할만 지정; Administrator 권한 불필요 |
| Naver | `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`, `NAVER_REDIRECT_URI` | 개발자센터와 공개 HTTPS callback 완전 일치 |
| Cafe | `NAVER_CAFE_ID`, `NAVER_MENU_ID`, `NAVER_MEMO_MENU_ID` | 지정 카페·메뉴에서 허용된 기능을 수동 확인 |
| 토큰 암호화 | `NAVER_TOKEN_KEY`, `NAVER_AUTH_FILE` | 기존 암호화 키 유지. 기존 OAuth 데이터와 키를 함께 안전하게 백업 |
| Naver 검색 모니터 | `NAVER_MONITOR_ENABLED`, `NAVER_MONITOR_QUERY`, `NAVER_MONITOR_CAFE_URL` | 공식 검색 API 기반; 카페 댓글 자동 수집과 구분 |
| CHZZK | `CHZZK_CLIENT_ID`, `CHZZK_CLIENT_SECRET`, `CHZZK_CHANNEL_ID`, `CHZZK_MONITOR_ENABLED` | 실제 32자 채널 ID 및 API 접근 확인 |
| 관리자 | `DASHBOARD_USER`, `DASHBOARD_PASSWORD` | 고유한 강한 암호, 기본/예시값 금지 |
| 위임 운영자 | `DASHBOARD_OPERATOR_USER`, `DASHBOARD_OPERATOR_PASSWORD`, `DASHBOARD_OPERATOR_CAPABILITIES` | 모바일 운영 권한만 필요한 범위로 부여 |
| 공개 접속 | `PUBLIC_BASE_URL`, `VIEWER_URL`, `BROADCAST_TOKEN`, `TRUST_PROXY_HOPS` | 공개 HTTPS origin 및 실제 프록시 홉 수, 임의로 모든 프록시 신뢰 금지 |
| 저장 | `DATA_FILE`, `OPERATIONS_FILE`, `RECOVERY_FILE`, `DISCORD_POLICY_FILE`, `INCIDENT_WORKFLOW_FILE`, `IDEMPOTENCY_FILE`, `NAVER_AUTH_FILE`, `NAVER_MONITOR_FILE`, `NAVER_PARTICIPATION_FILE`, `PARTICIPATION_QUEUE_FILE`, `BROADCAST_OPS_FILE`, `CHZZK_LIVE_FILE`, `BACKUP_DIR` | 모두 `/app/data` 아래로 유지. `BACKUP_DIR=/app/data/backups` |

Discord Intent 및 역할은 사용 기능에 필요한 것만 활성화한다. 구독 역할은 관리자 권한이 없는 전용 역할을 봇 역할 아래에 둔다. 실제 토큰, 암호, 개인 식별정보는 로그·보고서·GitHub Actions에 넣지 않는다. CI에는 실제 서비스 Secret을 주입하지 않는다.

## 실제 E2E 기록표

테스트 전용 Discord 채널과 Naver 메뉴에서 동의한 테스트 계정을 사용한다. 실제 외부 write가 필요한 순서는 운영자의 명시적 테스트 동작으로 실행한다. 각 항목은 시각, 성공/실패, 마스킹한 증거와 원인을 기록한다.

1. Discord 참가 후 Naver Cafe 참가 경로를 실행한다. 통합 Queue에 각 신청이 한 번만 반영되고 계정 매핑이 올바른지 확인한다.
2. 참가 순서, 동시 중복 신청, 새로고침 후 상태를 확인한다.
3. 참가자 호출 → 본인 응답 → 응답 마감 → 노쇼를 각각 확인한다. 다른 계정의 응답은 거부되어야 한다.
4. 다음판/다다음판 미루기를 적용하고 정확한 회차에서 다시 대기 상태가 되는지 확인한다.
5. 추첨과 팀 배정에서 중복·누락이 없는지 확인한다. 공정성 옵션을 사용하면 회차 시작 시 고정된 정책과 일치해야 한다.
6. OBS Overlay를 열고 표시와 갱신을 확인한다. 관리자 Secret이나 불필요한 개인정보가 없어야 한다.
7. 방송 종료 후 Queue, 회차 기록, 통계가 일치하는지 확인한다.
8. 정상 종료·재시작 및 재배포 후 Queue/state/구독/게시 결과가 유지되는지 확인한다. 백업 복원은 복사한 별도 데이터로 연습한다.
9. emergency lock/draining/recovery 중 write 차단과 읽기 전용 진단을 확인한다. 장애 후 Incident 및 Runtime Health 복구를 기록한다.

## 운영 전환 순서

Environment Validation → Host Bootstrap → Connector Verification → Production Acceptance → 승인된 production traffic 활성화 → Cutover & Stabilization → Post-Cutover Smoke → Runtime Health/Incident → 복구 및 rollback 확인. 하나라도 차단이면 다음 단계로 성공 처리하지 않는다. 실인증이 없거나 외부 연결을 확인하지 못하면 PENDING이다.

## 복구와 업데이트

배포 전 실행 커밋과 전체 데이터 백업, NAVER_TOKEN_KEY를 보관한다. 재시작 필요 상태에서 쓰기를 drain하고 기존 프로세스 종료 후 새 버전을 시작한다. 롤백은 이전 코드와 그 코드가 지원하는 스키마/데이터를 함께 고려한다. 현재 통합은 데이터 스키마 2를 유지한다.

Release Center Update JSON은 허용된 앱 코드 경로만 갱신한다. Dockerfile, Railway 설정, CI 및 docs는 전체 ZIP 또는 Git 배포를 사용한다. 서명이 없는 개발 산출물은 서명 필수 trust 정책을 충족하지 않는다. 정책을 낮춰 운영 검증을 우회하지 않는다.

개인 메뉴 패널은 동시 클릭 중복 전송을 차단한다. 다만 최초 외부 메시지 생성 직후 프로세스가 중단되면 로컬 참조 저장 전 메시지가 남을 수 있다. 재게시 전에 해당 채널을 확인한다. 공지 게시의 sending/uncertain 상태는 자동 재전송하지 않고 운영자가 실제 게시 결과를 확인한다.
