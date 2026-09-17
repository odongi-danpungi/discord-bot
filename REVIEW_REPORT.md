# Discord Game Roster Bot v5.0 Final Review Report

- 대상 버전: **5.0.0 · Final Release**
- 기준 버전: **4.16.0 · Full Integration / Stress / Security Test**
- 운영 데이터 스키마: **v2 유지**
- 백업 컨테이너: **v3 + SHA-256 유지**
- 복원 저널: **daengdaeng-restore-transaction-v1 유지**
- Update bundle: **daengdaeng-update-v2 strong-integrity, unsigned**
- 검토 환경: Node.js **v22.16.0** · 프로젝트 최소 요구 **>=22.22.2**보다 낮음
- 실제 Discord Bot Token / Guild credential / Ed25519 운영 private key: **미제공**

## 1. Final Release 목적

v5.0은 v4.10 Incident Workflow → v4.11 Data Reliability → v4.12~v4.14 Recovery hardening → v4.15 Dashboard Final UX → v4.16 Full Integration/Stress/Security 단계를 마무리하는 최종 정리 릴리스다.

이번 단계의 우선순위는 신규 대형 기능 추가가 아니라 다음이다.

1. 최종 코드/참조 재검토
2. 남은 dead/obsolete 경로 정리
3. Windows 설정 마법사와 운영 문서 정리
4. 버전/lockfile/대시보드 표시 정합성 확인
5. 전체 회귀 테스트
6. v4.16 → v5.0 update bundle Stage/Apply 실검증
7. 배포 ZIP 및 최종 handoff 작성

## 2. 전체 재검토에서 발견한 문제와 수정

### 2.1 Windows launcher가 현대 설정 일부를 child process에 전달하지 않던 문제

`scripts/windows-start.js`는 `config.local.json`에 값을 보관할 수 있었지만 실제 `src/index.js`를 spawn할 때 전달하는 allowlist가 오래된 상태였다.

누락 가능 항목:

- `DISCORD_POLICY_FILE`
- `INCIDENT_WORKFLOW_FILE`
- `RESTORE_TRANSACTION_FILE`
- `RECOVERY_RPO_HOURS`
- `RECOVERY_DRILL_AUTO`
- `RECOVERY_DRILL_INTERVAL_DAYS`
- `RECOVERY_DRILL_RETRY_HOURS`

**수정:** v5.0 launcher의 `CONFIG_KEYS`를 현재 `src/config.js`가 지원하는 persistence/recovery 설정과 맞췄다. Windows START/DEV 경로에서도 저장된 복구 정책이 실행 프로세스에 일관되게 전달된다.

### 2.2 SETTINGS.cmd 재설정 시 secret을 매번 다시 입력해야 하던 UX

기존 설정 수정 흐름은 기존 Bot Token과 Dashboard Password가 있어도 항상 다시 입력하도록 요구했다.

**수정:** 기존 secret이 유효하게 저장되어 있으면 비밀 프롬프트에서 **Enter = 기존 값 유지**가 가능하도록 변경했다. 기존 값은 화면에 출력하지 않는다. 새 비밀번호를 입력한 경우에만 확인 입력을 요구한다.

### 2.3 새 config.local.json에 최근 Reliability 기본 설정이 명시되지 않던 문제

기존 마법사는 초기 파일에 Recovery Continuity와 현대 저장 경로 일부를 명시적으로 쓰지 않았다. 런타임 기본값 때문에 기능 자체는 동작하지만, 운영자가 설정 파일만 보고 실제 정책을 파악하기 어려웠다.

**수정:** 신규/재구성 설정 파일에 다음 기본값을 보존한다.

- Discord Policy / Incident / Restore Transaction 파일
- Backup retention
- Recovery RPO
- Automatic Recovery Drill ON/OFF
- Drill interval / retry backoff

### 2.4 실제로 사용되지 않는 legacy avatar renderer

전체 import/reference 검색에서 `public/avatar-legacy.js`는 참조가 **0개**였다. 현재 Avatar UI/Viewer/Studio는 `public/avatar.js`만 사용한다.

**수정:** `public/avatar-legacy.js`를 제거했다.

반대로 `public/race-renderer-legacy.js`는 `race-renderer.js`에서 과거 `draw.version < 3` 저장 결과 재생에 실제로 사용되므로 제거하지 않았다.

### 2.5 보안이 약한 v1 release bundle 신규 생성 경로

