import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSupplyChainSbom, compareDependencyDocuments, inspectDependencyDocuments, reviewReleaseDependencies } from '../src/supply-chain.js';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const pkg=(version='1.0.0',extra={})=>JSON.stringify({name:'fixture',version,engines:{node:'>=22'},dependencies:{alpha:'^1.0.0'},devDependencies:{beta:'^2.0.0'},...extra});
const lock=(version='1.0.0',opts={})=>JSON.stringify({name:'fixture',version,lockfileVersion:3,requires:true,packages:{'':{name:'fixture',version,dependencies:{alpha:'^1.0.0'},devDependencies:{beta:'^2.0.0'}},'node_modules/alpha':{version:'1.2.3',resolved:'https://registry.npmjs.org/alpha/-/alpha-1.2.3.tgz',integrity:'sha512-AAAA=',license:'MIT',...(opts.alpha||{})},'node_modules/beta':{version:'2.1.0',resolved:'https://registry.npmjs.org/beta/-/beta-2.1.0.tgz',integrity:'sha512-BBBB=',license:'ISC',dev:true}}});

test('supply chain inspection validates lock integrity and dependency alignment',()=>{
  const result=inspectDependencyDocuments(pkg(),lock(),{expectedVersion:'1.0.0'});assert.equal(result.status,'pass');assert.equal(result.stats.total,2);assert.equal(result.stats.direct,2);assert.equal(result.stats.missingIntegrity,0);
  const sbom=buildSupplyChainSbom(result);assert.equal(sbom.format,'daengdaeng-sbom-v1');assert.equal(sbom.components.length,2);
});

test('supply chain rejects lifecycle scripts and unsafe direct sources',()=>{
  const bad=JSON.stringify({name:'fixture',version:'1.0.0',scripts:{postinstall:'node evil.js'},dependencies:{alpha:'https://example.com/a.tgz'}});
  const badLock=JSON.stringify({name:'fixture',version:'1.0.0',lockfileVersion:3,packages:{'':{name:'fixture',version:'1.0.0',dependencies:{alpha:'https://example.com/a.tgz'}},'node_modules/alpha':{version:'1.0.0',resolved:'https://example.com/a.tgz',integrity:'sha512-AAAA='}}});
  const result=inspectDependencyDocuments(bad,badLock,{expectedVersion:'1.0.0'});assert.equal(result.status,'fail');assert.equal(result.checks.some(x=>x.id==='root-lifecycle'&&x.status==='fail'),true);assert.equal(result.checks.some(x=>x.id==='direct-source'&&x.status==='fail'),true);
});

test('dependency diff reports direct and transitive additions',()=>{
  const current=inspectDependencyDocuments(pkg(),lock());
  const nextPkg=JSON.stringify({name:'fixture',version:'1.1.0',dependencies:{alpha:'^1.0.0',gamma:'^3.0.0'},devDependencies:{beta:'^2.0.0'}});
  const nextLock=JSON.stringify({name:'fixture',version:'1.1.0',lockfileVersion:3,packages:{'':{name:'fixture',version:'1.1.0',dependencies:{alpha:'^1.0.0',gamma:'^3.0.0'},devDependencies:{beta:'^2.0.0'}},'node_modules/alpha':{version:'1.2.3',resolved:'https://registry.npmjs.org/alpha/-/alpha-1.2.3.tgz',integrity:'sha512-AAAA='},'node_modules/beta':{version:'2.1.0',resolved:'https://registry.npmjs.org/beta/-/beta-2.1.0.tgz',integrity:'sha512-BBBB=',dev:true},'node_modules/gamma':{version:'3.0.1',resolved:'https://registry.npmjs.org/gamma/-/gamma-3.0.1.tgz',integrity:'sha512-CCCC='}}});
  const target=inspectDependencyDocuments(nextPkg,nextLock);const diff=compareDependencyDocuments(current,target);assert.equal(diff.added.length,1);assert.equal(diff.added[0].name,'gamma');assert.equal(diff.transitiveAdded,1);
});

test('release dependency review requires package and lock to change together',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'dd-supply-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(root,{recursive:true});await writeFile(path.join(root,'package.json'),pkg());await writeFile(path.join(root,'package-lock.json'),lock());
  const content=Buffer.from(pkg('1.1.0'));const inspected={baseVersion:'1.0.0',targetVersion:'1.1.0',normalized:{files:[{path:'package.json',content}],deletes:[]}};const result=await reviewReleaseDependencies(root,inspected);assert.equal(result.status,'fail');assert.equal(result.checks.some(x=>x.id==='supply-files'&&x.status==='fail'),true);
});
