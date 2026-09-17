# Changelog

## 5.0.0
- Final Release 단계 완료
- 프로젝트 버전, package-lock, 공용 APP_VERSION을 5.0.0으로 정합성 업데이트
- Windows 첫 실행/설정 수정 마법사 개선: 기존 secret Enter 유지, 현대 persistence/recovery 설정 전체 전달
- `npm run preflight` 추가: Node 버전, package/lock/version, supply-chain, 필수 파일, 설정 파서/로컬 설정 검사
- 사용되지 않는 `public/avatar-legacy.js` 제거
- Release bundle 생성기에서 보안이 약한 v1 `--legacy` 생성 경로 제거; 신규 생성은 v2 strong-integrity 또는 v3 Ed25519 signed만 지원
- Release Center의 기존 과거 bundle 읽기 호환은 마이그레이션 안전성을 위해 유지
- README를 현재 v5.0 설치/운영/복구/배포 흐름 중심으로 재작성하고 상세 과거 이력은 CHANGELOG로 통합
- v4.16 통합/스트레스/보안 회귀와 v5.0 final-release 회귀 테스트 추가/갱신
- 데이터 스키마 v2, 백업 컨테이너 v3, 복원 저널 v1, Discord 권한/Privileged Intent 요구사항 유지

## 4.16.0
- Full Integration / Stress / Security Test 단계 완료
- 관리자/방송 SSE 연결을 공용 `SseHub`로 통합하고 연결 수 제한·종료 정리·heartbeat lifecycle 일원화
- 느린 SSE 클라이언트가 `res.write()` backpressure 상태일 때 중간 snapshot을 계속 버퍼링하지 않고 최신 snapshot 1개만 유지하도록 coalescing 적용
- 관리자 SSE와 OBS/Broadcast SSE에 동일한 backpressure-safe 전송 경로 적용
- Broadcast의 `/assets`가 전체 `public/` 디렉터리를 우회 노출하던 정적 파일 경로를 제거하고 필요한 방송 모듈 5개만 allowlist로 제공
- 모집 → 추첨 → 참석 확인 → 팀 편성 → 종료 전체 흐름을 80회 연속 실행하는 장시간 상태 스트레스 테스트 추가
- 5개 Race 서킷 × 20 seed, 총 100회 레이스에서 당첨자 중복·도착 순서·finish distance 일관성 검증 추가
- 동일 `requestId` 40개 동시 요청 storm이 실제 상태 변경 1회로 합쳐지는 중복 요청 스트레스 테스트 추가
- SSE 연결 한도, disconnect 중복 처리, slow-client backpressure coalescing 회귀 테스트 추가
- Broadcast 정적 자산 allowlist와 관리자 보안 경계(CSP/CSRF/local-only release) 회귀 검사 추가
- v4.15 UI 회귀 테스트를 새로운 SSE 관리 구조에 맞춰 갱신
- 프로젝트 버전 4.16.0으로 정합성 업데이트
- 데이터 스키마 v2, 백업 컨테이너 v3, restore journal v1, Discord 권한/Privileged Intent 유지

## 4.15.0
- Dashboard Final UX 단계 완료
- 관리자 navigation을 LIVE OPERATIONS / RELIABILITY / DELIVERY / DISCORD & SYSTEM 4개 그룹으로 재구성
- 전체 화면 게임 스튜디오와 방송·OBS 화면을 EXTERNAL VIEWS로 분리해 관리 메뉴 중복 축소
- `public/design-system.css` 추가 및 공통 색상/spacing/radius/panel/metrics/navigation/focus/responsive 규칙 통합
- 기존 CSS에서 참조되던 미정의 `--line`, `--panel-2` token alias 추가
- 모든 dashboard page에 context/title/description metadata 추가
- PC sticky header와 일관된 page chrome 적용
- hash deep-link + sessionStorage 탭 복원 추가
- deep-link로 열린 Recovery/Runtime/Incident/Capacity/Deployment/Release/Supply/Discord Audit 화면의 데이터 refresh를 공통 page activation 경로로 통합
- 시스템 연결 화면에서 중복 데이터 백업 제어 제거하고 Recovery/Discord Audit/Deployment 전용 센터 링크로 정리
- skip link, keyboard focus, prefers-reduced-motion, responsive shell 접근성 보강
- primary tab/page 1:1, HTML id 중복, CSS custom property 누락을 검증하는 Dashboard Final UX 회귀 테스트 추가
- Live Director 기존 표시 문구/경로 호환성 회귀 수정
- 프로젝트 버전 4.15.0으로 정합성 업데이트
- 데이터 스키마 v2, 백업 컨테이너 v3, Discord 권한/Intent 유지

