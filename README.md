# 댕댕봇 5.0 · Final Release

Discord 시참 모집, 무작위 추첨, 참석 확인, 팀 편성, 레이스 연출, OBS 방송 화면, 운영 복구와 업데이트까지 하나의 PC 관리자 대시보드에서 관리하는 프로젝트입니다.

v5.0은 v4.10~v4.16 안정화 로드맵을 마무리한 **최종 정리 릴리스**입니다. 운영 데이터 스키마는 **v2**, 백업 컨테이너는 **v3 + SHA-256**, 복원 저널은 **daengdaeng-restore-transaction-v1**을 유지합니다. 기존 v4.16 데이터와 설정을 그대로 사용할 수 있습니다.

## v5.0에서 정리한 내용

- 프로젝트 버전/lockfile/공용 버전 모듈을 5.0.0으로 통일
- Windows 첫 실행/설정 수정 마법사 개선
  - 기존 Bot Token/대시보드 비밀번호는 `SETTINGS.cmd`에서 Enter로 유지 가능
  - Discord Policy, Incident, Restore Transaction, Recovery Continuity 설정까지 실행 프로세스로 전달
  - 복구 훈련/RPO 관련 기본값을 `config.local.json`에 명시적으로 보존
- `npm run preflight` 추가
  - Node.js 버전
  - package/lock/version 정합성
  - dependency supply-chain 문서
  - 필수 배포 파일
  - 설정 파서
  - 로컬 설정 유효성 검사
- 사용되지 않는 `public/avatar-legacy.js` 제거
- 업데이트 생성기에서 보안이 약한 v1 `--legacy` 생성 경로 제거
  - v2 strong-integrity 또는 v3 Ed25519 signed bundle만 새로 생성
  - 기존 Release Center의 과거 bundle 읽기 호환은 유지
- README를 현재 v5.0 운영/설치 기준으로 재구성하고 과거 릴리스 상세는 `CHANGELOG.md`로 이동
- v4.16 통합/스트레스/보안 검증 경로를 최종 회귀 테스트에 포함

## 실행 환경

- Node.js **22.22.2 이상**
- 권장: Node.js **24 LTS**
- Windows에서는 `START.cmd`, `SETTINGS.cmd`, `DEMO.cmd`를 권장
- Bot Token, 대시보드 비밀번호, Release private key는 코드/ZIP/Git에 포함하지 마세요.

## 가장 빠른 시작

### 1. 연습 모드

Discord 연결 없이 화면과 기본 동작을 확인하려면:

```text
DEMO.cmd
```

기본 포트는 `3001`입니다.

### 2. 실제 봇 첫 실행

```text
START.cmd
```

첫 실행 시 설정 마법사가 다음 필수 값을 요청합니다.

- Discord 애플리케이션 ID
- Discord 서버 ID
- Bot Token
- 관리자 대시보드 비밀번호 12자 이상

`BROADCAST_TOKEN`은 자동 생성됩니다. 설정은 프로젝트 루트의 `config.local.json`에 저장되며 이 파일은 배포 ZIP에 포함되지 않습니다.

### 3. 설정 수정

```text
SETTINGS.cmd
```

이미 설정된 Bot Token/대시보드 비밀번호는 비밀값 입력 프롬프트에서 **Enter**를 누르면 기존 값을 유지합니다.

### 4. 개발 모드

```text
DEV.cmd
```

또는 직접:

```bash
npm ci --ignore-scripts
npm run check
npm test
npm run dev
```

## 최종 실행 전 Preflight

```bash
npm run preflight
```

PASS가 필요한 주요 항목:

- 지원 Node.js 버전
- `package.json` / `package-lock.json` / `src/version.js` 버전 일치
- lockfile supply-chain 문서 검증
- 필수 배포 파일 존재
- 설정 파서 정상
- `config.local.json`이 존재하면 값 범위와 필수 Discord 설정 검증

`preflight`는 실제 Discord 서버를 변경하지 않습니다.

## 기본 주소

```text
관리자 대시보드  http://127.0.0.1:3000/
방송 화면        http://127.0.0.1:3000/broadcast/
시청자 화면      http://127.0.0.1:3000/viewer/
```

기본 `HOST=127.0.0.1`은 이 PC에서만 접근할 수 있습니다.

## Discord 기능

주요 운영 흐름:

1. `/setting`으로 프로젝트용 카테고리/채널 구조를 준비
2. `/연동` 및 대시보드에서 참가자 정보를 관리
3. 모집 시작
4. 참가자 등록/예약
5. 모집 종료
6. 레이스 / 사다리 / 즉시 추첨
7. 참석 확인
8. 팀 편성
9. Discord 닉네임/운영 반영
10. 회차 종료 및 기록 보관