Release Center는 과거 migration을 위해 `daengdaeng-update-v1`을 읽을 수 있지만, 신규 bundle 생성기에도 `--legacy` 옵션이 남아 있었다. v1은 v2/v3의 base SHA-256/전체 manifest 보장이 없다.

**수정:** `scripts/make-release-bundle.js`에서 신규 `--legacy` 생성 경로를 제거했다.

v5.0 신규 생성:

- v2 `strong-integrity`
- v3 `Ed25519 signed`

기존 v1 **읽기 호환**은 오래된 설치의 migration 안전성을 위해 Release Center에 남겼다.

### 2.6 오래된 버전 문구

최종 정리 중 다음 stale 표시를 발견했다.

- 관리자 dashboard footer/header: v4.15
- Game Studio: v4.14
- startup recovery checkpoint label: v4.14

**수정:** UI는 v5.0 Final Release로 정리하고 recovery checkpoint label은 향후 버전에 덜 결합되도록 `시작 초기 보호 지점`으로 변경했다.

## 3. Final Release 운영 개선

### 3.1 `npm run preflight`

새 `scripts/preflight.js`는 Discord를 변경하지 않고 다음을 확인한다.

- Node.js 지원 버전
- package / lockfile / shared APP_VERSION 정합성
- Data schema
- dependency supply-chain 문서
- 필수 배포 파일
- `.env`, `config.local.json` 같은 로컬 비밀 파일 존재 여부
- demo 설정 파서
- `config.local.json`이 있으면 실제 설정 유효성

### 3.2 README 재구성

기존 README는 여러 릴리스의 긴 이력을 모두 포함해 현재 설치/운영 절차가 뒤쪽에 묻혀 있었다.

v5.0 README는 다음 순서로 재작성했다.

1. 현재 Final Release 개요
2. 빠른 시작
3. Preflight
4. Discord 운영 흐름
5. Dashboard / Race / OBS
6. 실시간 동기화
7. Data & Recovery
8. Security
9. Test
10. v4.16 → v5.0 Update
11. Troubleshooting

세부 과거 릴리스 이력은 `CHANGELOG.md`에 유지한다.

## 4. 버전/호환성

- `package.json`: **5.0.0**
- `package-lock.json`: **5.0.0**
- `package-lock.json packages[""]`: **5.0.0**
- `src/version.js APP_VERSION`: **5.0.0**
- Data schema: **2 유지**
- Backup container: **v3 유지**
- Restore journal: **v1 유지**
- Discord permission / Privileged Gateway Intent: **추가 없음**

v4.16의 기존 `data/`와 `config.local.json`을 보존해 업그레이드할 수 있다.

## 5. 코드/정적 검사

### 5.1 JavaScript static check

`npm run check`

- 검사 JavaScript 파일: **109개**
- 결과: **PASS**

### 5.2 Final Release 집중 회귀

`test/final-release.test.js` + setup/version 검증에서 다음을 확인했다.

- 5.0.0 metadata 정합성
- dead avatar legacy 파일 제거
- release generator v1 생성 제거
- 현대 persistence/recovery 설정 launcher 전달
- README Final Release 중심 구조
- stale runtime/UI version label 제거
- 기존 setup token 보호
- package/lock/shared version 일치

집중 검증: **PASS**

## 6. 전체 테스트 결과

### 6.1 dependency-independent suite

현재 sandbox에서 외부 npm package load가 필요하지 않은 전체 회귀 suite:

- **184 tests**
- **184 PASS**
- **0 FAIL**

여기에는 다음 핵심 영역이 포함된다.

- 모집 → 추첨 → 참석 → 팀 → 종료 E2E/stress
- Race simulation
- Request dedupe storm
- Data Reliability / atomic JSON / recovery
- Backup integrity / restore transaction / recovery drill
- Incident / Runtime / Performance
- Discord policy / drift / safe fix logic
- Release Center / trust / manifest
- Supply Chain
- Dashboard/Broadcast 정적 wiring
- v5.0 Final Release 회귀

### 6.2 전체 `npm test`

현재 제공 sandbox 결과:

- 총 **191**
- PASS **184**
- FAIL **7**
- 실행된 기능 assertion 실패: **0**

7개 실패는 코드 assertion 실패가 아니라 test module load 이전의 환경 오류다.

현재 sandbox에 설치되지 않은 package:

- `express`
- `discord.js`
- `jsdom`
- `dotenv`

영향받는 test file class:

- API/server integration
- JSDOM dashboard/viewer
- Discord service import
- standalone/startup integration

또한 sandbox Node.js는 **v22.16.0**으로 프로젝트 최소 **>=22.22.2**보다 낮다.

따라서 **지원 런타임 + `npm ci --ignore-scripts`가 완료된 실제 배포 환경에서 `npm test`를 한 번 더 실행하는 것이 production acceptance 조건**이다.

## 7. Preflight 결과

현재 sandbox의 `npm run preflight`:

- Node.js: **FAIL** — 22.16.0 / 요구 >=22.22.2
- package/src/lock version: **PASS**
- Data schema: **PASS**
- Supply Chain: **PASS**
- lock packages: **132**
- missing integrity: **0**
- 필수 배포 파일: **PASS**
- 배포 루트 비밀 파일: **PASS**
- config parser: **PASS**
- local config: 없음, 첫 실행 wizard 상태로 정상

Preflight의 유일한 현재 실패 원인은 sandbox Node.js 버전이다.

## 8. v4.16 → v5.0 Update bundle 검증

생성 파일:

`daengdaeng-update-4.16.0-to-5.0.0.json`

형식:

- `daengdaeng-update-v2`
- strong-integrity
- unsigned
- base: **4.16.0**
- target: **5.0.0**

실제 v4.16 Release Center로 별도 복제본에서 Stage / Apply를 실행했다.

Stage:

- **PASS**
- Base drift: **0**
- Add: **2**
- Change: **12**
- Delete: **1**

Delete:

- `public/avatar-legacy.js`

Apply:

- **PASS**
- 상태: `restart-required`

적용 후 manifest 비교:

- Apply copy: **134 files**
- Final v5.0 target: **134 files**
- SHA-256 manifest digest 일치: **PASS**
- digest: `0c682508f688a1caa733e6faf250395361225b7adc74c04e039f3d51d4ef6aff`

## 9. Signed update 상태

실제 운영 Ed25519 private key가 제공되지 않았으므로 임의 키를 생성해 "운영 서명"으로 가장하지 않았다.

따라서 제공 update JSON은 **v2 unsigned strong-integrity**다.

운영 Release Trust Policy가 `required`인 경우 실제 신뢰된 private key로 다음 형태의 **v3 signed bundle**을 별도로 생성해야 한다.

```bash
npm run release:bundle -- <v5-folder> <output.json> --sign-key <private.pem> --channel stable --key-name "Release Publisher"
```

private key는 프로젝트/ZIP/Git 밖에서 보관한다.

## 10. Discord live validation 상태

실제 Bot Token/Guild credential이 제공 파일에 없으므로 운영 Discord 서버에 write 요청을 보내는 live-guild 테스트는 수행하지 않았다.

배포 직전 실제 서버에서 다음을 확인해야 한다.

1. `npm run preflight`
2. 전체 `npm test`
3. `/setting` dry-run/실행 범위
4. `/연동`
5. Discord Permission Audit
6. Discord Policy / Drift monitor
7. 모집 → 추첨 → 참석 → 팀 → 종료 실제 1회
8. 닉네임 변경 role hierarchy
9. OBS Browser Source
10. Recovery latest backup / Recovery Drill

## 11. 배포 보안

최종 ZIP에 포함하지 않아야 하는 것:

- `.env`
- `config.local.json`
- `node_modules/`
- 실제 `data/` 운영 파일
- Discord Bot Token
- Dashboard password
- Broadcast token
- Release private key

빈 `data/.gitkeep`만 배포한다.

## 12. 최종 판정

**코드 기준 v5.0 Final Release 정리 작업은 완료됐다.**

완료된 것:

- v4.10~v4.16 안정화 결과 통합
- 최종 dead code/버전/문서/설정 마법사 정리
- dependency-independent 회귀 184/184 PASS
- v4.16 → v5.0 Stage/Apply/Manifest 검증 PASS
- 배포 ZIP 생성 대상 정리

운영 배포 전에 외부 환경에서 남은 필수 확인:

- Node.js >=22.22.2
- npm dependencies 설치 후 전체 191 test 재실행
- 실제 Discord Guild live preflight
- Trust Policy가 required라면 운영 Ed25519 private key로 v3 signed update 생성

이 네 항목은 코드 결함 미해결이 아니라 현재 sandbox/credential/signing-key 제약에 따른 **deployment acceptance prerequisites**다.