## 4.14.0
- Recovery Continuity & Automated Drills 단계 완료
- `RECOVERY_RPO_HOURS` 기반 최신 정상 백업 RPO 평가 추가 (기본 24시간, 1~168시간)
- `RECOVERY_DRILL_INTERVAL_DAYS` 기반 성공 Recovery Drill 재검증 주기 추가 (기본 7일, 1~90일)
- `RECOVERY_DRILL_RETRY_HOURS` 기반 실패 자동 훈련 재시도 backoff 추가 (기본 6시간, 1~24시간)
- `RECOVERY_DRILL_AUTO` 자동 비파괴 Recovery Drill 스케줄러 추가
- 시작 5분 후 및 매시간 continuity 정책을 평가하고 due 상태에서만 자동 훈련 실행
- 실패 직후 반복 실행을 방지하고 backoff 만료 뒤에만 자동 재시도
- 자동/수동 Recovery Drill 공용 실행 잠금을 첫 await 전에 예약해 동시 실행 race 수정
- Recovery Drill을 BackupRetention 직렬화 큐에 포함해 create/prune과 파일 접근 충돌 방지
- Recovery Store drill 기록에 manual/automatic trigger 저장 및 기존 기록 호환 유지
- `/api/recovery`에 RPO, drill cadence, due reason, next run 정보를 포함한 continuity snapshot 추가
- Production Readiness backup/recovery gate를 Recovery Continuity 정책에 연결
- Recovery UI에 RPO 상태, 자동 훈련 상태, 다음 예정 시각, 최근 훈련 소요 시간 표시
- 설정 파서에 엄격한 boolean 검증 추가 (`true/false`, `1/0`, `yes/no`, `on/off`)
- Recovery Continuity 단위 테스트 및 UI/Readiness 회귀 검사 추가
- 프로젝트 버전 4.14.0으로 정합성 업데이트
- 데이터 스키마 v2 및 백업 컨테이너 v3 유지; Discord 권한/Intent 추가 없음

## 4.13.0
- Transactional Restore & Recovery Drill 단계 완료
- 참가자/운영 JsonStore를 하나의 write barrier로 예약하는 multi-store transaction primitive 추가
- `daengdaeng-restore-transaction-v1` 복원 저널과 before/target SHA-256 스냅샷 추가
- 복원 파일별 durable write + read-after-write digest 검증 후에만 다음 단계 진행
- 두 파일이 모두 검증된 뒤 메모리 상태를 함께 게시해 부분 복원 상태 노출 방지
- 복원 실패 시 두 저장소 자동 rollback, rollback 실패 시 저널 보존 및 다음 시작 복구 경로 추가
- 시작 시 중단된 restore journal의 before/target/mixed/diverged 상태를 검사해 완료 또는 rollback하도록 복구 절차 추가
- 손상/변조된 restore journal 자동 삭제 금지 및 명시적 복구 오류 처리 추가
- 복원 직전 Recovery checkpoint를 multi-store barrier 안에서 생성해 기준 시점 일치 보장
- `RESTORE_TRANSACTION_FILE` 선택 설정 추가
- 최신 사용 가능 백업을 OS 임시 폴더에 실제 복원·재오픈하는 비파괴 Recovery Drill 추가
- Recovery Drill에서 migration/consistency repair와 combined SHA-256 round-trip 검증 수행
- Recovery Store에 최근 20개 drill 요약을 저장하고 관리자 복구·감사 UI에서 실행/상태 표시
- Production Readiness에 최근 30일 Recovery Drill gate 추가
- 디스크 JSON canonicalization과 메모리 snapshot을 일치시켜 `undefined` 필드로 인한 복원 digest 불일치 가능성 수정
- 프로젝트 버전 4.13.0으로 정합성 업데이트
- 데이터 스키마 v2 및 백업 컨테이너 v3 유지

