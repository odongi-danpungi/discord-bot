import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { generateKeyPairSync } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { ReleaseCenter, RELEASE_FORMATS, buildCurrentManifest, compareVersions, createReleaseBundle, inspectReleaseBundle, inspectReleasePublicKey, normalizeReleasePath, signReleaseBundle } from '../src/release-center.js';

async function fixture(){
  const root=await mkdtemp(path.join(os.tmpdir(),'dd-release-'));await mkdir(path.join(root,'src'),{recursive:true});await mkdir(path.join(root,'public'),{recursive:true});
  await writeFile(path.join(root,'package.json'),JSON.stringify({name:'fixture',version:'4.2.0',dependencies:{}}));await writeFile(path.join(root,'package-lock.json'),JSON.stringify({name:'fixture',version:'4.2.0',lockfileVersion:3,packages:{'':{name:'fixture',version:'4.2.0',dependencies:{}}}}));await writeFile(path.join(root,'src','version.js'),"export const APP_VERSION='4.2.0';\n");await writeFile(path.join(root,'public','app.js'),'old\n');return root;
}
async function strongBundle(root,{target='4.3.0',files=[],deletes=[]}={}){
  const manifest=await buildCurrentManifest(root,'4.2.0',2),baseMap=new Map(manifest.files.map(item=>[item.path,item]));
  return createReleaseBundle({baseVersion:'4.2.0',targetVersion:target,schemaVersion:2,baseManifestDigest:manifest.digest,files:files.map(file=>{const base=baseMap.get(file.path);return {...file,baseExists:Boolean(base),baseSha256:base?.sha256||null};}),deletes:deletes.map(p=>({path:p,baseSha256:baseMap.get(p)?.sha256||null})),format:RELEASE_FORMATS.strong});
}

test('release version compare and path protection',()=>{
  assert.equal(compareVersions('4.3.0','4.2.0'),1);assert.equal(compareVersions('4.2.0','4.2.0'),0);assert.equal(compareVersions('4.1.9','4.2.0'),-1);
  assert.equal(normalizeReleasePath('src/app.js'),'src/app.js');assert.throws(()=>normalizeReleasePath('../secret'));assert.throws(()=>normalizeReleasePath('data/operations.json'));assert.throws(()=>normalizeReleasePath('.env'));
});

test('legacy v1 release bundle remains compatible',()=>{
  const bundle=createReleaseBundle({baseVersion:'4.1.0',targetVersion:'4.2.0',schemaVersion:2,files:[{path:'public/app.js',content:'next\n'}],format:RELEASE_FORMATS.legacy});
  const result=inspectReleaseBundle(bundle,{currentVersion:'4.1.0',currentSchema:2});assert.equal(result.ok,true);assert.equal(result.integrityMode,'legacy');assert.equal(result.checks.some(c=>c.status==='warn'),true);
  const tampered=structuredClone(bundle);tampered.files[0].contentBase64=Buffer.from('evil').toString('base64');assert.equal(inspectReleaseBundle(tampered,{currentVersion:'4.1.0',currentSchema:2}).ok,false);
});

test('v2 release verifies base hashes and blocks local code drift',async t=>{
  const root=await fixture();t.after(()=>rm(root,{recursive:true,force:true}));const center=new ReleaseCenter({projectRoot:root,stateDir:path.join(root,'data','releases'),currentVersion:'4.2.0',currentSchema:2});await center.init();
  const bundle=await strongBundle(root,{files:[{path:'public/app.js',content:'next\n'}]});let staged=await center.stage(bundle);assert.equal(staged.ok,true);assert.equal(staged.integrityMode,'strong');
  await writeFile(path.join(root,'public','app.js'),'local-edit\n');staged=await center.stage(bundle);assert.equal(staged.ok,false);assert.equal(staged.comparison.counts.drift,1);assert.equal(staged.checks.some(c=>c.id==='base-drift'&&c.status==='fail'),true);
});


