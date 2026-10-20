# SOOP 연동 조사 (구현 전 · PENDING)

조사일: 2026-10-19. 근거는 SOOP Developers 공식 문서(https://developers.sooplive.com)와 Developers 이용약관입니다. **이 문서는 구현 완료를 의미하지 않습니다.** 코드에는 SOOP 연동이 없고, 화면에는 계속 "연동 준비 중"으로만 표시합니다.

## 1. 공식 API 개요

- 개발자 등록 → 애플리케이션 생성(이름·Redirect URL·로고·사용 범위) → `client_id`/`client_secret` 발급.
- 권한은 두 종류입니다.
  - **Public**: 생성 즉시 사용. 예) `GET broad/list`(현재 방송 목록), `broad/category/list`, 방송 필터.
  - **Consent**: SOOP Developers 운영팀 **별도 심사 후** 사용. 신청 양식에 이메일, 구현 기능, 기대효과, 홈페이지, 연관 스트리머, 회사명, 개인정보처리방침, 첨부 파일이 필요합니다.
- OAuth: `GET/POST https://openapi.sooplive.com/auth/code` → `POST auth/token` (`grant_type=authorization_code|refresh_token`, `client_secret` 필요). 문서 예시 기준 `access_token` 만료 28,800초(8시간), `refresh_token`으로 재발급. 인증 code는 1회용.

| Scope (Consent) | 기능 | 댕댕봇 활용 후보 |
|---|---|---|
| `validate_live_status` | `POST validate/live/status` — 토큰 소유자의 방송 중 여부(streaming/streamend), 방송 번호·제목·시작 시각·시청자 수·썸네일·링크 | 방송 시작·종료 알림 (CHZZK 방송 알림과 같은 역할) |
| `user_stationinfo` | `POST user/stationinfo` — 닉네임, 방송국 이름, 프로필, 최근 방송일, 애청자 수 | 방송 소유자 계정 연결 확인 |
| `broad_access_chatinfo` | Chat SDK — 채팅 조회·전송·관리, 후원 메시지 조회 | 후속 후보 (아래 제약 참고) |
| `broad_rtmp`, `broad_rtmp_reset`, `broad_info_update` | 스트림 키 조회·재발급, 방송 정보 변경 | **사용하지 않음** (스트림 키는 비밀번호와 같은 민감 정보, 운영 범위 밖) |
| `broad_review_list`, `validate_vod_owner`, `aqua_component_get` | 다시보기·VOD·전자비서 | 범위 밖 |

## 2. 확인된 제약

- **팔로워(애청자) 인증 API는 2026-10-19 기준 공식 Scope 명세와 API 문서에서 확인되지 않습니다.** `user/stationinfo`는 애청자 *수*만 제공하며, 특정 참가자가 그 방송국을 애청하는지 확인하는 엔드포인트는 찾지 못했습니다. 따라서 CHZZK의 "팔로워 인증 → Discord 역할 부여"와 같은 기능은 SOOP에서 공식 API로 구현할 근거가 없습니다.
- Chat SDK는 **웹 브라우저(JavaScript) 전용**이고, 문서에 "SDK로 개발된 프로그램은 본인 방송에만 접속하여 사용이 가능"하다고 되어 있습니다. 서버(Node.js) 상주 봇이 여러 방송자의 채팅을 대신 읽는 구조는 공식 지원 범위로 보기 어렵습니다.
- 약관상 회원은 서비스에서 얻은 정보(데이터·비밀 키·액세스 토큰)를 사전 승낙 없이 복제·제3자 제공할 수 없고, 제공 한도(일·월·MAU)를 넘을 수 없으며, 개인정보 해당 데이터는 이용자 동의·암호화 송수신·탈퇴 시 파기 의무가 있습니다. 상표·로고 무단 사용도 금지입니다.
- 공식 문서에서 구체적인 호출 한도 수치는 확인하지 못했습니다(운영정책에서 정한다고만 명시). 심사 시 확인이 필요합니다.
- 비공식 라이브러리·사용자 세션 수집·화면 스크래핑은 사용하지 않습니다.

## 3. 제안하는 구현 범위 (승인 후 진행)

1단계 — 방송 소유자 연결 + 방송 시작·종료 알림 (서버별)
- 운영자가 자신의 SOOP 계정으로 OAuth 동의 → `user/stationinfo`로 연결 확인 → 서버별로 암호화 저장(CHZZK와 같은 방식의 별도 키, 기존 `CHZZK_TOKEN_KEY` 재사용 금지).
- `validate/live/status`를 주기적으로 조회해 Discord 방송 알림 채널에 시작·종료를 알림. CHZZK 모니터와 같은 실패 처리(재시도 폭주 방지, 토큰 갱신 single-flight).
- 필요 Scope: `user_stationinfo`, `validate_live_status` → **둘 다 Consent라 SOOP 심사 승인이 선행 조건**입니다.
- 화면: 대분류 "SOOP" 또는 기존 CHZZK와 같은 "방송 계정" 아래 소분류. 승인 전에는 "연동 준비 중" 유지.

하지 않는 것
- 팔로워 인증·역할 부여(공식 API 미확인), 스트림 키·방송 정보 변경, 서버 상주 채팅 수집.

## 4. 사용자 확인이 필요한 일

1. SOOP Developers 개발자 등록과 애플리케이션 생성(Redirect URL은 운영 주소 확정 후).
2. `user_stationinfo`, `validate_live_status` Consent 심사 신청 — 개인정보처리방침 URL과 연관 스트리머 정보가 필요합니다.
3. 승인 후 발급되는 `client_id`/`client_secret`은 Railway Secret에만 저장하고 채팅·로그·Git에 남기지 않습니다.
4. 1단계 범위로 진행할지 결정.