## 4.12.0
- Backup Integrity & Disaster Recovery 단계 완료
- 자동/수동 백업 포맷을 v3로 올리고 canonical payload SHA-256 무결성 메타데이터 내장
- 백업 쓰기 직후 파일을 다시 읽어 구조·Guild·Schema·SHA-256을 검증하는 read-after-write 검사 추가
- 백업 생성/정리/최근성 확인을 단일 직렬화 큐로 묶고 동일 millisecond 이름 충돌 방지용 난수 suffix 추가
- 최신 파일이 손상돼도 마지막 정상 백업을 별도로 추적하고 즉시 integrity-repair 자동 백업 생성
- 기존 v2 백업은 복구 가능 상태로 유지하되 legacy 경고를 표시하고 다음 자동 점검에서 v3로 승계
- retention 정리에서 손상 파일 때문에 마지막 정상 백업이 삭제되지 않도록 newest usable 보호 규칙 추가
- Production Readiness에 백업 무결성 gate를 추가하고 정상/legacy/손상 수 및 최근 정상 백업 상태 표시
- 관리자 `/api/backup` 다운로드도 동일한 v3 SHA-256 백업 포맷 사용
- 백업 payload의 schemaVersion과 operations schemaVersion 불일치, appVersion 형식 오류, metadata 변조 검사 추가
- 프로젝트 버전 4.12.0으로 정합성 업데이트
- 데이터 스키마 v2 유지; 백업 파일 포맷 v3는 데이터 스키마 버전과 별개

## 4.11.0
- Data & Reliability Finalization 완료
- 파일 경로 단위 공용 JSON 저장 큐를 추가해 동시 저장 시 lost update 방지
- 저장 직전 최신 디스크 상태를 다시 읽어 여러 `JsonStore` 인스턴스 간 갱신 순서 보장
- JSON 원자적 쓰기에 file fsync, atomic rename, directory sync 적용
- `.bak.prev` 2세대 백업과 `.tmp` 중단 쓰기 복구 지원, 손상 원본 `.damaged-*` 보존
- Runtime Backup, Release Center 상태/Trust/Journal/Staged bundle, Windows 설정 저장을 공통 원자적 쓰기로 통합
- 관리자 POST `X-Request-Id` 발급 및 서버 in-flight/최근 결과 중복 요청 coalescing 추가
- Operations 영속 requestId dedupe와 조합해 중복 추첨/운영 실행 방지
- Discord channels/configuration audit/recent audit log의 동시 중복 조회 억제
- 이미 동일한 Discord 닉네임은 변경 API 호출 생략
- stale PID lock을 비정상 종료 흔적으로 기록하고 시작 시 운영 상태 재검증
- graceful shutdown에서 HTTP drain → Discord queue flush → persistence flush → client/lock 종료 순서 적용
- 시작 시 예약/추첨/참석/팀/요청 상태 일관성 자동 복구 추가
- 잘못된 draw ids 및 빈 예약 취소 사용자 ID 검증 강화
- Data Reliability 집중 회귀 테스트 추가
- 프로젝트 버전 4.11.0으로 정합성 업데이트
- 데이터 스키마 v2 유지

## 4.10.0
- Incident Workflow & Alert Escalation Center 추가
- Runtime Health warn/error와 Discord Policy drift를 하나의 지속형 Incident 큐로 통합
- Incident 상태 OPEN / ACKNOWLEDGED / RESOLVED 및 담당자·메모 기록 추가
- 동일 장애 3회 반복 또는 15분 이상 미해결 시 CRITICAL 자동 승격
- Discord MANUAL drift는 일반 운영에서 CRITICAL, SAFE-only drift는 WARNING으로 분류
- Maintenance Mode 중 Policy drift escalation 보류 및 종료 후 즉시 재평가
- Runtime 이벤트 10분 무발생 시 자동 해소 처리
- 수동 해결 후 동일 과거 Runtime 이벤트 때문에 즉시 재오픈되던 경계값 문제 방지
- Incident 등록/승격/확인/해결/재오픈/자동 해소 Timeline 추가
- Control Center 운영 경고에 미확인/CRITICAL Incident 수 연결
- Production Readiness에 Incident Workflow gate 추가
- 진단 JSON에 비밀값/상세 오류 문자열 없이 Incident 상태 메타데이터만 포함
- `INCIDENT_WORKFLOW_FILE` 설정과 `data/incidents.json` 저장소 추가
- Startup Preflight가 Discord Policy/Incident 저장 경로 쓰기 권한까지 점검
- 관리자 Incident UI 필터, 담당 처리, 해결/재오픈 조작 추가
- 프로젝트 버전 4.10.0으로 정합성 업데이트
- 데이터 스키마 v2 유지