test('failed verification invalidates an older staged package',async t=>{
  const root=await fixture();t.after(()=>rm(root,{recursive:true,force:true}));const center=new ReleaseCenter({projectRoot:root,stateDir:path.join(root,'data','releases'),currentVersion:'4.2.0',currentSchema:2});await center.init();
  const good=await strongBundle(root,{files:[{path:'public/app.js',content:'new\n'}]});const staged=await center.stage(good);assert.equal(staged.ok,true);assert.equal(center.snapshot().status,'staged');
  const bad=structuredClone(good);bad.files[0].contentBase64=Buffer.from('tampered').toString('base64');const failed=await center.stage(bad);assert.equal(failed.ok,false);assert.equal(center.snapshot().status,'verify-failed');await assert.rejects(center.readStaged());
});
test('v2 apply rechecks drift after staging and refuses changed source',async t=>{
  const root=await fixture();t.after(()=>rm(root,{recursive:true,force:true}));const center=new ReleaseCenter({projectRoot:root,stateDir:path.join(root,'data','releases'),currentVersion:'4.2.0',currentSchema:2});await center.init();
  const bundle=await strongBundle(root,{files:[{path:'public/app.js',content:'new\n'}]}),staged=await center.stage(bundle);assert.equal(staged.ok,true);await writeFile(path.join(root,'public','app.js'),'edited-after-stage\n');
  await assert.rejects(center.apply({expectedDigest:staged.manifestDigest}),/무결성 검사 실패/);assert.equal(await readFile(path.join(root,'public','app.js'),'utf8'),'edited-after-stage\n');
});

test('release center stages, applies, verifies target and restores changed code',async t=>{
  const root=await fixture();t.after(()=>rm(root,{recursive:true,force:true}));const stateDir=path.join(root,'data','releases');
  const center=new ReleaseCenter({projectRoot:root,stateDir,currentVersion:'4.2.0',currentSchema:2});await center.init();
  const bundle=await strongBundle(root,{files:[{path:'public/app.js',content:'new\n'},{path:'src/new.js',content:'export const x=1;\n'}]});
  const staged=await center.stage(bundle);assert.equal(staged.ok,true);assert.equal(staged.comparison.counts.change,1);assert.equal(staged.comparison.counts.add,1);
  const applied=await center.apply({expectedDigest:staged.manifestDigest});assert.equal(applied.restartRequired,true);assert.equal(await readFile(path.join(root,'public','app.js'),'utf8'),'new\n');assert.equal(await readFile(path.join(root,'src','new.js'),'utf8'),'export const x=1;\n');
  const rolled=await center.rollback();assert.equal(rolled.restartRequired,true);assert.equal(await readFile(path.join(root,'public','app.js'),'utf8'),'old\n');await assert.rejects(readFile(path.join(root,'src','new.js'),'utf8'));
});

test('smoke test catches package/runtime version mismatch',async t=>{
  const root=await fixture();t.after(()=>rm(root,{recursive:true,force:true}));const center=new ReleaseCenter({projectRoot:root,stateDir:path.join(root,'data','releases'),currentVersion:'4.3.0',currentSchema:2});await center.init();center.state.targetVersion='4.3.0';
  const smoke=await center.smoke({operationsReadable:true,dataReadable:true});assert.equal(smoke.status,'fail');assert.equal(smoke.checks.some(check=>check.label==='package.json 버전'&&check.status==='fail'),true);
});

test('legacy apply failure leaves existing code intact and records failure state',async t=>{
  const root=await fixture();t.after(()=>rm(root,{recursive:true,force:true}));const center=new ReleaseCenter({projectRoot:root,stateDir:path.join(root,'data','releases'),currentVersion:'4.2.0',currentSchema:2});await center.init();
  const bundle=createReleaseBundle({baseVersion:'4.2.0',targetVersion:'4.3.0',schemaVersion:2,format:RELEASE_FORMATS.legacy,files:[{path:'public/app.js',content:'changed-before-failure\n'},{path:'src/blocked/new.js',content:'x\n'}]});const staged=await center.stage(bundle);assert.equal(staged.ok,true);
  await writeFile(path.join(root,'src','blocked'),'not-a-directory');await assert.rejects(center.apply({expectedDigest:staged.manifestDigest}));assert.equal(await readFile(path.join(root,'public','app.js'),'utf8'),'old\n');assert.match(center.snapshot().status,/apply-failed/);
});

test('startup recovers an interrupted release transaction from rollback snapshot',async t=>{
  const root=await fixture();t.after(()=>rm(root,{recursive:true,force:true}));const stateDir=path.join(root,'data','releases'),rollbackPath=path.join(stateDir,'rollback','crash-fixture');await mkdir(path.join(rollbackPath,'public'),{recursive:true});
  await writeFile(path.join(rollbackPath,'public','app.js'),'old\n');const oldManifest=await buildCurrentManifest(root,'4.2.0',2),oldHash=oldManifest.files.find(f=>f.path==='public/app.js').sha256;
  await writeFile(path.join(rollbackPath,'rollback.json'),JSON.stringify({releaseId:'crash-fixture',fromVersion:'4.2.0',targetVersion:'4.3.0',files:[{path:'public/app.js',existed:true,sha256:oldHash}]},null,2));
  await mkdir(stateDir,{recursive:true});await writeFile(path.join(stateDir,'transaction-journal.json'),JSON.stringify({operation:'apply',phase:'applying',releaseId:'crash-fixture',fromVersion:'4.2.0',targetVersion:'4.3.0',rollbackPath}));await writeFile(path.join(root,'public','app.js'),'partially-new\n');
  const center=new ReleaseCenter({projectRoot:root,stateDir,currentVersion:'4.2.0',currentSchema:2});await center.init();assert.equal(await readFile(path.join(root,'public','app.js'),'utf8'),'old\n');assert.equal(center.snapshot().status,'crash-recovered-restart-required');assert.equal(center.recoveredThisBoot,true);
  const secondBoot=new ReleaseCenter({projectRoot:root,stateDir,currentVersion:'4.2.0',currentSchema:2});await secondBoot.init();assert.equal(secondBoot.recoveredThisBoot,false);assert.equal(secondBoot.snapshot().status,'crash-recovered');
});


