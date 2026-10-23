# OBS 후원 알림

- 스트리머: 포털 → 방송 → OBS → OBS 후원 알림. 사용 여부, 표시 시간(3~20초), 알림 소리, 후원 메시지 보이기, **금액 구간 1~5개**.
- 금액 구간: 구간마다 최소 금액(1~1,000,000치즈), 알림 문구(60자, `{닉네임}`·`{금액}` 자리), 그림 1개, 소리 1개. 후원 금액보다 작거나 같은 최소 금액 중 가장 높은 구간을 씁니다. 첫 구간보다 적은 후원은 알림이 뜨지 않습니다.
- 그림·소리 올리기: 그림 PNG·JPG·WEBP·GIF, 소리 MP3·OGG·WAV, 각각 2MB까지. 서버가 파일 앞부분으로 형식을 다시 확인합니다(SVG·HTML 등은 거절). 파일은 `donation-alert-media/`에 저장하고, 바꾸거나 구간을 빼면 쓰지 않는 파일을 지웁니다. 그림이 없으면 기본 치즈 그림, 소리가 없으면 기본 효과음을 씁니다.
- OBS: 브라우저 소스 `/w/:서버/broadcast/donation-alert?token=...`(방송 토큰), 투명 배경, 권장 800×300. 소리를 쓰려면 OBS 브라우저 소스에서 "OBS에서 오디오 제어"를 켭니다.
- 동작: 연결한 방송 계정의 치즈 후원(공식 Session API, 다른 후원 기능과 같은 구독 하나)을 받아 한 번에 하나씩 보여 줍니다. 다른 채널 후원과 첫 구간 미만은 무시하고 개수만 셉니다.
- 저장: `operations.json.donation-alert.json`(버전 2)에는 설정·구간·파일 이름만 저장합니다. 예전 버전 1 파일은 구간 하나로 읽고 다음 저장 때 버전 2로 바꿉니다. 알림(닉네임·금액·후원 메시지)은 서버 메모리에 최근 30개만 두고 디스크에 쓰지 않습니다. 후원자 채널 ID는 이 기능에 전달되지 않습니다.
- 테스트: 같은 화면의 "OBS 테스트". 금액에 맞는 구간으로 보여 주고(첫 구간보다 적으면 첫 구간) OBS에 `테스트` 표시가 붙습니다(1초에 한 번).
- API: `GET/POST /api/donation-alert`, `POST /api/donation-alert/test`, `POST /api/donation-alert/media`, `POST /api/donation-alert/media/remove`, `GET /api/donation-alert/media/:파일`(운영자, `broadcast` 권한, CSRF·Idempotency-Key·긴급 잠금 적용, 서버별 공간에서 올리기 요청만 본문 3MB) · OBS `GET /broadcast/api/donation-alert`, `GET /broadcast/api/donation-alert/media/:파일`(방송 토큰).
- 기능 숨기기: `obs-alert`를 숨기면 위 API도 403입니다.
- **PENDING**: 실제 치지직 후원으로 알림이 뜨는지, 실제 OBS에서 소리가 나는지, 배포.