## 4.9.0
- Discord Alert Routing & Maintenance Center 추가
- Discord 로그 알림 범위를 OFF / MANUAL drift / 전체 drift로 분리
- drift 해소 알림 별도 설정 추가
- 15/30/60/120분 계획 작업 Maintenance Mode 추가
- Maintenance 중 drift 감지/Journal 기록은 유지하고 Runtime/Discord 외부 경고만 보류
- Maintenance 자동 만료 및 종료 직후 남은 drift 재경고 처리 추가
- 현재 drift digest 단위 Acknowledge/해제와 메모 기능 추가
- drift digest 변경 또는 해소 시 acknowledgement 자동 해제
- 경고 보류 횟수/최근 보류 사유 실시간 표시
- Monitor 설정 저장 시 v4.8 discordAlerts boolean을 새 alertMode로 하위 호환
- `지금 점검` 응답이 점검 전 monitorState를 반환해 마지막 점검/알림 상태가 잠시 stale하던 오류 수정
- Discord 알림 라우팅 OFF 전환 후 이전 전송 실패 문구가 남던 상태 오류 수정
- Maintenance/Acknowledge 해제 후 동일 drift가 남아 있어도 Runtime 경고가 다시 생성되지 않던 억제 상태 오류 수정
- Maintenance 시작/종료, drift 확인/해제를 Change Journal 및 관리자 감사 로그에 기록
- Control Center에서 Maintenance/확인된 drift를 실제 미확인 drift 경고와 분리
- 관리자 Policy UI에 Alert Route, Maintenance, Acknowledgement 상태/조작 패널 추가
- 프로젝트 버전 4.9.0으로 정합성 업데이트
- 데이터 스키마 v2 유지

## 4.8.0
- Discord Policy Monitor & Alert Center 추가
- Policy Baseline을 1/5/15/30/60분 간격으로 자동 점검하는 스케줄러 추가, 기본값 5분
- 자동 감시는 Discord 구성을 변경하지 않고 drift 탐지/상태 기록만 수행하도록 분리
- Policy Monitor 상태를 메인 Control Center SSE snapshot과 Discord 권한 감사 화면에 실시간 연결
- drift 발생/변경/해소를 Runtime Health와 Discord 로그 알림에 연결
- 동일 drift 반복 알림은 15분 cooldown 적용
- Control Center 운영 경고에 Discord Policy drift 상태 추가
- Monitor 설정 변경, 점검, drift/resolve를 Change Journal에 기록
- Policy Center API 응답에 monitorState 및 monitor 설정 저장 endpoint 추가
- 관리자 UI에서 Monitor ON/OFF, interval, Runtime/Discord 경고를 제어하고 최근 점검/알림/실패 상태 표시
- 기존 Policy Baseline/Auto-fix/Safe-only 규칙 그대로 유지
- 프로젝트 버전 4.8.0으로 정합성 업데이트
- 데이터 스키마 v2 유지

## 4.7.0
- Discord Permission/Role/Channel Policy Baseline 저장 기능 추가
- 현재 설정과 기준선의 MANUAL / SAFE drift 비교 및 요약 추가
- 채널 visibility overwrite/permission policy drift 검사 추가
- 안전한 자동 복구 범위를 로그 채널 topic, 봇 닉네임, 봇 역할 이름/색상으로 제한
- 관리자/봇 역할 권한 및 채널 visibility 차이는 자동 수정하지 않고 수동 승인 대상으로 분류
- Auto-fix 실행 전 복구 지점 생성 및 실행 후 재검증, 실패 시 운영 데이터 rollback 시도
- Discord Policy Baseline 저장/Auto-fix를 localhost 전용 2단계 승인으로 보호
- Discord Audit에 정책 기준선/현재 drift/수동 확인 항목/Safe auto-fix UI 추가
- Discord configuration audit에 bot role color/position 추가
- bot role position은 비교 정보로만 저장하고 정책 drift로 판정하지 않도록 처리
- 기존 v4.6 Operation Scope와 변경 없음
- 프로젝트 버전 4.7.0으로 정합성 업데이트
- 데이터 스키마 v2 유지

## 4.6.0
- Discord Permission Audit Center에 Operation Scope Matrix 추가
- Admin-only / Staff Operations / Viewer / Stream Overlay 네 운영 주체를 분리해 실효 권한 표시
- 핵심 권한을 guild/channel 단위 allow / deny / neutral / managed / missing 상태로 점검
- 대시보드 운영자 인증과 Discord 운영자 권한을 서로 다른 경계로 표시
- Discord 관리자 작업 13종을 action name, audit category, Discord permission, dashboard restriction 기준으로 정규화
- 권한 스냅샷과 위험 항목을 control center / diagnostics에 연결
- 알림 패널을 단일 `Permission management` 위험으로 묶지 않고 실제 위험 항목별로 표시
- Admin role이 없거나 멤버가 0명일 때 Staff Operations를 안전하게 차단 상태로 표시
- Discord Alert Role이 관리자 명령과 관련 없다는 점을 UI/진단에서 명시
- 프로젝트 버전 4.6.0으로 정합성 업데이트
- 데이터 스키마 v2 유지

