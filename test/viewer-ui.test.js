import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {JSDOM} from 'jsdom';import {DEFAULT_AVATAR} from '../public/avatar.js';
test('viewer UI edits cosmetic fields and submits only its logged-in revision with CSRF',async()=>{
 const dom=new JSDOM(await readFile(new URL('../public/viewer.html',import.meta.url),'utf8'),{runScripts:'outside-only',url:'http://localhost/viewer/'}),w=dom.window,requests=[];
 w.DEFAULT_AVATAR=DEFAULT_AVATAR;w.requestAnimationFrame=()=>1;w.CanvasRenderingContext2D=class{};w.HTMLCanvasElement.prototype.getContext=()=>({fillStyle:'',strokeStyle:'',lineWidth:1,setLineDash(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},save(){},restore(){},translate(){},roundRect(){},fill(){},arc(){},fillRect(){},fillText(){},font:'',textAlign:''});
 w.fetch=async(url,options={})=>{requests.push({url,options});return {ok:true,json:async()=>url.endsWith('/me')?{name:'별',avatar:DEFAULT_AVATAR,revision:3,csrf:'csrf'}:url.endsWith('/mode')?{demo:true}:{revision:4}}};
 w.eval((await readFile(new URL('../public/community-viewer.js',import.meta.url),'utf8')).replace('export function','function'));w.eval((await readFile(new URL('../public/viewer.js',import.meta.url),'utf8')).replace(/^import .*;\r?$/gm,''));await new Promise(r=>setTimeout(r,10));
 assert.equal(w.document.getElementById('editor').hidden,false);assert.equal(w.document.querySelectorAll('#fields label').length,2);
 const color=w.document.querySelector('#fields input');color.value='#123456';color.dispatchEvent(new w.Event('input'));w.document.getElementById('save').click();await new Promise(r=>setTimeout(r,10));
 const saved=requests.find(r=>r.url.endsWith('/avatar'));assert.equal(JSON.parse(saved.options.body).color,'#123456');assert.equal(JSON.parse(saved.options.body).revision,3);assert.equal(saved.options.headers['X-CSRF-Token'],'csrf');dom.window.close();
});
