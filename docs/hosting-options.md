# 배포 준비: 호스팅 고르기 (2026-10-24 조사)

Railway 체험이 끝나 배포가 멈춘 상태입니다. 이 문서는 **고르기 위한 비교**이고, 실제 배포·결제·환경변수 변경은 하지 않았습니다.

## 댕댕봇이 호스팅에 요구하는 것 (코드 기준)
- 24시간 켜져 있어야 함: Discord 게이트웨이 연결, CHZZK 세션(후원·채팅) 연결이 계속 살아 있어야 합니다. **들어오는 요청이 없으면 잠드는 무료 플랜은 쓸 수 없습니다.**
- 프로세스 1개, 복제(replica) 1개: JSON 저장소(`src/json-store.js`)는 여러 프로세스가 같은 파일을 쓰는 구조가 아닙니다.
- 영구 디스크: `/app/data`(백업·서버별 공간 포함). 재배포해도 지워지면 안 됩니다.
- HTTPS 공개 주소: `PUBLIC_BASE_URL`, OAuth 콜백(Discord·네이버·치지직)이 이 주소를 씁니다.
- Node 22.22.2 이상, `GET /healthz` 상태 확인, 종료 신호 후 12초 이상 대기(`deploy/README_PRODUCTION.md`).
- 메모리: 평소 사용량은 운영 화면(`/api/snapshot`의 runtime.memory)에서 확인해야 합니다. 서버 여러 개를 켜면 늘어나므로 512MB는 빠듯할 수 있고 1GB 이상을 권합니다(추정, 실측 PENDING).

## 후보 비교
| 후보 | 월 비용(대략) | 영구 디스크 | 한국과 거리 | 장점 | 주의 |
|---|---|---|---|---|---|
| **Railway Hobby** | $5 기본(사용량 $5 포함, 넘으면 사용량만큼). RAM 1GB 상시면 RAM만 약 $10 | 볼륨 GB당 $0.15 | 미국·유럽·싱가포르 | 지금 설정(`Dockerfile.railway`, `railway.json`)을 그대로 씀. 이전 볼륨 데이터를 이어 쓸 수 있을 가능성 | 사용량 과금이라 메모리가 늘면 비용도 늘어남 |
| **Fly.io** | shared-cpu-1x 256MB 도쿄 약 $2.9, 512MB는 약 2배 | 볼륨 GB당 $0.15 | 도쿄(nrt) | 싸고 도쿄가 가까움 | Dockerfile·fly.toml 새로 작성, 볼륨은 한 지역 한 기계에 묶임 |
| **Render** | Starter $7(0.5 CPU, 512MB). 무료는 15분 뒤 잠듦 → 사용 불가 | 디스크 GB당 $0.25 | 싱가포르 | 설정이 쉬움 | 512MB가 빠듯할 수 있음, 디스크를 붙이면 무중단 배포 불가 |
| **Oracle Cloud Always Free** | 0원 | 블록 스토리지 무료 범위 | 춘천·서울 리전 있음 | 무료 | ARM 무료 한도가 2026-06에 2코어·12GB로 줄었다는 보고, "용량 부족"으로 생성 실패가 흔함, CPU 사용이 낮으면 회수될 수 있음, 서버 관리(보안 업데이트·HTTPS 인증서)를 직접 해야 함 |
| **국내 VPS**(예: 작은 클라우드 서버) | 상품별 | 디스크 포함 | 국내 | 가까움, 고정 비용 | 서버 관리 직접, Docker·HTTPS 직접 구성 |

가격은 아래 출처의 2026년 자료이고 바뀔 수 있습니다. 결제 전에 각 공식 가격 페이지를 다시 확인하세요.

## 추천 순서
1. **Railway Hobby로 다시 켜기**: 바꿀 코드가 없고, 기존 볼륨(`/app/data`)이 남아 있다면 그대로 이어 쓸 수 있습니다. 볼륨이 남아 있는지는 Railway 화면에서 사용자가 확인해야 합니다(**PENDING**).
2. 비용을 더 줄이려면 **Fly.io 도쿄**: 설정 파일을 새로 만들고 데이터 옮기기가 필요합니다.
3. Oracle 무료는 비용은 0원이지만 관리 부담과 회수 위험이 있어 방송 운영용 주 서버로는 권하지 않습니다.

## 어느 곳이든 옮길 때 할 일
1. 기존 데이터 백업: Railway 볼륨의 `/app/data` 전체(백업 폴더 포함)를 내려받기. 개발 환경에 직접 연결하지 않습니다.
2. 비밀값은 새 호스팅의 비밀값 관리 기능에만 넣기(`.env.example`, `deploy/production.env.example`의 변수명 기준). **`NAVER_TOKEN_KEY`, `CHZZK_TOKEN_KEY`는 새로 만들지 말고 기존 값을 그대로 옮겨야** 저장된 연결이 풀리지 않습니다.
3. 주소가 바뀌면 함께 바꾸기: `PUBLIC_BASE_URL`, Discord 개발자 포털 리디렉트 URI, 네이버 개발자센터 콜백(`/naver/callback`, `/naver/participant/callback`), 치지직 개발자 앱 리디렉트 URI, OBS에 넣어 둔 방송 화면 주소.
4. `npm run env:check` → `npm run verify:final`(FINAL PASS) → `/healthz` 200 확인.
5. `MULTI_WORKSPACE_ENABLED`는 기본 false 그대로 두고, 켤 때는 `docs/multi-workspace-enable-checklist.md` 순서를 따릅니다.
6. 실제 확인은 `docs/real-e2e-checklist.md` 순서로 합니다.

## 확인 상태
- 조사만 했습니다. 실제 배포, 결제, 볼륨 이전은 하지 않았습니다: **PENDING**.

## 출처
- Railway 가격(2026): https://www.budgetforge.dev/tools/railway-pricing-2026
- Fly.io 가격: https://fly.io/pricing.md
- Render 가격(2026): https://temps.sh/blog/render-pricing-2026
- Oracle Always Free 운영기(2026): https://braindetox.kr/posts/oracle_always_free_backend_2026.html