## 4.5.0
- Discord permission / role hierarchy / intents 전용 실시간 Audit Center 추가
- Bot Gateway intent와 Developer Portal privileged intent 상태를 분리 표시
- Required / Recommended / Optional 권한 최소 기준 비교 추가
- 봇/관리자 역할 hierarchy와 관리 대상 멤버 수 진단 추가
- 영구 상태값 대신 마지막 100개 감사 로그를 일시 조회해 경고 role/member 관리 탐지
- 참가자/관리자 닉네임 변경 가능 여부 샘플 기반 사전 점검 추가
- setup category/channels/roles/topic drift 검사와 로그 채널 append-log 정책 추가
- Discord mutation 실패를 `permission`/`hierarchy`/`rate-limit`/`gateway`/`api`로 구조화
- 403/429은 502가 아니라 409로 반환하고 actionable hint 표시
- `/api/setup` 전용 15초 cooldown과 429 처리 추가
- Discord 작업 응답에 `auditCategory`, `permission`, `remediation`, `discordStatus` 메타데이터 추가
- Admin Role이 봇 역할보다 높지 않으면 관리자 권한 점검을 경고로 변경
- Discord Audit Center를 Control Center/Runtime 진단과 연동
- 프로젝트 버전 4.5.0으로 정합성 업데이트
- 데이터 스키마 v2 유지

## 4.4.0
- Release Center에 Ed25519 서명 Update Bundle(`daengdaeng-update-v3`) 지원 추가
- 최초 실행 Trust Root 생성/저장 및 현재 Trusted Key 표시
- v3 bundle의 public key fingerprint, detached signature, manifest digest 검증 추가
- 서명 bundle의 파일 내용/Base manifest 검증 뒤에만 Stage 허용
- 동일 버전 rollback/downgrade를 차단하고 emergency rollback은 localhost 2단계 승인으로 제한
- public key rotate/revoke API와 Trust Journal 추가
- revoked/unknown key의 신규 Update 차단
- Production 환경에 Signed update required 정책 추가, unsigned v1/v2는 Development 호환 모드에서만 허용 가능
- Supply-chain 진단에 update signing trust 상태 추가
- `npm run release:keygen` Ed25519 키 생성 CLI 추가
- `npm run release:bundle -- --private-key ...` v3 signed bundle 생성 지원
- 프로젝트 버전 4.4.0으로 정합성 업데이트
- 데이터 스키마 v2 유지

## 4.3.0
- 공급망 진단 센터 추가: lockfileVersion 3, package/lock/root dependency, integrity, install script 검사
- Release Center에 baseManifest/precondition 검사 추가: 코드 drift가 있으면 Stage 차단
- Stage 시 package.json / package-lock.json 변경 페어 검사와 dependency set/range drift 차단
- Stage 시 dependency 변화 설명/승인 + localhost 2단계 승인 토큰 요구
- Apply 시 staged 파일의 공급망 digest 재검증 및 package 파일 TOCTOU 방어
- dependency 변경 감지 시 `npm ci --ignore-scripts --no-audit --no-fund` 실행 후 실패 시 코드 rollback
- dependency 변경 적용 후 백업된 기존 package 파일 기준으로 자동 rollback reinstall 시도
- 운영 환경에서 lockfile 없는 package 변경, npm install 금지
- Production Readiness에 현재 dependency integrity/status gate 추가
- `/api/supply-chain` 및 관리자 Supply Chain Center UI 추가
- Release bundle 생성기에 dependency metadata/add/remove/change 요약 추가
- signed v3는 SHA-512 integrity를 포함하지만 v4.3.0 현재 Stage는 v2 bundle 지원
- 프로젝트 버전 4.3.0으로 정합성 업데이트
- 데이터 스키마 v2 유지

## 4.2.0
- Update bundle 형식을 `daengdaeng-update-v2` strong-integrity로 확장
- `baseManifest`와 base manifest SHA-256을 포함해 다른 코드 기준점에 대한 오적용 방지
- added/modified/deleted 파일 목록 + 전체 target manifest 선언으로 미완성 패키지 탐지
- 파일별 변경 전 SHA-256 + 변경 후 SHA-512까지 검증
- manifest digest를 SHA-512로 강화하고 `integrity.format=strong-v1` 메타데이터 추가
- Release Center에서 현재 코드 baseManifest와 완전 일치하지 않으면 Stage 차단
- Apply 후 targetManifest와 실제 허용 파일 목록 100% 일치 여부 검증 후 성공 처리
- 롤백 스냅샷에 파일별 mode + SHA-256 저장, 복원 후 해시 재검증
- 심볼릭 링크 대상이 아닌 부모 디렉터리 경로까지 점검해 symlink 우회 강화
- code apply 후 파일 mode 보존, update bundle의 잘못된 mode 차단
- 대시보드 Stage 응답에 bundle format/integrity/base-match payload 전달 개선
- Release Center에 STRONG/LEGACY 기준 무결성 상태와 drift 표시 추가
- `release:bundle`은 기본 v2를 생성하고 `--legacy`로 v4.1 호환 v1 패키지 생성 지원
- v4.1 → v4.2 대시보드 업데이트용 Update JSON 제공 기반 완성
- 데이터 스키마는 v2 유지
- 프로젝트 버전 4.2.0으로 정합성 업데이트

