import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('dashboard exposes supply-chain guard metrics and SBOM download',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8'),js=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  for(const id of ['supplyStatus','supplyPackages','supplyDirect','supplyInstallScripts','supplyIntegrityErrors','supplyCheckList','refreshSupply','supplyDirectList','supplyScriptList','supplyLicenseList','supplyPackageDigest','supplyLockDigest','releaseSupplyStatus'])assert.match(html,new RegExp(`id=["']${id}["']`));
  assert.match(html,/\/api\/supply-chain\/sbom/);assert.match(js,/supplyRefresh/);assert.match(js,/renderSupply/);assert.match(js,/dependencyReview/);
});
