import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {TRACKS} from '../public/maps.js';
import {sampleParticipants} from '../public/studio-core.js';

test('race studio exposes race and circuit views with five playable tracks',async()=>{
 const html=await readFile(new URL('../public/game-studio.html',import.meta.url),'utf8');
 for(const view of ['race','maps'])assert.match(html,new RegExp(`data-view=\"${view}\"`));
 assert.doesNotMatch(html,/data-view=\"battle\"|weapons\.html|스틱맨/);
 assert.match(html,/현재 모집 레이스 추첨 확정/);assert.match(html,/같은 경기 다시 보기/);
 assert.equal(TRACKS.length,5);assert.equal(new Set(TRACKS.map(m=>m.id)).size,5);
});

test('practice participants receive deterministic visual-only race colors',()=>{
 const people=sampleParticipants(8);
 assert.equal(people.length,8);assert.equal(new Set(people.map(person=>person.id)).size,8);
 assert.ok(people.every(person=>person.avatar?.color&&person.avatar.damage===undefined));
 assert.ok(new Set(people.map(person=>person.avatar.color)).size>1);
});