## 4.1.0
- 관리자 대시보드에 Release & Update Center 추가
- DaengDaeng Update JSON의 기준/대상 버전, schema, 허용 경로, SHA-256, manifest digest 검증 추가
- 현재 코드와 업데이트 패키지의 추가/수정/삭제 파일 Diff 표시
- data/.env/config.local/node_modules/.git 및 프로젝트 밖 경로 코드 업데이트 차단
- 심볼릭 링크 경로 업데이트 차단
- 코드 적용/롤백을 localhost 전용 + 2단계 승인으로 제한
- 코드 적용 직전 운영 데이터 백업과 Recovery 복원 지점 자동 생성
- 변경 파일 코드 rollback snapshot 및 업데이트 실패 시 자동 원복 추가
- 새 버전 재시작 후 자동 Smoke Test와 수동 재검사 추가
- 이전 코드 파일 복원 후 재시작하는 코드 rollback 지원
- 현재 코드 SHA-256 manifest 다운로드 추가
- `npm run release:bundle` 업데이트 패키지 생성 도구 추가
- 명시적 4xx 오류 상태 코드가 일반 400으로 바뀔 수 있던 Runtime Health 분류 수정
- 관리자/게임 스튜디오 버전 표시를 v4.1 기준으로 정리
- 데이터 스키마는 v2 유지
- 프로젝트 버전 4.1.0으로 정합성 업데이트

## 4.0.0
- 관리자 대시보드에 Production Readiness & Deployment Center 추가
- 시작 전 Node.js/프로필/호스트 노출/인증/파일 쓰기/디스크/포트 Preflight 추가
- production / development / demo 실행 프로필 분리 및 `DEV.cmd` 추가
- `npm run dev`가 `--dev` development 프로필을 사용하도록 수정
- 자동/수동 배포 백업과 보존 개수·기간·자동 간격 설정 추가
- 오래된 백업을 새 백업 생성 여부와 무관하게 정리하도록 보존 정책 수정
- Runtime Health 기반 1~60분 Soak Test와 Production Gate 통합 판정 추가
- 중지된 Soak Test에서 이미 5xx/저장 실패가 관측된 경우 실패 판정 유지
- 복원/위험 작업 중 자동 백업을 건너뛰고 수동 배포 백업을 차단해 혼합 시점 백업 방지
- graceful shutdown 순서를 개선해 진행 중 HTTP/Discord 작업을 최대 10초까지 마무리한 뒤 Discord 연결 종료
- 배포 진단에서 최근 백업, Soak 상태, graceful shutdown 상태를 민감정보 없이 내보내도록 확장
- 게임 스튜디오/관리자 UI 버전 표시를 v4.0 기준으로 정리
- 데이터 스키마는 v2 유지
- 프로젝트 버전 4.0.0으로 정합성 업데이트
## 3.9.0
- 관리자 대시보드에 Performance & Capacity Center 추가
- 최근 1시간 15초 간격 메모리 RSS / Event Loop / API 추세 샘플링 추가
- 최근 15분 API P95/P99, 요청 속도, 오류율 및 500ms 이상 Slow API 탐지 추가
- 메모리 증가 속도는 최소 5분 관측 후 시간당 증가량으로 평가해 짧은 GC 변동 오탐을 줄임
- 관리자 SSE 12개 / 방송 SSE 8개 연결 용량과 사용률 표시
- registrations / operations / recovery JSON 파일 크기와 참가자 수 용량 진단 추가
- JSON 저장소 25MB 주의 / 100MB 위험 임계값과 운영 권장 조치 추가
- Runtime 진단 JSON에 민감정보 없는 Performance & Capacity 요약 포함
- 방송 SSE write/heartbeat 실패 시 연결 정리 누락 가능성 수정
- Runtime Health 페이지의 중복 metrics 컨테이너 마크업 수정
- Self-Check에 방송 SSE 연결 용량 점검 추가
- 프로젝트 버전 3.9.0으로 정합성 업데이트