test('v3 Ed25519 release requires a trusted signing key',async t=>{
  const root=await fixture();t.after(()=>rm(root,{recursive:true,force:true}));
  const manifest=await buildCurrentManifest(root,'4.2.0',2),base=manifest.files.find(item=>item.path==='public/app.js');
  const {publicKey,privateKey}=generateKeyPairSync('ed25519'),publicKeyPem=String(publicKey.export({type:'spki',format:'pem'})),privateKeyPem=String(privateKey.export({type:'pkcs8',format:'pem'}));
  let bundle=createReleaseBundle({baseVersion:'4.2.0',targetVersion:'4.3.0',schemaVersion:2,baseManifestDigest:manifest.digest,format:RELEASE_FORMATS.signed,createdAt:'2026-09-16T00:00:00.000Z',files:[{path:'public/app.js',content:'signed-next\n',baseExists:true,baseSha256:base.sha256}]});
  bundle=signReleaseBundle(bundle,{privateKeyPem,keyName:'Fixture Publisher'});
  const untrusted=inspectReleaseBundle(bundle,{currentVersion:'4.2.0',currentSchema:2,trustedKeys:[],signaturePolicy:'warn'});
  assert.equal(untrusted.ok,false);assert.equal(untrusted.signature.valid,true);assert.equal(untrusted.signature.trusted,false);assert.equal(untrusted.signature.candidateKey.keyId,inspectReleasePublicKey(publicKeyPem).keyId);
  const trusted=inspectReleaseBundle(bundle,{currentVersion:'4.2.0',currentSchema:2,trustedKeys:[{...inspectReleasePublicKey(publicKeyPem),publicKeyPem}],signaturePolicy:'required'});
  assert.equal(trusted.ok,true);assert.equal(trusted.integrityMode,'signed');assert.equal(trusted.signature.trusted,true);
});

test('release trust store imports keys, persists policy, and v3 applies only while trusted',async t=>{
  const root=await fixture();t.after(()=>rm(root,{recursive:true,force:true}));const stateDir=path.join(root,'data','releases');
  const {publicKey,privateKey}=generateKeyPairSync('ed25519'),publicKeyPem=String(publicKey.export({type:'spki',format:'pem'})),privateKeyPem=String(privateKey.export({type:'pkcs8',format:'pem'}));
  const center=new ReleaseCenter({projectRoot:root,stateDir,currentVersion:'4.2.0',currentSchema:2});await center.init();await center.setTrustPolicy('required');
  const manifest=await buildCurrentManifest(root,'4.2.0',2),base=manifest.files.find(item=>item.path==='public/app.js');
  let bundle=createReleaseBundle({baseVersion:'4.2.0',targetVersion:'4.3.0',schemaVersion:2,baseManifestDigest:manifest.digest,format:RELEASE_FORMATS.signed,files:[{path:'public/app.js',content:'trusted-next\n',baseExists:true,baseSha256:base.sha256}]});bundle=signReleaseBundle(bundle,{privateKeyPem,keyName:'Local Publisher'});
  let staged=await center.stage(bundle);assert.equal(staged.ok,false);assert.equal(staged.signature.status,'untrusted');
  const added=await center.importTrustedKey({publicKeyPem,name:'Local Publisher'});assert.match(added.keyId,/^dd-/);
  staged=await center.stage(bundle);assert.equal(staged.ok,true);assert.equal(staged.signature.trusted,true);await center.apply({expectedDigest:staged.manifestDigest});assert.equal(await readFile(path.join(root,'public','app.js'),'utf8'),'trusted-next\n');
  const reboot=new ReleaseCenter({projectRoot:root,stateDir,currentVersion:'4.2.0',currentSchema:2});await reboot.init();assert.equal(reboot.trustSnapshot().policy,'required');assert.equal(reboot.trustSnapshot().keys.some(key=>key.keyId===added.keyId),true);
});

