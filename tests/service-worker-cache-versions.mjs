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
assert.deepEqual(versions,Array.from({length:46},(_,i)=>i+1),'Historical and reserved cache versions must remain contiguous and unique');
const reservations=allocations.filter(x=>x.status==='reserved'||x.status==='assigned').map(x=>({version:Number(x.cache.match(/v([0-9]+)$/)[1]),pr:x.pr,status:x.status}));
assert.deepEqual(reservations,[
  {version:43,pr:75,status:'reserved'},
  {version:44,pr:77,status:'assigned'},
  {version:45,pr:null,status:'assigned'},
  {version:46,pr:null,status:'assigned'}
],'PR #74 v42 is released; PR #75 reserves v43');
const released30=allocations.find(x=>x.cache==='queuezerotwo-v30');
assert.equal(released30?.status,'released','PR #61 v30 is merged before this PR rebases');
assert.equal(released30?.merge_commit_sha,'afb83d825785137063cf5f55331035d25965d81d');
const released31=allocations.find(x=>x.cache==='queuezerotwo-v31');
assert.equal(released31?.status,'released','PR #62 v31 is merged before this PR rebases');
assert.equal(released31?.merge_commit_sha,'de036ea293925e06e7ee57036891adfdd70fe2a0');
const released32=allocations.find(x=>x.cache==='queuezerotwo-v32');
assert.equal(released32?.status,'released','PR #63 v32 is merged before this PR rebases');
assert.equal(released32?.merge_commit_sha,'c10bfc147c23e0557dc8a190821294a1d75e48f2');
const released33=allocations.find(x=>x.cache==='queuezerotwo-v33');
assert.equal(released33?.status,'released','PR #65 v33 is merged before this PR rebases');
assert.equal(released33?.merge_commit_sha,'0eb3d1ce4309ef298fd2414a74967e0a47137226');
const released34=allocations.find(x=>x.cache==='queuezerotwo-v34');
assert.equal(released34?.status,'released','PR #66 v34 is merged before this PR rebases');
assert.equal(released34?.pr,66);
assert.equal(released34?.merge_commit_sha,'ba3a3102657965ae9fb60aa4d5eca802e9953e46');
const released35=allocations.find(x=>x.cache==='queuezerotwo-v35');
assert.equal(released35?.status,'released','PR #67 v35 is merged before this PR rebases');
assert.equal(released35?.pr,67);
assert.equal(released35?.merge_commit_sha,'33d89273f9bb917ea5c4f0ce3b2d0314de4aee34');
const released36=allocations.find(x=>x.cache==='queuezerotwo-v36');
assert.equal(released36?.status,'released','PR #68 v36 is merged before this PR rebases');
assert.equal(released36?.pr,68);
assert.equal(released36?.merge_commit_sha,'a6fa47d5dcff6aaead3bfe8e03ca11be3fea8a43');
const released37=allocations.find(x=>x.cache==='queuezerotwo-v37');
assert.equal(released37?.status,'released','PR #69 v37 is merged before this PR rebases');
assert.equal(released37?.pr,69);
assert.equal(released37?.merge_commit_sha,'48960591dfb7598df6b6e0395a9b835f4b9e6e08');
const released38=allocations.find(x=>x.cache==='queuezerotwo-v38');
assert.equal(released38?.status,'released','PR #70 v38 is merged before this PR rebases');
assert.equal(released38?.pr,70);
assert.equal(released38?.merge_commit_sha,'d3d22538af1929b64c97db922c3fb7d333c4dfe9');
const released39=allocations.find(x=>x.cache==='queuezerotwo-v39');
assert.equal(released39?.status,'released','PR #71 v39 is merged before this PR rebases');
assert.equal(released39?.pr,71);
assert.equal(released39?.merge_commit_sha,'87bee81e2ec5f5f0fcce19b552cd68e48c47ec17');
const released40=allocations.find(x=>x.cache==='queuezerotwo-v40');
assert.equal(released40?.status,'released','PR #72 v40 is merged before this PR');
assert.equal(released40?.pr,72);
assert.equal(released40?.merge_commit_sha,'0dcc7851f457277430cfc1ff4a795afae07282e1');
const released41=allocations.find(x=>x.cache==='queuezerotwo-v41');
assert.equal(released41?.status,'released','PR #73 v41 is merged before this PR');
assert.equal(released41?.pr,73);
assert.equal(released41?.merge_commit_sha,'d533a0d72430855af075726be6081929659ad451');
const released42=allocations.find(x=>x.cache==='queuezerotwo-v42');
assert.equal(released42?.status,'released','PR #74 v42 is merged before this PR');
assert.equal(released42?.pr,74);
assert.equal(released42?.merge_commit_sha,'dbde26b5564a73fc03a42610157fedfa5a0ce939');
assert.equal(manifest.releaseOrder.join(','),'61,62,63,65,66,67,68,69,70,71,72,73,74,75,77');
console.log(JSON.stringify({pass:true,currentCache:match[1],released:42,reserved:1,assigned:0,uniqueCacheNames:names.length},null,2));
