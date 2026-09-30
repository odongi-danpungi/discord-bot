export const fields = ['chzzkName','erNickname','erCurrentTier','erPeakTier','lolRiotId','lolMainLane','lolCurrentTier','lolPeakTier'];
export function hasGame(record, game) { return Boolean(game === 'er' ? record?.erNickname?.trim() : record?.lolRiotId?.trim()); }
export function validateProfile(input) {
  const clean = {};
  for (const key of fields) {
    if (input[key] !== undefined && typeof input[key] !== 'string') throw Error('문자열로 입력해 주세요.');
    const value = (input[key] || '').trim();
    if (/[\x00-\x1f\x7f]/.test(value)) throw Error('줄바꿈이나 제어 문자는 입력할 수 없습니다.');
    if (value.length > (key === 'chzzkName' ? 32 : 100)) throw Error(key === 'chzzkName' ? '치지직 닉네임은 Discord 적용을 위해 32자 이하여야 합니다.' : '각 항목은 100자 이하여야 합니다.');
    clean[key] = value;
  }
  if (!clean.chzzkName) throw Error('치지직 닉네임을 입력해 주세요.');
  if (!clean.erNickname && !clean.lolRiotId) throw Error('이터널 리턴 또는 롤 계정 중 하나 이상 입력해 주세요.');
  if (clean.lolRiotId && !/^.{1,32}#[^#\s]{2,10}$/.test(clean.lolRiotId)) throw Error('롤 Riot ID는 이름#태그 형식으로 입력해 주세요.');
  return clean;
}
