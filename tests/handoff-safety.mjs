import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('function handoff(){'),html.indexOf('/* Release 1: court count'));
function setup({online=true,pending=false,reject=false}={}){
 const messages=[],state={sid:'OLD',sh:'old'},calls=[];let confirm;
 const run=new Function('sb','navigator','PQ','S','toast','ensureLiveIdentity','location','history','ask','randHostKey','clearPublishQueue','save','render',source+';return {handoff,takeover}');
 const app=run({rpc:async(...args)=>{calls.push(args);if(reject)throw Error('offline');return {error:null}}},{onLine:online},pending?[{kind:'results'}]:[],state,(m)=>messages.push(m),()=>{}, {hash:'#h=ABCDEFGHIJ.'+'a'.repeat(64),pathname:'/',search:''},{replaceState(){}},(t,m,fn)=>confirm=fn,()=> 'b'.repeat(64),()=>calls.push('clear'),()=>{},()=>{});
 return {app,state,messages,calls,confirm:()=>confirm()};
}
for(const [label,options] of [['offline',{online:false}],['pending results',{pending:true}],['network rejection',{reject:true}]]){const x=setup(options);x.app.takeover();await x.confirm();assert.equal(x.state.sid,'OLD');assert.ok(x.messages.length);assert.ok(!x.calls.includes('clear'));console.log('PASS',label)}
const x=setup();x.app.takeover();await x.confirm();assert.equal(x.state.sid,'ABCDEFGHIJ');assert.ok(x.calls.includes('clear'));console.log('PASS successful rotation');
for(const options of [{online:false},{pending:true}]){const a=setup(options);a.app.handoff();assert.ok(a.messages.length);assert.equal(a.calls.length,0)}console.log('PASS outgoing handoff guards');
