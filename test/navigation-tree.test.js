import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const source=await readFile(new URL('../public/navigation-tree.js',import.meta.url),'utf8');
test('three-level navigation preserves every existing tab and reveals selected ancestors',async t=>{
 const dom=new JSDOM(await readFile(new URL('../public/index.html',import.meta.url),'utf8'),{url:'https://example.test/#home',runScripts:'outside-only'});t.after(()=>dom.window.close());const d=dom.window.document,prior=[...d.querySelectorAll('.sidebar [data-tab]')].map(x=>x.dataset.tab).sort();dom.window.eval(source);
 assert.deepEqual([...d.querySelectorAll('.sidebar [data-tab]')].map(x=>x.dataset.tab).sort(),prior);assert.equal(d.querySelectorAll('.sidebar nav>.menu-major').length,3);assert.equal(d.querySelectorAll('.sidebar details[open]').length,0);
 d.querySelector('[data-tab="home"]').removeAttribute('aria-current');d.querySelector('[data-tab="home"]').classList.remove('active');const active=d.querySelector('[data-tab="release"]');active.classList.add('active');active.setAttribute('aria-current','page');await new Promise(r=>setTimeout(r,20));assert.equal(active.closest('.menu-middle').open,true);assert.equal(active.closest('.menu-major').open,true);assert.match(d.querySelector('.menu-breadcrumb').textContent,/시스템 관리.*배포·업데이트/);
});
test('community selection keeps related save controls accessible and preserves unsaved inputs',async t=>{
 const dom=new JSDOM(await readFile(new URL('../public/community.html',import.meta.url),'utf8'),{url:'https://example.test/community.html#guide',runScripts:'outside-only'});t.after(()=>dom.window.close());const w=dom.window,d=w.document;w.eval(source);assert.equal(d.querySelector('#guide').hidden,false);assert.equal(d.querySelector('#recruitment').hidden,true);d.querySelector('#rules-title').value='미저장 제목';w.location.hash='#subscriptions';await new Promise(r=>setTimeout(r,20));assert.equal(d.querySelector('#subscriptions').hidden,false);assert.equal(d.querySelector('#fairness').hidden,false);assert.equal(d.querySelector('#rules-title').value,'미저장 제목');w.location.hash='#recruitment';await new Promise(r=>setTimeout(r,20));assert.equal(d.querySelector('#publication').hidden,false);
});
