# 댕댕봇 — Claude Code 작업 지침

Discord·네이버 카페·CHZZK를 연결하는 방송 운영 봇. 여러 방송 운영자가 각자의 Discord 서버를 운영하는 배포형 서비스(서버별 워크스페이스)를 목표로 한다.

## 기준과 스택 (바꾸지 않는다)
- Node.js >=22.22.2, JavaScript ES Modules, discord.js 14, Express 5. 기존 HTML/CSS/JS 프런트엔드.
- 저장: 기존 JSON 저장소(`src/json-store.js`, 원자 쓰기·`.bak`/`.tmp` 복구). Operations 스키마 2. 임의 DB 전환·스키마 변경·기능 삭제·전체 재작성 금지.
- 새 기능 설정은 기존 파일을 바꾸지 말고 `operations.json.<기능>.json` 같은 별도 저장소로 둔다(예: `workspace-call-settings.js`, `donation-roulette.js`).
- `MULTI_WORKSPACE_ENABLED` 기본값 false. 운영값 확인 없이 바꾸지 않는다.

## 권한 원칙
- 제작자(전체 점검·배포·복구) / 서버 운영자 / 참가자를 분리한다. 메뉴 숨김만으로 끝내지 말고 서버 API에서 검사한다.
- 새 `/api/*` 경로를 추가하면 반드시 함께 수정: `src/dashboard-access.js`(`dashboardCapabilityForRequest`), `src/workspace-policy.js`(워크스페이스 허용 목록). 제작자 전용 기능은 워크스페이스 허용 목록에 넣지 않는다.
- 변경 요청은 기존 CSRF·Idempotency-Key·revision 충돌 검사·긴급 잠금 guard를 그대로 통과해야 한다.
- 사용자 화면(포털)에 제작자 진입점을 노출하지 않는다.

## UI (세이지 워크스페이스)
- 토큰: 배경 #E9EEE7, 카드 #F5F7F1, 사이드바 #E0E7DD, 글자 #25372C, 보조 #5B6E60, 구분선 #CDD7CA, 강조 #456B59. (`public/portal.css`, `login.css`, `roulette.css`)
- 로고는 `public/brand-logo.svg`(사용자 제공 선화). 임의 새 로고 금지.
- 화면 문구에 영어 "Queue"를 쓰지 않고 "대기열"이라고 쓴다(사용자 결정 2026-10-24). 코드 식별자·API 경로(`participation-queue` 등)는 그대로.
- 대분류 → 중분류 → 소분류, 한 화면에 한 기능. 포털 메뉴 정의: `public/portal.js`의 `menu`/`titles`. 대분류: 통합 운영(참가 진행·운영 준비·참가 설정·커뮤니티) · 방송(방송 도구·OBS·룰렛·방송 기록) · 네이버 카페 · Discord · CHZZK. 방송은 통합 운영 바로 옆(사용자 확정 2026-10-20).
- 확인 크기: PC 1440×1024, 모바일 390×844, 360폭.
- 2차 통일 완료(2026-10-23): 대시보드(`business-theme.css` 등 테마 층), `mobile-control.*`, `community.*`, `viewer.*`(다크 모드 포함). 방송 송출 화면 `broadcast.*`/`overlay.*`는 방송용 어두운 디자인 유지. OBS 후원 룰렛은 서커스 핀 휠(사용자 선택).

## 검증
```bash
npm ci
npm run verify:final      # 문법 + 전체 테스트 (기준: 305 JS, 1,113 테스트 통과)
node --test test/<파일>.test.js
npm run demo              # 연습 모드(외부 연결 없음). 데모 성공 ≠ 운영 인증 성공
```
- 테스트를 고쳐서 실패를 숨기지 않는다. 직접 실행한 결과와 기록(문서·CI)을 구분해 보고한다.

## 비밀값·운영
- 실제 Token·Secret·비밀번호를 출력하거나 코드·문서·Git에 넣지 않는다. `.env.example` 기준 변수명 사용.
- `NAVER_TOKEN_KEY`, `CHZZK_TOKEN_KEY` 등 기존 암호화 키 재생성 금지. 운영 데이터(`/app/data`)를 개발 환경에 직접 연결하지 않는다.
- 실제 Discord·네이버·CHZZK 연결이나 Railway 배포를 확인하지 못한 항목은 PENDING으로 남긴다.

## 진행 중 작업 (2026-10-20)
- 브랜치 `feat/sage-ui-unification` (기준 `feat/creator-user-workspaces` @ 65d0a8d 위)
  1. 세이지 1차 UI 통일 + 로고 + 포털 제작자 링크 제거
  3. OBS 룰렛 안내 + OBS 채팅창 — `src/chat-overlay*.js`, `public/chat-overlay.*`, 세션 공유 `ChzzkSessionHub`(`src/chzzk-session.js`). 실제 채팅 수신 PENDING, 안내: `docs/chzzk-chat-overlay.md`
  2. 치즈 후원 룰렛 — `src/chzzk-session.js`, `src/donation-roulette*.js`, `public/donation-roulette.*`. 1회/금액만큼 여러 번, 테스트 후원 포함. 실제 후원 수신 PENDING, 안내: `docs/chzzk-donation-roulette.md`
- 2026-10-23 브랜치 `feat/viewer-card-flip`(기준 `main` @ 5d5966a): 카드 뒤집기 보상(`src/card-flip*.js`, `public/card-flip*`, `public/portal-card-flip.js`, 안내 `docs/viewer-card-flip.md`), 기능 숨기기(`src/feature-visibility.js`, `public/portal-features.js`, 서버에서도 거절), 포털 다크 모드(검정 바탕·세이지 강조, 사용자 결정으로 세이지 밝은 색 규칙의 예외). 실제 후원 수신·배포 PENDING.
- 2026-10-23 뽑기판(`src/lottery-board*.js`, PR #15) · 연습 모드 포털(`src/app.js` `config.demo` 블록, `/portal/`) · 테스트 후원(`/api/card-flip/test`, `/api/lottery-board/test`). 실제 후원 수신 PENDING.
- 2026-10-24 OBS 후원 알림(`src/donation-alert.js`, `public/donation-alert.*`, `public/portal-alert.js`) · 연습 모드에서 서버별 공간 전용 화면 5개 · 이름 댕댕봇 통일 · 문서 `docs/hosting-options.md`, `docs/real-e2e-checklist.md`. 새 캐릭터(가칭 "모아") 시안은 보류(사용자 결정), 코드 미반영.
- 2026-10-24 채팅 명령어(`src/chat-commands.js`, 공식 `chats/send`), OBS 후원 목표(`src/donation-goal.js`), 후원 알림 구간·그림·소리(`donation-alert.json` 버전 2, `donation-alert-media/`). 실제 채팅 답장·후원 수신 PENDING. `!신청` 구현(2026-10-24, 연결 계정=디스코드 규칙, 그 외=Queue 경로 `chzzk`), 시청자 화면 뽑기판·명령어 안내.
- SOOP 연동: 보류(사용자 결정). 조사: `docs/soop-integration-research.md`. 구현 완료로 표시하지 않는다.
- 상세 인수인계: 핸드오프 폴더의 `CLAUDE_HANDOFF.md`.
