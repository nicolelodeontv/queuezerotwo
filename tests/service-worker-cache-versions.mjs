import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'tests/service-worker-cache-versions.json'),'utf8'));
const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
const match=sw.match(/const\s+V\s*=\s*['"]([^'"]+)['"]/);
assert.ok(match,'Service worker cache constant V must be declared');
assert.equal(match[1],manifest.currentCache,'sw.js must use the cache allocated to this branch');

const allocations=manifest.allocations;
assert.ok(Array.isArray(allocations)&&allocations.length>0,'Cache allocation ledger must be present');
const names=allocations.map(x=>x.cache);
const duplicates=names.filter((name,index)=>names.indexOf(name)!==index);
assert.deepEqual(duplicates,[],'A released or reserved service-worker cache name must never be reused');
for(const item of allocations){
  assert.match(item.cache,/^queuezerotwo-v[1-9][0-9]*$/,'Cache names use the numeric QueueZeroTwo version format');
}
const versions=allocations.map(x=>Number(x.cache.match(/v([0-9]+)$/)[1])).sort((a,b)=>a-b);
assert.deepEqual(versions,Array.from({length:32},(_,i)=>i+1),'Historical and reserved cache versions must remain contiguous and unique');
const reservations=allocations.filter(x=>x.status==='reserved'||x.status==='assigned').map(x=>({version:Number(x.cache.match(/v([0-9]+)$/)[1]),pr:x.pr,status:x.status}));
assert.deepEqual(reservations,[
  {version:31,pr:62,status:'assigned'},
  {version:32,pr:63,status:'reserved'}
],'Release order #61 -> #62 -> #63 assigns v30 -> v31 -> v32');
const released30=allocations.find(x=>x.cache==='queuezerotwo-v30');
assert.equal(released30?.status,'released','PR #61 v30 is merged before this PR rebases');
assert.equal(released30?.merge_commit_sha,'afb83d825785137063cf5f55331035d25965d81d');
assert.equal(manifest.releaseOrder.join(','),'61,62,63');
console.log(JSON.stringify({pass:true,currentCache:match[1],released:30,reserved:1,assigned:1,uniqueCacheNames:names.length},null,2));
