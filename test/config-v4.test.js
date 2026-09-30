import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

const base={DISCORD_TOKEN:'test_token_value_long_enough_for_config',DISCORD_CLIENT_ID:'12345678901234567',DISCORD_GUILD_ID:'22345678901234567',DASHBOARD_PASSWORD:'a_secure_test_password'};

test('production profile and backup retention defaults are applied',async()=>{
  const config=await loadConfig(base,[]);
  assert.equal(config.profile,'production');assert.equal(config.backupKeepCount,14);assert.equal(config.backupMaxAgeDays,30);assert.equal(config.backupIntervalHours,24);assert.equal(config.backupDir,'./data/backups');assert.equal(config.idempotencyFile,'./data/idempotency.json');assert.equal(config.naverAuthFile,'./data/naver-auth.json');assert.equal(config.naverMonitorFile,'./data/naver-monitor.json');assert.equal(config.naverParticipationFile,'./data/naver-participation.json');assert.equal(config.participationQueueFile,'./data/participation-queue.json');assert.equal(config.participationCallTimeoutSeconds,60);assert.equal(config.naverMonitorIntervalMinutes,5);assert.equal(config.naverClientId,'');assert.equal(config.chzzkClientId,'');assert.equal(config.chzzkMonitorEnabled,false);assert.equal(config.chzzkMonitorIntervalMinutes,2);assert.equal(config.chzzkLiveFile,'./data/chzzk-live.json');
});

test('--dev selects development profile and demo stays isolated',async()=>{
  const dev=await loadConfig(base,['--dev']);assert.equal(dev.profile,'development');assert.equal(dev.dev,true);
  const demo=await loadConfig({},['--demo']);assert.equal(demo.profile,'demo');assert.equal(demo.host,'127.0.0.1');assert.match(demo.backupDir,/data\/demo\/backups/);
});

test('invalid backup retention values are rejected',async()=>{
  await assert.rejects(loadConfig({...base,BACKUP_KEEP_COUNT:'0'},[]),/BACKUP_KEEP_COUNT/);
  await assert.rejects(loadConfig({...base,BACKUP_MAX_AGE_DAYS:'366'},[]),/BACKUP_MAX_AGE_DAYS/);
});

test('persistent JSON stores must use distinct file paths',async()=>{
  await assert.rejects(loadConfig({...base,DATA_FILE:'./data/shared.json',OPERATIONS_FILE:'./data/shared.json'},[]),/같은 JSON 파일/);
  await assert.rejects(loadConfig({...base,IDEMPOTENCY_FILE:'./data/operations.json'},[]),/같은 JSON 파일/);
  await assert.rejects(loadConfig({...base,PARTICIPATION_QUEUE_FILE:'./data/operations.json'},[]),/같은 JSON 파일/);
});

test('Naver integration validates credentials, callback and numeric Cafe IDs',async()=>{
  const configured=await loadConfig({...base,NAVER_CLIENT_ID:'client',NAVER_CLIENT_SECRET:'secret',NAVER_CAFE_ID:'1234',NAVER_MENU_ID:'5',NAVER_MEMO_MENU_ID:'7'},[]);assert.equal(configured.naverCafeId,'1234');assert.equal(configured.naverMenuId,'5');assert.equal(configured.naverMemoMenuId,'7');
  await assert.rejects(loadConfig({...base,NAVER_CLIENT_ID:'client'},[]),/NAVER_CLIENT_SECRET/);
  await assert.rejects(loadConfig({...base,NAVER_CLIENT_ID:'client',NAVER_CLIENT_SECRET:'secret',NAVER_CAFE_ID:'abc'},[]),/NAVER_CAFE_ID/);
  await assert.rejects(loadConfig({...base,NAVER_CLIENT_ID:'client',NAVER_CLIENT_SECRET:'secret',NAVER_MENU_ID:'5'},[]),/NAVER_CAFE_ID/);
  await assert.rejects(loadConfig({...base,NAVER_CLIENT_ID:'client',NAVER_CLIENT_SECRET:'secret',NAVER_MEMO_MENU_ID:'memo'},[]),/NAVER_MEMO_MENU_ID/);
  await assert.rejects(loadConfig({...base,NAVER_CLIENT_ID:'client',NAVER_CLIENT_SECRET:'secret',NAVER_MEMO_MENU_ID:'7'},[]),/NAVER_CAFE_ID/);
  await assert.rejects(loadConfig({...base,NAVER_CLIENT_ID:'client',NAVER_CLIENT_SECRET:'secret',NAVER_TOKEN_KEY:'short'},[]),/NAVER_TOKEN_KEY/);
  await assert.rejects(loadConfig({...base,NAVER_CLIENT_ID:'client',NAVER_CLIENT_SECRET:'secret',NAVER_REDIRECT_URI:'https:\/\/example.com\/naver\/callback'},[]),/NAVER_TOKEN_KEY/);
  const monitor=await loadConfig({...base,NAVER_CLIENT_ID:'client',NAVER_CLIENT_SECRET:'secret',NAVER_MONITOR_ENABLED:'true',NAVER_MONITOR_QUERY:'방송',NAVER_MONITOR_CAFE_URL:'https://cafe.naver.com/target/',NAVER_MONITOR_INTERVAL_MINUTES:'15'},[]);assert.equal(monitor.naverMonitorEnabled,true);assert.equal(monitor.naverMonitorCafeUrl,'https://cafe.naver.com/target');assert.equal(monitor.naverMonitorIntervalMinutes,15);
  await assert.rejects(loadConfig({...base,NAVER_CLIENT_ID:'client',NAVER_CLIENT_SECRET:'secret',NAVER_MONITOR_ENABLED:'true'},[]),/NAVER_MONITOR_QUERY/);
  await assert.rejects(loadConfig({...base,NAVER_CLIENT_ID:'client',NAVER_CLIENT_SECRET:'secret',NAVER_MONITOR_QUERY:'x',NAVER_MONITOR_CAFE_URL:'https://example.com/no'},[]),/NAVER_MONITOR_CAFE_URL/);
});


