import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const h=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const slice=(a,b)=>h.slice(h.indexOf(a),h.indexOf(b,h.indexOf(a)));
const restore=new Function(slice('const mk=','let S=')+slice('const wk=','function readStoredLiveSequence')+slice('const importedWinner=','const win=')+slice('function cleanState(','$(\'exp\').onclick')+'\nreturn cleanState')();
const active=(id,score=[4,5])=>({id,isActive:true,players:['A','B','C','D'],score});
const cases=[['empty courts',()=>assert.equal(restore({courts:[]}).courts.length,1)],['duplicate IDs',()=>assert.equal(new Set(restore({courts:[active(1),active(1)]}).courts.map(c=>c.id)).size,2)],['invalid active scores',()=>assert.deepEqual(restore({courts:[active(1,['Infinity',2.8])]}).courts[0].score,[0,2])],['invalid logged scores',()=>assert.deepEqual(restore({courts:[active(1)],log:[{p:['A','B','C','D'],s:['Infinity',-1]}]}).log[0].s,[0,0])],['valid scores preserved; sparse IDs normalized',()=>assert.deepEqual(restore({courts:[active(3)]}).courts.map(c=>[c.id,c.score]),[[1,[4,5]]])],['invalid IDs repaired',()=>assert.ok(restore({courts:[active(-1),active('Infinity')]}).courts.every(c=>Number.isSafeInteger(c.id)&&c.id>0))]];
let failed=0;for(const [name,fn] of cases){try{fn();console.log('PASS',name)}catch(e){failed++;console.log('FAIL',name,e.message)}}if(failed)process.exitCode=1;
// Cover finished-results sharing as well as backup import; sanitizer must be in shared scope.
const snapshot=new Function(slice('const importedWinner=','const win=')+slice('function resultsSnapshot(){','function buildLiveSessionData(){')+";const S={name:'Test',log:[{p:['A','B','C','D'],s:['Infinity',3.9],w:0}],courts:[{}],target:11,wb:2};const stats=()=>[];const displayNameMap=()=>({});const safePlayerName=n=>n;return resultsSnapshot()")();
assert.deepEqual(snapshot.matches[0].s,[0,3]);
console.log('PASS finished results snapshot scores');