## 3.8.0
- 관리자 대시보드에 Runtime Health & Incident Center 추가
- API 요청/오류/5xx/응답시간 및 상태코드별 런타임 지표 집계
- Discord 작업 호출/실패/지연 및 작업 종류별 지표 집계
- JSON 저장 성공/실패와 `.bak` 자동 복구 관측 기능 추가
- SSE 연결/해제/클라이언트 재연결/오류/stale/지연 통계 추가
- 스케줄러 실행/실패/처리시간, 메모리, Event Loop 지연 진단 추가
- 소스/심각도 필터가 있는 장애 타임라인 및 60초 중복 이벤트 압축 추가
- warn/error 런타임 장애를 Recovery Audit의 `runtime` 카테고리에 연결
- 민감정보와 참가자 원본 데이터를 제외한 진단 JSON 내보내기 추가
- Control Center 운영 경고에 Runtime Health 상태 연동
- SSE write 실패 시 heartbeat/stream 정리 누락 가능성 수정
- 저장소 오류를 500, Discord 오류를 502, 내부 프로그램 오류를 500으로 분류하도록 오류 처리 개선
- JsonStore 백업 자동 복구/읽기·쓰기 실패를 진단 계층에서 관측하도록 개선
- 게임 스튜디오와 관리자 UI의 버전 표시를 v3.8 기준으로 정리
- 프로젝트 버전 3.8.0으로 정합성 업데이트

## 3.7.0
- Operations Guard & Safe Deploy 패널 추가
- 버전/스키마 변경 감지 시 업데이트 직전 자동 복원 지점 생성
- 운영 데이터 `schemaVersion`/`appVersion` 기록 및 v1 → v2 자동 마이그레이션
- 오래된 방송 설정/프리셋/자동화와 운영 배열 구조 정규화
- 과거 복원 지점/백업 적용 시 현재 스키마로 자동 변환
- 업데이트 기준점 이후 비밀값 제외 설정 Diff 표시
- 복원 지점 적용/삭제, 전체 백업 복원, 수동 마이그레이션에 2분 유효 2단계 승인 적용
- 승인 요청을 작업 종류와 대상 digest/revision에 결합하고 1회 사용 후 폐기
- 마지막 정상 복원 지점 삭제 차단
- 현재 프로그램보다 새로운 백업 데이터 스키마 사전 차단
- 업데이트 후 자동 Self-Check 실행 및 감사 로그/`safeDeploy.postUpdateCheck` 기록
- 앱 버전을 `src/version.js`로 중앙화
- 정상 `session:null`을 반복 마이그레이션 대상으로 오인하던 기본값 판정 오류 수정
- 복원 후 과거 스키마가 그대로 남을 수 있던 문제 수정
- 관리자/게임 스튜디오의 오래된 v3.6 표시 문구 수정
- 프로젝트 버전 3.7.0으로 정합성 업데이트

## 3.6.0
- 관리자 대시보드에 Recovery & Audit Center 추가
- 참가자/운영 데이터를 함께 저장하는 복원 지점 최대 10개 지원
- 복원 지점 SHA-256 무결성 검증 및 손상 복원 차단
- 최초 v3.6 실행 시 초기 보호 지점 자동 생성
- 복원 직전 자동 보호 지점 생성 및 실패 시 직전 상태 롤백 시도
- 전체 JSON 백업 파일 검증 및 검증 통과 백업 복원 API/UI 추가
- Self-Check에 저장소, 회차 참조, Node.js, 외부 노출, 방송 토큰, Discord, SSE, 복원 무결성 점검 추가
- 운영/방송/복구/멤버/안내문/게임 설정 관리자 감사 로그 추가(최대 500건)
- 감사 상세에서 token/password/secret/CSRF/Authorization 계열 필드 제외
- 복원 중 SSE 중간 snapshot 억제 후 완료 상태만 push하도록 수정
- 안내문/무기 설정/setup/voice/publish 경로의 최상위 revision 누락 수정
- 시작할 때 guildId가 이미 저장된 운영 파일을 불필요하게 다시 쓰던 동작 수정
- 메인 및 게임 스튜디오의 오래된 버전 표시 수정
- API JSON 상한을 2MB로 조정해 전체 백업 검증/복원 지원
- `RECOVERY_FILE` 설정과 `data/recovery.json` 저장소 추가
- 프로젝트 버전 3.6.0으로 정합성 업데이트

