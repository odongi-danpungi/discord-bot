# 댕댕봇 4.17.6 · Production Monitoring & Operational Readiness · Step 7

운영 대시보드의 Deployment 탭에 Discord / Naver / CHZZK / Public HTTPS 모니터링을 추가했습니다. 기존 모든 기능과 데이터 스키마 v2를 유지합니다.

- GET /api/production-monitoring: 외부 호출 없이 최근 결과와 현재 런타임·장애·릴리스·잠금·draining 상태 조회.
- POST /api/production-monitoring/probe: 관리자 전용, 기존 인증·CSRF·동일 사이트·멱등성·감사 보호 적용. 읽기 전용 검사만 실행합니다.
- 2분 TTL, 메모리 이력 최대 20회, 최소 30초 간격, 동시 요청 병합, 서비스별 timeout, 429 Retry-After 대기. 재시작 후에는 새 검사 전까지 승인 차단.
- PRODUCTION_MONITOR_INTERVAL_SECONDS=0: 자동 검사 해제(기본). 60~3600초로 설정하면 서버에서 주기 검사. 계속 유효한 상태를 관측하려면 60초 권장; 120초 이상은 검사 사이 만료 구간이 생깁니다.
- 새 운영 게이트는 네 연결 모두 실제 성공해야 통과합니다. 선택 연동을 사용하지 않는 일반 기능은 그대로 실행되지만, 이 프로젝트의 전체 Production Acceptance는 미설정 연결을 통과 처리하지 않습니다.
- restart/rollback/recovery 대기, 알 수 없는 릴리스 상태, 불완전한 장애 정보, 긴급 잠금, draining, 환경 검증 비정상은 차단합니다. 자동 복구가 감지된 부팅은 확인 후 깨끗하게 재시작해야 합니다.
- Naver 검사에서는 기존 토큰으로 GET profile만 수행합니다. 자동 토큰 갱신·카페 글쓰기·가입은 하지 않습니다. 만료 토큰은 재연결/정상 인증 흐름으로 해결하세요.
- Public HTTPS는 HTTP 200뿐 아니라 health JSON, v4.17.6 버전, ready=true, emergencyLocked=false를 확인합니다. 리다이렉트·사설/로컬 DNS 대상·인증정보 포함 URL을 거부합니다. 공개 URL은 루트 origin을 사용하세요.
- Acceptance / Cutover / Connector / Monitoring은 같은 검사 조정기를 사용합니다. 검사를 연달아 실행하면 429 대기가 정상입니다. 대기 후 다음 검증을 실행하세요.
- 결과는 현재 상태를 보여주는 진단 자료이며 실제 트래픽 전환 또는 외부 서비스 쓰기 권한을 부여하는 토큰이 아닙니다. /healthz는 기존 호스트 수신 상태 의미를 유지하고, 전체 운영 승인은 관리자 진단 API에서 확인합니다.

## 배포 설정 대조

scripts/expected-deployment.example.json을 프로젝트 밖의 파일로 복사하고, 배포하려는 version·릴리스 manifestDigest·PUBLIC_BASE_URL·NAVER_REDIRECT_URI·HOST·PORT를 입력합니다. 실제 값은 비교 JSON에 재출력하지 않습니다.

~~~sh
npm ci --ignore-scripts
npm run env:check
npm run verify:final
npm run deployment:compare -- /secure/location/expected-deployment.json
~~~

manifestDigest는 릴리스의 target-manifest-v4.17.6.json 또는 Step 7 보고서에서 가져오세요. URL은 config의 정규화 형식(공개 주소 끝 / 포함)과 정확히 일치해야 합니다. 이 검사는 현재 프로세스 설정·코드를 대조하며, 호스팅 서비스 라우팅이 실제로 전환됐는지는 별도로 확인해야 합니다.

## 업그레이드와 플랫폼 주의사항

v4.17.5의 Windows 파일 복사 fsync 버그를 v4.17.6에서 수정했습니다. 그러나 업데이트 적용 코드는 이미 실행 중인 이전 버전이 수행하므로 Windows에서는 v4.17.5의 앱 내부 Update JSON 적용을 사용하지 말고, 봇을 정지한 뒤 전체 ZIP을 새 디렉터리에 배치하고 기존 환경 설정·데이터를 안전하게 이전하세요. 이전 폴더와 데이터 백업을 보존하세요. 신규 인스턴스와 이전 봇을 동시에 운영하지 마세요.

Update JSON은 기존 Release Center 허용 경로(src/public/scripts/test 및 지정 루트 파일)를 대상으로 합니다. .dockerignore와 FEATURE_REVIEW 문서는 그 범위 밖이므로 전체 ZIP을 사용하거나 별도로 반영하세요. 특히 Docker 빌드에는 새 .dockerignore를 적용해 config.local.json / config.json / *.pem / *.key가 이미지에 들어가지 않게 해야 합니다. Update JSON은 SHA-256 무결성 형식 v2이며 배포자 전자서명은 없습니다. 서명 필수 정책을 낮추지 말고 기존 신뢰 키로 서명하세요.

Windows 자동화 테스트의 SIGTERM은 강제 종료 및 crash recovery를 검증합니다. Linux의 POSIX graceful shutdown은 실제 Linux 호스트에서 별도로 확인해야 합니다.

## 이전 릴리스 기록


검증 수치 및 릴리스 증거는 배포물과 함께 제공된 Step 7 검토 보고서를 확인하세요. 실제 서비스 자격 증명이나 라우팅 권한은 이 개발 환경에 제공되지 않았습니다.
