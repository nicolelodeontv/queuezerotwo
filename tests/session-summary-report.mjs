import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';

const APP_URL=process.env.APP_URL||'http://127.0.0.1:4173/';
const browser=await chromium.launch({headless:true});
try{
 const context=await browser.newContext({acceptDownloads:true,viewport:{width:390,height:844},serviceWorkers:'block'});
 await context.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(url.hostname.endsWith('.supabase.co'))return route.abort();
  return route.continue();
 });
 const page=await context.newPage();
 await page.goto(APP_URL,{waitUntil:'load',timeout:30000});
 await page.waitForFunction(()=>typeof buildSessionReport==='function'&&typeof openSessionReport==='function');
 const result=await page.evaluate(()=>{
  S=mk();
  S.name='Saturday Open Play';
  S.fair={ava:{sitouts:2},ben:{sitouts:1}};
  S.log=[
   {c:'Court 1',p:['Ava','Ben','Cara','Drew'],s:[11,8],w:0,t:1760000000000,d:600000},
   {c:'Court 2',p:['Ava','Cara','Ben','Drew'],s:[7,11],w:1,t:1760000600000,d:720000},
   {c:'Court 1',p:['Ava','Drew','Ben','Cara'],s:[10,10],w:-1,t:1760001200000,d:500000},
  ];
  const r=buildSessionReport(S);
  return {r,button:typeof openSessionReport};
 });
 const ava=result.r.players.find(p=>p.name==='Ava');
 assert.equal(result.r.games,3);
 assert.equal(result.r.decidedGames,2);
 assert.equal(result.r.players.length,4);
 assert.equal(ava.games,3);
 assert.equal(ava.wins,1);
 assert.equal(ava.losses,1);
 assert.equal(ava.unknown,1);
 assert.equal(ava.winRate,50);
 assert.equal(ava.sitouts,2);
 assert.equal(ava.uniquePartners,3);
 assert.equal(result.r.points,57);
 await page.evaluate(()=>{S.ended=true;showRes()});
 const reportButton=page.getByRole('button',{name:/Session summary & player stats/i});
 await reportButton.waitFor({state:'visible',timeout:5000});
 await reportButton.click();
 await page.getByRole('heading',{name:'Session Summary'}).waitFor();
 assert.match(await page.getByRole('dialog',{name:'Session Summary'}).innerText(),/Ava/);
 assert.match(await page.getByRole('dialog',{name:'Session Summary'}).innerText(),/50%/);
 for(const width of [320,390,768,1024]){
  await page.setViewportSize({width,height:900});
  const m=await page.evaluate(()=>({w:innerWidth,doc:document.documentElement.scrollWidth,body:document.body.scrollWidth}));
  assert.ok(m.doc<=m.w+1&&m.body<=m.w+1,'summary layout overflow at '+width+': '+JSON.stringify(m));
 }
 const [download]=await Promise.all([
  page.waitForEvent('download'),
  page.getByRole('button',{name:/Download CSV/i}).click()
 ]);
 assert.match(download.suggestedFilename(),/queuezerotwo-saturday-open-play-report-.*\.csv/);
 const path=await download.path();
 const csv=await readFile(path,'utf8');
 assert.match(csv,/"Player","Saturday Open Play","Ava","3","1","1","50%","2","3"/);
 assert.match(csv,/"Match","Saturday Open Play"/);
 assert.match(csv,/No winner recorded/);
 await context.close();
 console.log('PASS: session report calculations, no-winner handling, sit-out metadata, partner variety, responsive modal, and CSV match export.');
}finally{await browser.close()}