프로젝트는 **Administrator 권한을 기본 요구하지 않습니다.** Discord Permission Audit 화면에서 실제 Guild 권한, 역할 hierarchy, Application Command, Intent 상태를 확인할 수 있습니다.

Privileged Gateway Intent는 기능상 필요하지 않으면 활성화하지 않는 방향을 유지합니다.

## 관리자 대시보드

v4.15에서 최종 PC 정보 구조를 정리했고 v5.0에서도 그대로 유지합니다.

- **LIVE OPERATIONS**
  - Control Center
  - Live Director
  - 모집/예약/추첨/참석/팀
  - Incident Workflow
- **RELIABILITY**
  - Runtime Health
  - Performance & Capacity
  - Recovery
  - Backup Integrity
  - Recovery Drill / Continuity
- **DELIVERY**
  - Production Readiness
  - Release Center
  - Supply Chain
- **DISCORD & SYSTEM**
  - Discord Permission Audit
  - Discord Policy / Drift
  - 설정/연결 상태
- **EXTERNAL VIEWS**
  - Game Studio
  - OBS Broadcast
  - Viewer

대시보드 화면은 `/#recovery`, `/#incidents`, `/#release` 같은 hash deep-link를 지원합니다.

## 추첨 모드

현재 신규 추첨 모드는 다음 세 가지입니다.

- 자동차 레이스
- 사다리
- 즉시 추첨

과거 저장 데이터에 남아 있는 이전 모드는 새로 생성하지 않고 결과 기록만 호환 표시합니다.

## OBS Browser Source

기본 URL:

```text
http://127.0.0.1:3000/broadcast/
```

권장 크기:

```text
1920 × 1080
```

투명 배경:

```text
http://127.0.0.1:3000/broadcast/?transparent=1
```

2배속 예시:

```text
http://127.0.0.1:3000/broadcast/?speed=2
```

동시 사용:

```text
http://127.0.0.1:3000/broadcast/?transparent=1&speed=2
```

외부 네트워크에서 방송 화면을 공개해야 한다면 HTTPS reverse proxy와 접근 제어를 먼저 구성하고 `BROADCAST_TOKEN`을 사용하세요.

```text
https://your-domain.example/broadcast/?token=YOUR_BROADCAST_TOKEN
```

토큰이 URL query에 들어가므로 reverse proxy/access log 정책도 확인하세요.

## 실시간 동기화

관리자:

- `/api/events` SSE
- heartbeat
- 연결 끊김 자동 재연결
- fallback polling
- connection limit
- slow-client backpressure 시 중간 snapshot 제거 후 최신 snapshot만 유지

방송:

- `/broadcast/api/events` 별도 SSE
- 읽기 전용 방송 snapshot
- Discord User ID/관리자 CSRF/전체 참가자 원본 데이터 미노출
- Race 데이터는 필요한 draw만 별도 조회

## 데이터와 복구

기본 저장 파일:

```text
./data/registrations.json
./data/operations.json
./data/recovery.json
./data/discord-policy.json
./data/incidents.json
./data/restore-transaction.json
./data/backups/
```

주요 보호 장치:

- 파일 경로 단위 JSON 저장 직렬화
- `.tmp` / `.bak` / `.bak.prev` 복구
- fsync + atomic rename
- 중복 요청 coalescing
- 비정상 종료 후 상태 일관성 복구
- 참가자/운영 데이터 다중 파일 transaction restore
- 복원 실패 rollback
- v3 backup SHA-256 integrity
- 자동 비파괴 Recovery Drill
- RPO/복구 훈련 주기 Production Readiness 연동

`data/`와 `config.local.json`은 업데이트 시 보존하세요.

## 주요 설정

`.env.example`에 전체 예시가 있습니다. Windows 기본 운영에서는 `config.local.json`을 사용합니다.

```text
DISCORD_TOKEN
DISCORD_CLIENT_ID
DISCORD_GUILD_ID
DASHBOARD_USER
DASHBOARD_PASSWORD
BROADCAST_TOKEN
ADMIN_ROLE_ID
HOST
PORT
VIEWER_URL
DATA_FILE
OPERATIONS_FILE
RECOVERY_FILE
DISCORD_POLICY_FILE
INCIDENT_WORKFLOW_FILE
RESTORE_TRANSACTION_FILE
BACKUP_DIR
BACKUP_KEEP_COUNT
BACKUP_MAX_AGE_DAYS
BACKUP_INTERVAL_HOURS
RECOVERY_RPO_HOURS
RECOVERY_DRILL_AUTO
RECOVERY_DRILL_INTERVAL_DAYS
RECOVERY_DRILL_RETRY_HOURS
APP_PROFILE
```