test('required trust policy blocks unsigned v2 packages and signed metadata tampering fails',async t=>{
  const root=await fixture();t.after(()=>rm(root,{recursive:true,force:true}));const center=new ReleaseCenter({projectRoot:root,stateDir:path.join(root,'data','releases'),currentVersion:'4.2.0',currentSchema:2});await center.init();await center.setTrustPolicy('required');
  const unsigned=await strongBundle(root,{files:[{path:'public/app.js',content:'next\n'}]});const blocked=await center.stage(unsigned);assert.equal(blocked.ok,false);assert.equal(blocked.checks.some(check=>check.id==='signature'&&check.status==='fail'),true);
  const {publicKey,privateKey}=generateKeyPairSync('ed25519'),publicKeyPem=String(publicKey.export({type:'spki',format:'pem'})),privateKeyPem=String(privateKey.export({type:'pkcs8',format:'pem'}));await center.importTrustedKey({publicKeyPem,name:'Signer'});
  const manifest=await buildCurrentManifest(root,'4.2.0',2),base=manifest.files.find(item=>item.path==='public/app.js');let signed=createReleaseBundle({baseVersion:'4.2.0',targetVersion:'4.3.0',schemaVersion:2,baseManifestDigest:manifest.digest,format:RELEASE_FORMATS.signed,channel:'stable',files:[{path:'public/app.js',content:'next\n',baseExists:true,baseSha256:base.sha256}]});signed=signReleaseBundle(signed,{privateKeyPem,keyName:'Signer'});
  const tampered=structuredClone(signed);tampered.channel='beta';const result=await center.stage(tampered);assert.equal(result.ok,false);assert.equal(result.checks.some(check=>check.id==='manifest'&&check.status==='fail'),true);
});

test('v3 release rejects unsupported channels before signing',()=>{
  assert.throws(()=>createReleaseBundle({baseVersion:'4.2.0',targetVersion:'4.3.0',schemaVersion:2,baseManifestDigest:'a'.repeat(64),format:RELEASE_FORMATS.signed,channel:'nightly',files:[]}),/stable 또는 beta/);
});

test('release supply-chain guard blocks mismatched package and lock updates',async t=>{
  const root=await fixture();t.after(()=>rm(root,{recursive:true,force:true}));const center=new ReleaseCenter({projectRoot:root,stateDir:path.join(root,'data','releases'),currentVersion:'4.2.0',currentSchema:2});await center.init();
  const nextPkg=JSON.stringify({name:'fixture',version:'4.3.0',dependencies:{alpha:'^1.0.0'}}),badLock=JSON.stringify({name:'fixture',version:'4.3.0',lockfileVersion:3,packages:{'':{name:'fixture',version:'4.3.0',dependencies:{}}}});
  const bundle=await strongBundle(root,{files:[{path:'package.json',content:nextPkg},{path:'package-lock.json',content:badLock}]});const staged=await center.stage(bundle);assert.equal(staged.ok,false);assert.equal(staged.checks.some(check=>check.id==='supply-direct-lock-match'&&check.status==='fail'),true);
});

test('release supply-chain guard accepts synchronized package and lock version bump',async t=>{
  const root=await fixture();t.after(()=>rm(root,{recursive:true,force:true}));const center=new ReleaseCenter({projectRoot:root,stateDir:path.join(root,'data','releases'),currentVersion:'4.2.0',currentSchema:2});await center.init();
  const nextPkg=JSON.stringify({name:'fixture',version:'4.3.0',dependencies:{}}),nextLock=JSON.stringify({name:'fixture',version:'4.3.0',lockfileVersion:3,packages:{'':{name:'fixture',version:'4.3.0',dependencies:{}}}});
  const bundle=await strongBundle(root,{files:[{path:'package.json',content:nextPkg},{path:'package-lock.json',content:nextLock}]});const staged=await center.stage(bundle);assert.equal(staged.ok,true);assert.equal(staged.dependencyReview.status,'pass');assert.equal(staged.dependencyReview.changed,true);
});


test('manifest fails closed on a malformed root file or unreadable source directory',async t=>{
 const root=await fixture();t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(path.join(root,'README.md'));
 await assert.rejects(buildCurrentManifest(root,'4.2.0',2),/regular file/);
 await rm(path.join(root,'README.md'),{recursive:true});
 await writeFile(path.join(root,'scripts'),'not-a-directory');
 await assert.rejects(buildCurrentManifest(root,'4.2.0',2),/regular directory/);
});