## 3.5.0
- 방송 화면 설정 프리셋 저장/업데이트/적용/삭제 기능 추가(최대 12개)
- 소환사의 협곡/칼바람 나락/이터널 리턴/기본 컨텍스트별 자동 프리셋 매핑 추가
- 방송 장면 강제 고정 및 0~300초 자동 해제 기능 추가
- 회차 종료 장면 0~60초 유지 후 대기 화면 자동 복귀 기능 추가
- 방송 설정·프리셋 JSON 내보내기/가져오기 추가
- export 파일에서 Discord 토큰, 대시보드 비밀번호, BROADCAST_TOKEN 등 비밀값 제외
- 방송 snapshot에서 현재 자동 프리셋과 장면 override를 서버에서 계산하도록 변경
- 장면 고정 적용 시 게임별 프리셋 매핑이 지워질 수 있던 내부 정규화 오류 수정
- 자동화 입력을 수정할 때 일반 방송 설정이 '저장되지 않음'으로 오인 표시되던 이벤트 범위 오류 수정
- 자동화 저장 시 활성 장면 고정 상태가 의도치 않게 해제되지 않도록 수정
- 프리셋 삭제 시 연결된 게임별 자동 매핑을 자동 정리
- 프로젝트 버전 3.5.0으로 정합성 업데이트

## 3.4.0
- 관리자 대시보드에 Broadcast Scene Customizer 추가
- Midnight/Aurora/Warm Studio 테마 및 Cinematic/Compact 레이아웃 추가
- Fade/Slide/Cut 전환과 선택형 Soft/Arcade 효과음 추가
- 브랜드/푸터/대기 화면 문구 및 당첨자 공개 시간 설정 추가
- 헤더/푸터/텔레메트리/최근 신청자/카운트다운 표시 옵션 추가
- 모집/추첨 준비/당첨자/참석/팀/종료 장면별 자동 표시 설정 추가
- same-origin 관리자 방송 미리보기 iframe 지원
- 방송 설정 저장 API에 입력 검증과 정규화 추가
- SSE를 통한 방송 설정 실시간 반영
- 경기 데이터 일시 조회 실패 시 다음 동기화에서 재시도하도록 수정
- 헤더/푸터 숨김 시 남던 빈 그리드 공간 수정
- 손상되거나 오래된 방송 설정을 snapshot에서 안전하게 정규화
- 프로젝트 버전 3.4.0으로 정합성 업데이트

## 3.3.0
- 방송/OBS 전용 `/broadcast/` 실시간 화면 추가
- 모집 → 추첨 → 당첨 → 참석 → 팀 결과 → 종료 화면 자동 전환
- 방송 전용 SSE heartbeat, 자동 재연결, 8초 안전 폴링 추가
- 큰 추첨 프레임을 별도 `/broadcast/api/draw/:id`로 분리해 SSE 반복 전송 감소
- 방송 API에서 Discord User ID를 `p1`, `p2` 별칭으로 치환하고 관리자/프로필 데이터 제거
- OBS 투명 배경(`transparent=1`) 및 재생 속도(`speed`) 옵션 추가
- 동일 표시 이름 참가자의 참석 상태가 잘못 연결될 수 있던 방송 이름 매핑 오류 수정
- Live Director 1프레임 재생 진행률 0 나눗셈 방어
- Windows 첫 설정의 하드코딩 Discord 애플리케이션/서버 ID 제거 및 직접 입력 검증 추가
- Windows 첫 설정에서 BROADCAST_TOKEN 자동 생성 및 로그 비밀값 마스킹 추가
- 관리자 대시보드에 방송/OBS 바로가기와 Browser Source 주소 안내 추가
- 프로젝트 버전 3.3.0으로 정합성 업데이트

## 3.2.0
- 메인 Control Center에 통합 Live Director 추가
- 전투/레이스/사다리/즉시 추첨 인라인 미리보기 및 결과 재생
- 레이스 선두·랩·격차·진행률 실시간 텔레메트리 추가
- 전투 생존 인원·진행률 표시
- 일시 정지, 같은 경기 다시 보기, 팝업 연출 제어 추가
- 저장 경기/연습 경기를 메인 대시보드에서 바로 재생
- 추첨 모드·맵·서킷·랩 변경을 Live Director 미리보기와 동기화
- v3.2.0 버전 정합성 및 Live Director 회귀 테스트 추가

## 3.1.0
- SSE heartbeat 및 자동 재연결 안정화
- 실시간 동기화 진단 패널 추가
- 참석 전원 확인 시 팀 편성 추천 로직 수정
- 프로젝트 버전 3.1.0, discord.js 의존 범위 ^14.27.0으로 정리