## 보안 기준

- Bot Token/API key/password/private key 하드코딩 금지
- 관리자 대시보드: Basic Auth + CSRF + same-origin/Host 방어
- Viewer session: HttpOnly + SameSite=Strict cookie
- 방송 외부 접근: Broadcast token 또는 관리자 인증
- Release Apply/Rollback/Trust 변경: localhost + 2단계 승인
- Update path traversal/symlink/protected path 차단
- Discord alert allowed mentions 제한
- Discord Administrator 권한 기본 미사용
- Release private key는 프로젝트 폴더와 ZIP 밖에서 보관

토큰이 노출되었다면 Discord Developer Portal에서 즉시 재발급하세요.

## 테스트

정적 검사:

```bash
npm run check
```

전체 테스트:

```bash
npm ci --ignore-scripts
npm test
```

최종 Preflight:

```bash
npm run preflight
```

주요 테스트 범위:

- 모집 → 추첨 → 참석 → 팀 → 종료 E2E
- LoL / Eternal Return 반복 흐름
- Race 5개 맵 반복 simulation
- 동일 requestId POST storm
- JSON atomic write / 손상 복구 / crash recovery
- backup integrity / transactional restore / recovery drill
- SSE 다중 연결 / connection limit / backpressure
- Discord Permission / Policy / Drift / Safe Fix
- Release Stage / Apply / Rollback / Manifest
- Supply-chain / dependency lock integrity
- Dashboard / Broadcast / Viewer UI regression

## v4.16 → v5.0 업데이트

운영 중인 v4.16에서 업데이트할 때:

1. 현재 `data/`와 `config.local.json`을 별도 백업
2. v4.16 대시보드 Recovery에서 최신 정상 백업 확인
3. v4.16→v5.0 update bundle Stage
4. diff / base drift / integrity 확인
5. 2단계 승인 후 Apply
6. 프로세스 재시작
7. `npm run preflight`
8. 대시보드 Production Readiness / Discord Audit / Recovery 상태 확인

v5.0 업데이트 생성기는 새 v1 legacy bundle을 만들지 않습니다.

무서명 strong-integrity bundle:

```bash
npm run release:bundle -- <v5-folder> <output.json>
```

Ed25519 서명 v3 bundle:

```bash
npm run release:bundle -- <v5-folder> <output.json> --sign-key <private.pem> --channel stable --key-name "Release Publisher"
```

운영 Release Trust Policy가 `required`라면 신뢰된 Ed25519 키로 서명한 v3 bundle이 필요합니다.

## Release key

새 Ed25519 키를 생성해야 할 때:

```bash
npm run release:keygen
```

private key는 **프로젝트/ZIP/Git 밖**에 보관하세요. 공개키만 Release Trust Store에 등록합니다.

## 배포 ZIP에 포함하지 않는 것

- `.env`
- `config.local.json`
- `node_modules/`
- 실제 `data/` 운영 파일
- Discord Bot Token
- Dashboard password
- Broadcast token
- Release private key

배포 ZIP에는 빈 `data/.gitkeep`만 포함합니다.

## 문제 해결

### Node.js 버전 오류

Node.js 22.22.2 이상으로 업데이트하세요. 권장은 Node.js 24 LTS입니다.

### 첫 실행 package 설치 실패

인터넷 연결과 npm 사용 가능 여부를 확인한 뒤 다시 `START.cmd`를 실행하세요. 자동 설치는 lockfile 기준 production dependency만 설치하며 install script를 실행하지 않습니다.

### config.local.json 오류

`SETTINGS.cmd`로 다시 설정하거나 JSON 형식을 확인하세요. 비밀값을 채팅에 붙여넣지 마세요.

### Discord 권한 문제

관리자 대시보드의 **Discord Permission Audit**과 **Discord Policy**에서 누락 권한/역할 hierarchy/command drift를 먼저 확인하세요. 자동 Safe Fix는 프로젝트가 소유한 안전한 범위만 변경합니다.

### Recovery가 FAIL

손상 파일을 직접 덮어쓰기보다 Recovery 화면에서 최신 정상 백업, transaction journal, Recovery Drill 결과를 확인하세요.

## 변경 이력

상세 버전별 변경 사항은 [`CHANGELOG.md`](./CHANGELOG.md)에 있습니다.
