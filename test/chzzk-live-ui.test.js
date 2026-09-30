import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
const js=await readFile(new URL('../public/app.js',import.meta.url),'utf8');

test('Live Control exposes CHZZK status and manual check controls',()=>{
  assert.match(html,/id="liveOpsChzzk"/);assert.match(html,/id="liveOpsChzzkCheck"/);assert.match(html,/id="liveOpsChzzkDetail"/);assert.match(js,/\/api\/chzzk\/live\/run/);assert.match(js,/CHZZK LIVE/);
});

test('dashboard can auto-open Live Mode when CHZZK becomes live',()=>{assert.match(js,/chzzkAutoOpened/);assert.match(js,/tab\('live'\)/);});