test('CHZZK live monitor validates client credentials, channel id, interval and scan cap',async()=>{
  const channel='0123456789abcdef0123456789abcdef';
  const configured=await loadConfig({...base,CHZZK_CLIENT_ID:'client-id',CHZZK_CLIENT_SECRET:'client-secret',CHZZK_CHANNEL_ID:channel,CHZZK_MONITOR_ENABLED:'true',CHZZK_MONITOR_INTERVAL_MINUTES:'5',CHZZK_LIVE_SCAN_MAX_PAGES:'25'},[]);
  assert.equal(configured.chzzkChannelId,channel);assert.equal(configured.chzzkMonitorEnabled,true);assert.equal(configured.chzzkMonitorIntervalMinutes,5);assert.equal(configured.chzzkLiveScanMaxPages,25);
  await assert.rejects(loadConfig({...base,CHZZK_CLIENT_ID:'client-id',CHZZK_CHANNEL_ID:channel},[]),/CHZZK_CLIENT_SECRET/);
  await assert.rejects(loadConfig({...base,CHZZK_CLIENT_ID:'client-id',CHZZK_CLIENT_SECRET:'client-secret',CHZZK_CHANNEL_ID:'short'},[]),/CHZZK_CHANNEL_ID/);
  await assert.rejects(loadConfig({...base,CHZZK_CLIENT_ID:'client-id',CHZZK_CLIENT_SECRET:'client-secret',CHZZK_CHANNEL_ID:channel,CHZZK_MONITOR_INTERVAL_MINUTES:'3'},[]),/CHZZK_MONITOR_INTERVAL_MINUTES/);
  await assert.rejects(loadConfig({...base,CHZZK_CLIENT_ID:'client-id',CHZZK_CLIENT_SECRET:'client-secret',CHZZK_CHANNEL_ID:channel,CHZZK_LIVE_SCAN_MAX_PAGES:'0'},[]),/CHZZK_LIVE_SCAN_MAX_PAGES/);
});

test('participation call timeout is bounded for broadcast response safety',async()=>{
  const configured=await loadConfig({...base,PARTICIPATION_CALL_TIMEOUT_SECONDS:'45'},[]);assert.equal(configured.participationCallTimeoutSeconds,45);
  await assert.rejects(loadConfig({...base,PARTICIPATION_CALL_TIMEOUT_SECONDS:'14'},[]),/PARTICIPATION_CALL_TIMEOUT_SECONDS/);
  await assert.rejects(loadConfig({...base,PARTICIPATION_CALL_TIMEOUT_SECONDS:'301'},[]),/PARTICIPATION_CALL_TIMEOUT_SECONDS/);
});

test('delegated dashboard operator credentials and capabilities are validated',async()=>{
  const configured=await loadConfig({...base,DASHBOARD_OPERATOR_USER:'producer',DASHBOARD_OPERATOR_PASSWORD:'another_secure_password',DASHBOARD_OPERATOR_CAPABILITIES:'live,queue,discord'},[]);
  assert.equal(configured.dashboardOperatorUser,'producer');assert.equal(configured.dashboardOperatorPassword,'another_secure_password');assert.deepEqual(configured.dashboardOperatorCapabilities,['live','queue','discord']);
  await assert.rejects(loadConfig({...base,DASHBOARD_OPERATOR_USER:'producer'},[]),/모두 설정/);
  await assert.rejects(loadConfig({...base,DASHBOARD_OPERATOR_PASSWORD:'another_secure_password'},[]),/모두 설정/);
  await assert.rejects(loadConfig({...base,DASHBOARD_OPERATOR_USER:'admin',DASHBOARD_OPERATOR_PASSWORD:'another_secure_password'},[]),/아이디는 서로 달라야/);
  await assert.rejects(loadConfig({...base,DASHBOARD_OPERATOR_USER:'producer',DASHBOARD_OPERATOR_PASSWORD:base.DASHBOARD_PASSWORD},[]),/비밀번호는 서로 다르게/);
  await assert.rejects(loadConfig({...base,DASHBOARD_OPERATOR_USER:'producer',DASHBOARD_OPERATOR_PASSWORD:'another_secure_password',DASHBOARD_OPERATOR_CAPABILITIES:'queue,release'},[]),/지원하지 않는 권한/);
});
