# OBS 후원 목표

- 스트리머: 포털 → 방송 → OBS → OBS 후원 목표. 사용 여부, 목표 제목(30자), 목표 금액(100~100,000,000치즈), 테스트 후원도 더하기, "0부터 다시 시작".
- OBS: `/w/:서버/broadcast/donation-goal?token=...`(방송 토큰), 투명 배경, 권장 900×140. 후원이 들어오면 막대가 차오르고 `+금액`이 잠깐 뜹니다. 목표를 넘으면 막대 색이 바뀝니다.
- 저장: `operations.json.donation-goal.json`에 설정과 누적 금액·횟수만 저장합니다. 후원자 이름·메시지·채널 ID는 저장하지 않습니다. 0부터 다시 시작하면 이전 금액은 복구할 수 없습니다.
- 테스트: "테스트 후원도 더하기"가 꺼져 있으면 OBS에 줄무늬로 3초만 보이고 누적 금액은 그대로입니다. 켜면 누적 금액에 더합니다(1초에 한 번).
- API: `GET/POST /api/donation-goal`, `POST /api/donation-goal/reset`, `POST /api/donation-goal/test`(운영자, `broadcast` 권한, CSRF·Idempotency-Key·긴급 잠금·revision 충돌 검사) · OBS `GET /broadcast/api/donation-goal`. 기능 숨기기 `obs-goal`.
- **PENDING**: 실제 치지직 후원으로 누적되는지, 배포.
