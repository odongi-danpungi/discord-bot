import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('release center dashboard ids and handlers stay wired',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8'),js=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  for(const id of ['releaseStatus','releaseBundleFile','verifyRelease','applyRelease','rollbackRelease','runReleaseSmoke','releaseDiffList','releaseSmokeList','releaseHistory','releaseIntegrityMode','releaseDriftSummary','releaseSignatureTrust','releaseSignatureKey','releaseTrustPolicy','saveReleaseTrustPolicy','releaseTrustKeyList','releaseTrustName','releaseTrustPem','trustReleaseKey','trustReleaseCandidate'])assert.match(html,new RegExp(`id=["']${id}["']`));
  assert.match(js,/releaseRefresh/);assert.match(js,/verifyReleaseFile/);assert.match(js,/applyRelease/);assert.match(js,/rollbackRelease/);assert.match(js,/trustReleaseKey/);assert.match(js,/removeReleaseKey/);assert.match(js,/saveReleaseTrustPolicy/);assert.match(js,/crash-recovered-restart-required/);assert.match(js,/error\.data/);assert.match(js,/SIGNED/);
});
