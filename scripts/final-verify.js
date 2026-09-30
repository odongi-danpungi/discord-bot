import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const args=new Set(process.argv.slice(2));
const coreOnly=args.has('--core-only');
const requiredNode=[22,22,2];
const dependencySpecs=['express','discord.js','dotenv/config','jsdom','iconv-lite'];
const externalTestFiles=new Set([
  'api.test.js',
  'dashboard.test.js',
  'discord-service.test.js',
  'guide.test.js',
  'standalone.test.js',
  'startup.test.js',
  'viewer-ui.test.js'
]);

function parseVersion(value){
  const match=String(value||'').match(/^(\d+)\.(\d+)\.(\d+)/);
  return match?match.slice(1).map(Number):[0,0,0];
}

function versionAtLeast(current,minimum){
  for(let i=0;i<3;i++){
    if(current[i]>minimum[i])return true;
    if(current[i]<minimum[i])return false;
  }
  return true;
}

function run(label,command,commandArgs){
  process.stdout.write(`\n[final-verify] ${label}\n`);
  const result=spawnSync(command,commandArgs,{stdio:'inherit',env:process.env});
  if(result.error)throw result.error;
  if(result.status!==0)throw Object.assign(new Error(`${label} failed with exit ${result.status}`),{exitCode:result.status||1});
}

const currentNode=parseVersion(process.versions.node);
const nodeOk=versionAtLeast(currentNode,requiredNode);
console.log(`[final-verify] Node ${process.versions.node} / required >=${requiredNode.join('.')}: ${nodeOk?'PASS':coreOnly?'WARN':'FAIL'}`);
if(!nodeOk&&!coreOnly){
  console.error('[final-verify] Final integration requires Node >=22.22.2.');
  process.exit(2);
}

const require=createRequire(import.meta.url);
const missing=[];
for(const spec of dependencySpecs){
  try{require.resolve(spec);console.log(`[final-verify] dependency ${spec}: PASS`);}catch{missing.push(spec);console.log(`[final-verify] dependency ${spec}: ${coreOnly?'WARN':'FAIL'}`);}
}
if(missing.length&&!coreOnly){
  console.error(`[final-verify] Missing installed dependencies: ${missing.join(', ')}. Run npm ci first.`);
  process.exit(3);
}

run('static syntax check',process.execPath,['scripts/check.js']);

if(coreOnly){
  const files=readdirSync('test').filter(name=>name.endsWith('.test.js')&&!externalTestFiles.has(name)).sort().map(name=>`test/${name}`);
  run(`core regression (${files.length} files; external-dependency integration tests excluded)`,process.execPath,['--test',...files]);
  console.log('\n[final-verify] CORE-ONLY PASS. This is not a substitute for a normal final verification run with Node >=22.22.2 and npm ci dependencies installed.');
}else{
  run('full integration regression',process.execPath,['--test']);
  console.log('\n[final-verify] FINAL PASS. Node floor, installed dependencies, syntax checks, and the full test suite passed.');
}
