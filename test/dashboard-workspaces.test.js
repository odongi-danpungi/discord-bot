import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { DASHBOARD_TABS } from '../public/dashboard-shell.js';
test('Naver and Discord operations live in independent pages with unique controls',async t=>{
 const dom=new JSDOM(await readFile(new URL('../public/index.html',import.meta.url),'utf8'));t.after(()=>dom.window.close());const d=dom.window.document;
 const expected={naver:'naverConnect',naversearch:'naverSearch',navermonitor:'naverMonitorSave',naverqueue:'naverParticipationOpen',naverwrite:'naverArticleSubject',discord:'healthRefresh'};
 for(const [page,id] of Object.entries(expected)){assert.ok(DASHBOARD_TABS[page]);assert.equal(d.getElementById(id).closest('[data-page]').dataset.page,page);}
 const ids=[...d.querySelectorAll('[id]')].map(e=>e.id);assert.equal(new Set(ids).size,ids.length);
 assert.equal(d.querySelector('[data-page="settings"] .naver-panel'),null);
 assert.ok(d.querySelector('link[href="/business-theme.css"]'));
});
