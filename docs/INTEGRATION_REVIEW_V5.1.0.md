# v5.1.0 통합 검토 보고서

기준일: 2026-09-30. 실제 완성본 v4.17.5 Step 6을 기준으로 후속 v4.17.6 및 v4.18.0 개선을 함께 보존했다. 버전 5.1.0, 데이터 스키마 2. 운영 서비스 검증은 PENDING이다.

## 저장소 조사와 통합

GitHub main `f3b13a12ab1ee246f6014ebde3bb062be6b85afc`는 11개 파일의 v5.0 skeleton이었다. v4.17.5 기준 266개 파일이 없었다. 11개 원격 브랜치를 비교했고 가장 풍부한 develop도 47개 파일에 불과했으며 237개가 없고 상대 import 7개가 깨져 있었다. 버전 숫자를 최신성 근거로 사용하지 않았다.

보존된 v4.17.5 디렉터리의 276개 파일을 기준으로 검토했다. 기존 Release manifest의 236개 대상 파일 해시는 일치했다. 최초 Downloads ZIP이 현재 경로에 없어 원본 ZIP 자체의 재검증은 불가능하다. v4.18.0 최신 ZIP manifest 298개 파일의 SHA-256을 확인하고 통합했다. 기존 GitHub 문서는 docs/github-import-history에 보관했다. 기존 기능 파일의 삭제는 없다.

## 주요 변경 파일

- package.json, package-lock.json, src/version.js: 통합 버전, preflight/verify:ci 실행 명령. 의존성 추가 없음.
- .github/workflows/ci.yml: Linux/Windows × Node 22.22.2/24 전체 검증. 읽기 권한만 사용, Actions commit 고정, 운영 Secret 사용 안 함.
- Dockerfile, Dockerfile.railway, railway.json, deploy/railway-entrypoint.sh: 직접 Node 실행과 `/app/data` 영구 볼륨 요구, 권한 하향 후 시작.
- .gitattributes, .gitignore: LF 줄바꿈 정합성과 비밀 설정/키 제외.
- scripts/preflight.js: develop의 호환 가능한 사전 점검 복구.
- src/community.js, test/community.test.js: 동시에 패널을 게시할 때 이전 참조 없이 중복 메시지를 만드는 경쟁 조건 차단 및 오류 후 잠금 해제 회귀 검증.
- README.md, CHANGELOG.md, NEW_CHAT_HANDOFF.md, docs/PRODUCTION_CHECKLIST.md: 실제 기준과 설치/변수/E2E/운영 전환/복구 절차.
- v4.17.6/v4.18.0의 모니터링·커뮤니티·대시보드·커넥터 보완은 그대로 포함. 전체 추가/변경/동일 파일은 별도 `v510-baseline-file-comparison.csv`에 기록한다.

## 보안·안정성 검토 범위

파일 inventory, 기준 manifest 비교, import/문법 검사, 기존 전체 회귀와 최근 변경 경로를 검토했다. 모든 코드 줄에 대한 독립 보안 감사 완료를 의미하지 않는다. 인증/CSRF/역할 제한, Secret 마스킹, probe timeout/429 cooldown/리다이렉트 제한, Queue 일관성, atomic write/recovery/idempotency, release path/manifest/rollback 관련 회귀를 실행했다.

모니터링은 읽기 전용이며 Naver probe가 토큰 refresh write를 일으키지 않는 후속 수정을 포함한다. 공개 health 검증에서 private 주소와 응답/버전 불일치를 차단한다. Discord 진단을 불완전한 근거로 성공 처리하지 않는다. 운영 gate는 stale/unprobed/실패 및 위험한 실행 상태를 차단한다. 커뮤니티 공지의 sending/uncertain은 자동 재전송하지 않는다. 위임 운영자는 기존 모바일 권한 범위를 유지한다.

공급망 설치 결과 npm audit 취약점 0건. 별도 성능 벤치마크는 실시하지 않았다. 요청 중복 억제, API cooldown 및 동시 패널 게시 억제를 포함하지만 처리량 향상 수치를 주장하지 않는다.

