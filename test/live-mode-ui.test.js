import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('dashboard exposes dedicated broadcast live mode with one-tap controls',async()=>{
 const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
 const js=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
 for(const id of ['liveOpsTitle','liveOpsRound','liveOpsApplicants','liveOpsConfirmed','liveOpsNextButton','liveOpsQuickStart','liveOpsRoster','liveOpsWinners','liveOpsTeams','liveOpsTeamSummary','liveTeamStrategy','liveTeamHistoryDepth','liveOpsFeed'])assert.match(html,new RegExp(`id="${id}"`));
 for(const action of ['close','reopen','draw','attendance','replace','teams','reshuffle','publish','voice','end'])assert.match(html,new RegExp(`data-live-op="${action}"`));
 assert.match(html,/data-live-start="aram"/);assert.match(html,/data-live-start="rift"/);assert.match(html,/data-live-start="er"/);
 assert.match(js,/buildLiveModeModel/);assert.match(js,/quickStartPreset/);assert.match(js,/data-live-op/);
});
