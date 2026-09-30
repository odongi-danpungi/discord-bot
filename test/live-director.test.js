import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { raceTelemetry } from '../public/live-director.js';

test('integrated dashboard contains the Live Director canvas and controls',async()=>{
 const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
 for(const id of ['liveDirectorPanel','directorCanvas','directorPause','directorReplay','directorPopup','directorLeader','directorProgress'])assert.match(html,new RegExp(`id="${id}"`));
 assert.match(html,/전체 화면 게임 스튜디오/);
});

test('race telemetry reports leader, lap, gap and progress for v4 races',()=>{
 const draw={mode:'race',version:4,laps:3,finishDistance:3000};
 const frame={rank:[1,0],positions:[900,1250]};
 const telemetry=raceTelemetry(draw,frame);
 assert.equal(telemetry.leader,1);
 assert.equal(telemetry.lap,2);
 assert.equal(telemetry.gap,350);
 assert.equal(telemetry.percent,42);
});