## 로컬 검증

환경: Windows, Node 24.19.0, npm clean install.

| 검증 | 결과 |
|---|---|
| npm ci --ignore-scripts | PASS, 132 packages 설치, audit 0 vulnerabilities |
| preflight | PASS, 8개 점검 |
| JS check | PASS, 225개 파일 |
| 전체 final verify | PASS, 490/490, 실패/skip 0 |
| core-only | PASS, 465/465, 실패/skip 0 |
| 실제 env:check | BLOCKED, Discord Token 미설정 |
| 기존 v4.17.5 Release Stage | PASS, drift 0 |
| 기존 v4.17.5 Windows Apply/Rollback | BLOCKED, 기존 fsync EPERM 재현, rollback 미인증 |
| 새 v5.1.0 엔진 Stage/Apply/Manifest/Rollback | PASS, 대상/복원 전체 manifest 일치 |
| Docker/Linux 및 원격 CI | 별도 실행 결과 확인 필요; 로컬 Docker CLI 없음 |

초기 통합 전체 489개 통과 후 경쟁 조건 회귀 1개 추가하여 490개 모두 재실행했다. 테스트 실패를 skip하거나 운영 인증을 가정하지 않았다. Update JSON은 v2 무서명이며 Docker/CI/docs는 업데이트 허용 경로 밖이므로 전체 ZIP/Git로 설치한다. 기존 Windows v4.17.5 엔진에서 바로 Apply하지 않는다. 전체 데이터 백업 후 새 폴더 설치 및 설정 복원이 필요하다.

## 기능 상태와 남은 조건

| 영역 | 코드/회귀 | 실제 서비스 |
|---|---|---|
| Discord | 보존 및 PASS | PENDING: 실제 토큰/서버/권한 |
| Naver Cafe | 보존 및 PASS | PENDING: OAuth·카페·메뉴 |
| CHZZK | 보존 및 PASS | PENDING: Client·채널 |
| Dashboard | PC/모바일, dark theme, 대·중·소 분류 보존 | PENDING: 실제 HTTPS 로그인 |
| 통합 Queue | 참가/호출/미루기/추첨/팀/복구 회귀 PASS | PENDING: Discord+Naver 실제 E2E |
| Recovery/Release | 새 엔진 회귀 PASS | PENDING: 실제 볼륨 재시작/복원 |
| Railway | 설정/문서 준비 | PENDING: volume/build/인증/start/traffic |
| GitHub | 통합 브랜치 준비 | 원격 push/PR/CI 결과는 최종 전달에서 별도 기록 |

개인 패널 최초 외부 생성 직후 저장 전 crash의 중복 가능성은 남는다. 재게시 전 채널 확인이 필요하다. 파일 기반 상태 저장은 단일 replica 운영을 전제로 하며 분산 쓰기는 지원하지 않는다. 기존 Naver 메모 기반 참가 기능과 별개로 새 커뮤니티 모집 링크 기능은 카페 댓글을 자동 접수하지 않는다. 회차 recap은 전체 방송 합산 후기 기능이 아니다.

사용자가 해야 할 일은 실제 Secret을 Railway에 직접 입력하고, 기존 NAVER_TOKEN_KEY/운영 데이터를 유지하며, 카페 OAuth callback·Discord 최소 권한·CHZZK 채널을 확인하는 것이다. 이후 PRODUCTION_CHECKLIST의 실제 E2E와 gate 순서대로 검증해야 한다. 현재 production traffic 활성화와 무인 롤백 성공을 인증할 수 없다.

다음 개선 우선순위: 개인 패널의 crash-safe 외부 메시지 reconciliation, 실제 Linux/볼륨 장애 훈련, 카페/Discord 실제 E2E 기록, 필요할 때 데이터베이스 기반 다중 인스턴스 전환. 기능 추가보다 이 항목을 우선한다.
